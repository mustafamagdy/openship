import net from "node:net";
import { repos, type Project } from "@repo/db";
import { env } from "../config/env";
import { isBlockedHostname, isPrivateIp } from "./ssrf-guard";

interface DeploymentSnapshotLike {
  serverId?: string;
}

function publicRoutingHost(raw: string | null | undefined): string | null {
  const host = raw
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^\[|\]$/g, "");
  if (!host || isBlockedHostname(host)) return null;
  if (net.isIP(host) && isPrivateIp(host)) return null;
  return host;
}

/**
 * Resolve a server's host (IP/hostname) for an org. Refuses to read
 * server rows that belong to a different organization than the caller —
 * defense against a caller smuggling a foreign org's serverId through
 * a request body to route their managed subdomain at another tenant's
 * host.
 *
 * Falls back to env.SERVER_IP when no serverId is supplied, then to the
 * auto-registered local server's persisted public host. The second fallback is
 * what keeps DNS guidance working after the setup wizard detected the address
 * at runtime (environment variables cannot be added to an already-running
 * service).
 */
async function resolveSnapshotServerHost(
  organizationId: string,
  snapshot?: DeploymentSnapshotLike | null,
): Promise<string | null> {
  if (snapshot?.serverId) {
    const server = await repos.server.getInOrganization(
      snapshot.serverId,
      organizationId,
    );
    if (server?.sshHost) return server.sshHost;
    return null;
  }

  const configured = publicRoutingHost(env.SERVER_IP);
  if (configured) return configured;
  if (!organizationId) return null;

  const local = await repos.server.findLocal(organizationId);
  return publicRoutingHost(local?.sshHost);
}

export async function resolveServerHost(
  organizationId: string,
  serverId?: string,
): Promise<string | null> {
  return resolveSnapshotServerHost(
    organizationId,
    serverId ? { serverId } : null,
  );
}

export async function resolveProjectServerHost(project?: Project): Promise<string | null> {
  if (!project) return env.SERVER_IP ?? null;

  const deployment = project.activeDeploymentId
    ? await repos.deployment.findById(project.activeDeploymentId)
    : await repos.deployment.findLatestByProject(project.id);

  const snapshot = (deployment?.meta ?? null) as DeploymentSnapshotLike | null;
  return resolveSnapshotServerHost(project.organizationId, snapshot);
}
