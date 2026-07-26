import { repos, type ContainerRegistryConnection } from "@repo/db";
import { ValidationError } from "@repo/core";
import { DockerRuntime, type RegistryAuthConfig, type BuildLogger } from "@repo/adapters";
import type { RequestContext } from "../../lib/request-context";
import { decrypt, encrypt } from "../../lib/encryption";

export interface RegistryConnectionInput {
  name?: string;
  provider?: "ghcr" | "generic";
  registryHost: string;
  namespace: string;
  username: string;
  token: string;
}

function publicConnection(row: ContainerRegistryConnection) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    registryHost: row.registryHost,
    namespace: row.namespace,
    username: row.username,
    isDefault: row.isDefault,
    tokenSetAt: row.tokenSetAt,
    lastValidatedAt: row.lastValidatedAt,
  };
}

export function normalizeRegistryHost(input: string): string {
  const value = input.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  if (
    !value ||
    value.includes("/") ||
    !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/.test(value)
  ) {
    throw new ValidationError("Registry host must look like ghcr.io or registry.example.com:5000.");
  }
  return value;
}

function normalizeNamespace(input: string): string {
  const value = input.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(value)) {
    throw new ValidationError("Registry namespace contains unsupported characters.");
  }
  return value;
}

function normalizeName(input: string | undefined): string {
  const value = (input ?? "default").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(value)) {
    throw new ValidationError("Registry connection name is invalid.");
  }
  return value;
}

async function validateRegistryCredentials(
  host: string,
  username: string,
  token: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`https://${host}/v2/`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`,
        "User-Agent": "openship",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ValidationError(`Could not reach the OCI registry at ${host}.`);
  }
  if (!response.ok) {
    throw new ValidationError(
      `Registry authentication failed at ${host} (${response.status}). Check the username and token scopes.`,
    );
  }
}

export async function listConnections(ctx: Pick<RequestContext, "organizationId">) {
  return (
    await repos.containerRegistryConnection.listByOrganization(ctx.organizationId)
  ).map(publicConnection);
}

export async function connect(ctx: RequestContext, input: RegistryConnectionInput) {
  const registryHost = normalizeRegistryHost(input.registryHost);
  const namespace = normalizeNamespace(input.namespace);
  const username = input.username.trim();
  const token = input.token.trim();
  if (!username || username.length > 255 || !token || token.length > 4096) {
    throw new ValidationError("Registry username or token is invalid.");
  }
  await validateRegistryCredentials(registryHost, username, token);
  const row = await repos.containerRegistryConnection.upsertDefault({
    organizationId: ctx.organizationId,
    connectedByUserId: ctx.userId,
    name: normalizeName(input.name),
    provider: input.provider ?? (registryHost === "ghcr.io" ? "ghcr" : "generic"),
    registryHost,
    namespace,
    username,
    tokenEncrypted: encrypt(token),
    isDefault: true,
    tokenSetAt: new Date(),
    lastValidatedAt: new Date(),
  });
  return publicConnection(row);
}

export async function disconnect(
  ctx: Pick<RequestContext, "organizationId">,
  id: string,
): Promise<void> {
  const row = await repos.containerRegistryConnection.findById(ctx.organizationId, id);
  if (!row) throw new ValidationError("Registry connection was not found.");
  await repos.containerRegistryConnection.remove(ctx.organizationId, id);
}

export async function getDefaultRegistryAuth(
  organizationId: string,
): Promise<
  | {
      connection: ContainerRegistryConnection;
      auth: RegistryAuthConfig;
    }
  | undefined
> {
  const connection = await repos.containerRegistryConnection.findDefault(organizationId);
  if (!connection) return undefined;
  return {
    connection,
    auth: {
      username: connection.username,
      password: decrypt(connection.tokenEncrypted),
      serveraddress: connection.registryHost,
    },
  };
}

function safeImagePart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return normalized || "app";
}

export async function publishBuildArtifact(input: {
  organizationId: string;
  runtime: DockerRuntime;
  localRef: string;
  projectSlug: string;
  artifactKey: string;
  logger?: BuildLogger;
}): Promise<{ imageRef: string; imageDigest: string } | undefined> {
  const configured = await getDefaultRegistryAuth(input.organizationId);
  if (!configured) return undefined;
  const repository = `${configured.connection.registryHost}/${configured.connection.namespace}/openship-${safeImagePart(input.projectSlug)}`;
  const tag = safeImagePart(input.artifactKey).slice(0, 120);
  const remoteRef = `${repository}:${tag}`;
  input.logger?.log(`Publishing immutable build artifact ${remoteRef}...\n`, "info");
  const published = await input.runtime.publishImage(input.localRef, remoteRef, configured.auth);
  input.logger?.log(`Published ${published.imageRef}.\n`, "info");
  return published;
}
