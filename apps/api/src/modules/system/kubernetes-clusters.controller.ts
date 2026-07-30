/**
 * Organization-wide Kubernetes discovery and health.
 *
 * A Kubernetes cluster is intentionally backed by an existing OpenShip server:
 * that server owns the SSH credentials and is the trusted kubectl execution
 * point. No kubeconfig or bearer token is copied into the OpenShip database.
 */

import type { Context } from "hono";
import { repos } from "@repo/db";
import { safeErrorMessage } from "@repo/core";
import { getRequestContext } from "../../lib/request-context";
import { assertNotCloud } from "../../lib/controller-helpers";
import { sshManager } from "../../lib/ssh-manager";
import type { DeploymentMeta } from "../../lib/deployment-runtime";

type KubernetesList<T> = { items?: T[] };

interface VersionInfo {
  serverVersion?: { gitVersion?: string };
}

interface NodeItem {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    creationTimestamp?: string;
  };
  status?: {
    addresses?: Array<{ type?: string; address?: string }>;
    allocatable?: {
      cpu?: string;
      memory?: string;
      pods?: string;
    };
    conditions?: Array<{ type?: string; status?: string }>;
    nodeInfo?: {
      kubeletVersion?: string;
      operatingSystem?: string;
      architecture?: string;
      containerRuntimeVersion?: string;
    };
  };
}

interface PodItem {
  spec?: { nodeName?: string };
  status?: { phase?: string };
}

interface WorkloadItem {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: { replicas?: number };
  status?: { readyReplicas?: number };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

function listItems<T>(value: string): T[] {
  const parsed = parseJson<KubernetesList<T>>(value);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

function nodeReady(node: NodeItem): boolean {
  return (
    node.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ?? false
  );
}

interface NodeMetrics {
  cpuUsage: string | null;
  cpuPercent: number | null;
  memoryUsage: string | null;
  memoryPercent: number | null;
}

function parseNodeMetrics(value: string): Map<string, NodeMetrics> {
  const metrics = new Map<string, NodeMetrics>();
  for (const line of value.trim().split("\n")) {
    const [name, cpuUsage, cpuPercentRaw, memoryUsage, memoryPercentRaw] = line
      .trim()
      .split(/\s+/);
    if (!name) continue;
    const cpuPercent = Number.parseInt(cpuPercentRaw?.replace("%", "") ?? "", 10);
    const memoryPercent = Number.parseInt(memoryPercentRaw?.replace("%", "") ?? "", 10);
    metrics.set(name, {
      cpuUsage: cpuUsage || null,
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
      memoryUsage: memoryUsage || null,
      memoryPercent: Number.isFinite(memoryPercent) ? memoryPercent : null,
    });
  }
  return metrics;
}

async function inspectServer(
  server: Awaited<ReturnType<typeof repos.server.listByOrganization>>[number],
  projectsById: Map<string, { id: string; name: string; activeDeploymentId: string | null }>,
) {
  const base = {
    serverId: server.id,
    name: server.name || server.sshHost,
    host: server.sshHost,
    isLocal: server.isLocal,
  };

  try {
    return await sshManager.withExecutor(server.id, async (executor) => {
      const [versionRaw, nodesRaw, workloadsRaw, podsRaw, nodeMetricsRaw] = await Promise.all([
        executor.exec("sudo -n kubectl version -o json", { timeout: 30_000 }),
        executor.exec("sudo -n kubectl get nodes -o json", { timeout: 30_000 }),
        executor.exec(
          "sudo -n kubectl get deployments -A -l app.kubernetes.io/managed-by=openship -o json",
          { timeout: 30_000 },
        ),
        executor
          .exec("sudo -n kubectl get pods -A -o json", { timeout: 30_000 })
          .catch(() => '{"items":[]}'),
        executor
          .exec("sudo -n kubectl top nodes --no-headers", { timeout: 30_000 })
          .catch(() => ""),
      ]);

      const version = parseJson<VersionInfo>(versionRaw);
      const podCounts = new Map<string, number>();
      for (const pod of listItems<PodItem>(podsRaw)) {
        const nodeName = pod.spec?.nodeName;
        if (!nodeName || pod.status?.phase === "Succeeded" || pod.status?.phase === "Failed") continue;
        podCounts.set(nodeName, (podCounts.get(nodeName) ?? 0) + 1);
      }
      const nodeMetrics = parseNodeMetrics(nodeMetricsRaw);
      const nodes = listItems<NodeItem>(nodesRaw).map((node) => ({
        name: node.metadata?.name ?? "unknown",
        ready: nodeReady(node),
        role:
          node.metadata?.labels?.["node-role.kubernetes.io/control-plane"] !== undefined
            ? "control-plane"
            : node.metadata?.labels?.["node-role.kubernetes.io/master"] !== undefined
              ? "control-plane"
              : "worker",
        kubeletVersion: node.status?.nodeInfo?.kubeletVersion ?? null,
        operatingSystem: node.status?.nodeInfo?.operatingSystem ?? null,
        architecture: node.status?.nodeInfo?.architecture ?? null,
        containerRuntime: node.status?.nodeInfo?.containerRuntimeVersion ?? null,
        ip:
          node.status?.addresses?.find((address) => address.type === "InternalIP")?.address ??
          node.status?.addresses?.find((address) => address.address)?.address ??
          null,
        createdAt: node.metadata?.creationTimestamp ?? null,
        cpuCapacity: node.status?.allocatable?.cpu ?? null,
        memoryCapacity: node.status?.allocatable?.memory ?? null,
        podCapacity: Number.parseInt(node.status?.allocatable?.pods ?? "", 10) || null,
        podCount: podCounts.get(node.metadata?.name ?? "") ?? 0,
        ...(nodeMetrics.get(node.metadata?.name ?? "") ?? {
          cpuUsage: null,
          cpuPercent: null,
          memoryUsage: null,
          memoryPercent: null,
        }),
      }));
      const workloads = listItems<WorkloadItem>(workloadsRaw).map((workload) => {
        const projectId = workload.metadata?.labels?.["openship.io/project-id"] ?? null;
        const project = projectId ? projectsById.get(projectId) : undefined;
        return {
          name: workload.metadata?.name ?? "unknown",
          namespace: workload.metadata?.namespace ?? "default",
          projectId,
          projectName: project?.name ?? null,
          deploymentId: project?.activeDeploymentId ?? null,
          desiredReplicas: workload.spec?.replicas ?? 0,
          readyReplicas: workload.status?.readyReplicas ?? 0,
        };
      });

      return {
        ...base,
        configured: true as const,
        healthy: nodes.length > 0 && nodes.every((node) => node.ready),
        version: version.serverVersion?.gitVersion ?? null,
        nodes,
        workloads,
        error: null,
      };
    });
  } catch (error) {
    return {
      ...base,
      configured: false as const,
      healthy: false,
      version: null,
      nodes: [],
      workloads: [],
      error: safeErrorMessage(error),
    };
  }
}

/** GET /system/kubernetes/clusters */
export async function listKubernetesClusters(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;

  const ctx = getRequestContext(c);
  const [servers, projectPage] = await Promise.all([
    repos.server.listByOrganization(ctx.organizationId),
    repos.project.listByOrganization(ctx.organizationId, { page: 1, perPage: 10_000 }),
  ]);
  const projectsById = new Map(
    projectPage.rows.map((project) => [
      project.id,
      {
        id: project.id,
        name: project.name,
        activeDeploymentId: project.activeDeploymentId,
      },
    ]),
  );

  const inspected = await Promise.all(servers.map((server) => inspectServer(server, projectsById)));
  const clusters = inspected.filter((server) => server.configured);
  const candidates = inspected
    .filter((server) => !server.configured)
    .map(({ nodes: _nodes, workloads: _workloads, ...server }) => server);

  return c.json({
    clusters,
    candidates,
    summary: {
      clusters: clusters.length,
      healthyClusters: clusters.filter((cluster) => cluster.healthy).length,
      nodes: clusters.reduce((sum, cluster) => sum + cluster.nodes.length, 0),
      readyNodes: clusters.reduce(
        (sum, cluster) => sum + cluster.nodes.filter((node) => node.ready).length,
        0,
      ),
      workloads: clusters.reduce((sum, cluster) => sum + cluster.workloads.length, 0),
    },
  });
}
