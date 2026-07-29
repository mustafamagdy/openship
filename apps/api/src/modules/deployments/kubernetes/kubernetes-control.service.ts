import { ForbiddenError } from "@repo/core";
import { sshManager } from "../../../lib/ssh-manager";
import type { DeploymentMeta } from "../../../lib/deployment-runtime";
import type { ShellOptions, ShellSession } from "@repo/adapters";
import { getDeployment } from "../deployment.service";
import { ownedResourceQuery } from "./kubernetes-command";

type KubernetesList<T> = { items?: T[] };

interface DeploymentItem {
  metadata?: { name?: string; namespace?: string };
  spec?: { replicas?: number };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
    unavailableReplicas?: number;
  };
}

interface PodItem {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    podIP?: string;
    containerStatuses?: Array<{ name?: string; ready?: boolean; restartCount?: number }>;
  };
}

interface ServiceItem {
  metadata?: { name?: string };
  spec?: {
    type?: string;
    clusterIP?: string;
    ports?: Array<{ port?: number; nodePort?: number }>;
  };
}

interface PdbItem {
  metadata?: { name?: string };
  status?: {
    currentHealthy?: number;
    desiredHealthy?: number;
    disruptionsAllowed?: number;
  };
}

export interface KubernetesInventory {
  namespace: string;
  summary: {
    deployments: number;
    desiredReplicas: number;
    readyReplicas: number;
    pods: number;
    readyPods: number;
    healthy: boolean;
  };
  deployments: Array<{
    name: string;
    desired: number;
    ready: number;
    available: number;
    updated: number;
    unavailable: number;
  }>;
  pods: Array<{
    name: string;
    serviceName?: string;
    node?: string;
    phase?: string;
    podIP?: string;
    ready: boolean;
    restarts: number;
  }>;
  services: Array<{
    name: string;
    type?: string;
    clusterIP?: string;
    port?: number;
    nodePort?: number;
  }>;
  disruptionBudgets: Array<{
    name: string;
    currentHealthy: number;
    desiredHealthy: number;
    disruptionsAllowed: number;
  }>;
}

function safeName(value: string, kind: string): string {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)) {
    throw new ForbiddenError(`Invalid Kubernetes ${kind}.`);
  }
  return value;
}

function safeSelectorValue(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ForbiddenError("Invalid Kubernetes project selector.");
  }
  return value;
}

async function binding(deploymentId: string, organizationId: string) {
  const deployment = await getDeployment(deploymentId, organizationId);
  const meta = (deployment.meta ?? {}) as DeploymentMeta;
  const serverId = meta.kubernetesServerId;
  const namespace = meta.kubernetesNamespace;
  if (!serverId || !namespace || !deployment.containerId?.startsWith("kubernetes")) {
    throw new ForbiddenError("This deployment is not managed by Kubernetes.");
  }
  return {
    deployment,
    serverId,
    namespace: safeName(namespace, "namespace"),
    selector: `openship.io/project-id=${safeSelectorValue(deployment.projectId)}`,
  };
}

function parseList<T>(value: string): T[] {
  const parsed = JSON.parse(value) as KubernetesList<T>;
  return Array.isArray(parsed.items) ? parsed.items : [];
}

function assertOwnedResource(output: string, expectedName: string): void {
  if (!output.trim().endsWith(`/${expectedName}`)) {
    throw new ForbiddenError("Kubernetes resource is not owned by this OpenShip deployment.");
  }
}

export async function inventory(
  deploymentId: string,
  organizationId: string,
): Promise<KubernetesInventory> {
  const target = await binding(deploymentId, organizationId);
  return sshManager.withExecutor(target.serverId, async (executor) => {
    const prefix = `sudo -n kubectl -n ${target.namespace}`;
    const [deploymentsRaw, podsRaw, servicesRaw, pdbRaw] = await Promise.all([
      executor.exec(`${prefix} get deployments -l ${target.selector} -o json`, { timeout: 30_000 }),
      executor.exec(`${prefix} get pods -l ${target.selector} -o json`, { timeout: 30_000 }),
      executor.exec(`${prefix} get services -l ${target.selector} -o json`, { timeout: 30_000 }),
      executor.exec(`${prefix} get pdb -l ${target.selector} -o json`, { timeout: 30_000 }),
    ]);
    const deploymentItems = parseList<DeploymentItem>(deploymentsRaw);
    const podItems = parseList<PodItem>(podsRaw);
    const serviceItems = parseList<ServiceItem>(servicesRaw);
    const pdbItems = parseList<PdbItem>(pdbRaw);
    const deployments = deploymentItems.map((item) => ({
      name: item.metadata?.name ?? "unknown",
      desired: item.spec?.replicas ?? 0,
      ready: item.status?.readyReplicas ?? 0,
      available: item.status?.availableReplicas ?? 0,
      updated: item.status?.updatedReplicas ?? 0,
      unavailable: item.status?.unavailableReplicas ?? 0,
    }));
    const pods = podItems.map((item) => {
      const statuses = item.status?.containerStatuses ?? [];
      return {
        name: item.metadata?.name ?? "unknown",
        serviceName: item.metadata?.labels?.["openship.io/service-name"],
        node: item.spec?.nodeName,
        phase: item.status?.phase,
        podIP: item.status?.podIP,
        ready: statuses.length > 0 && statuses.every((status) => status.ready),
        restarts: statuses.reduce((total, status) => total + (status.restartCount ?? 0), 0),
      };
    });
    const desiredReplicas = deployments.reduce((total, item) => total + item.desired, 0);
    const readyReplicas = deployments.reduce((total, item) => total + item.ready, 0);
    const readyPods = pods.filter((pod) => pod.ready).length;
    return {
      namespace: target.namespace,
      summary: {
        deployments: deployments.length,
        desiredReplicas,
        readyReplicas,
        pods: pods.length,
        readyPods,
        healthy:
          deployments.length > 0 && desiredReplicas === readyReplicas && pods.length === readyPods,
      },
      deployments,
      pods,
      services: serviceItems.map((item) => ({
        name: item.metadata?.name ?? "unknown",
        type: item.spec?.type,
        clusterIP: item.spec?.clusterIP,
        port: item.spec?.ports?.[0]?.port,
        nodePort: item.spec?.ports?.[0]?.nodePort,
      })),
      disruptionBudgets: pdbItems.map((item) => ({
        name: item.metadata?.name ?? "unknown",
        currentHealthy: item.status?.currentHealthy ?? 0,
        desiredHealthy: item.status?.desiredHealthy ?? 0,
        disruptionsAllowed: item.status?.disruptionsAllowed ?? 0,
      })),
    };
  });
}

/**
 * Open an interactive shell in one ready pod for a project service.
 *
 * The SSH PTY immediately `exec`s kubectl, so leaving the pod shell closes the
 * channel instead of dropping the user onto the Kubernetes node's host shell.
 */
export async function openServiceShell(
  deploymentId: string,
  organizationId: string,
  serviceName: string,
  opts?: ShellOptions,
): Promise<ShellSession> {
  const target = await binding(deploymentId, organizationId);
  const safeServiceName = safeSelectorValue(serviceName);
  const executor = await sshManager.acquire(target.serverId);
  sshManager.retain(target.serverId);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    sshManager.release(target.serverId);
  };

  try {
    if (!executor.openShell) {
      throw new ForbiddenError("Interactive shell is not supported by this Kubernetes server.");
    }
    const selector = `${target.selector},openship.io/service-name=${safeServiceName}`;
    const raw = await executor.exec(
      `sudo -n kubectl -n ${target.namespace} get pods -l ${selector} -o json`,
      { timeout: 30_000 },
    );
    const pods = parseList<PodItem>(raw);
    const pod =
      pods.find((item) =>
        item.status?.phase === "Running" &&
        (item.status.containerStatuses ?? []).every((status) => status.ready),
      ) ?? pods.find((item) => item.status?.phase === "Running");
    const podName = safeName(pod?.metadata?.name ?? "", "pod");
    const shellPath = await (async () => {
      for (const candidate of ["/bin/bash", "/bin/sh", "/busybox/sh"]) {
        const available = await executor
          .exec(
            `sudo -n kubectl -n ${target.namespace} exec ${podName} -- ${candidate} -c true`,
            { timeout: 15_000 },
          )
          .then(() => true)
          .catch(() => false);
        if (available) return candidate;
      }
      return null;
    })();
    const shell = await executor.openShell(opts);
    shell.onClose(() => release());
    const command = shellPath
      ? `exec sudo -n kubectl -n ${target.namespace} exec -it ${podName} -- ${shellPath}`
      : `exec sudo -n kubectl -n ${target.namespace} debug -it pod/${podName} --image=busybox:1.36 --target=${safeServiceName} -- /bin/sh`;
    shell.stdin.write(`${command}\n`);
    return {
      ...shell,
      close(signal?: string) {
        try {
          shell.close(signal);
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

export async function scale(
  deploymentId: string,
  organizationId: string,
  workloadName: string,
  replicas: number,
): Promise<KubernetesInventory> {
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 50) {
    throw new ForbiddenError("Replicas must be an integer between 1 and 50.");
  }
  const target = await binding(deploymentId, organizationId);
  const workload = safeName(workloadName, "deployment name");
  await sshManager.withExecutor(target.serverId, async (executor) => {
    const prefix = `sudo -n kubectl -n ${target.namespace}`;
    const owned = await executor.exec(
      ownedResourceQuery(prefix, "deployment", workload, target.selector),
      { timeout: 30_000 },
    );
    assertOwnedResource(owned, workload);
    await executor.exec(`${prefix} scale deployment/${workload} --replicas=${replicas}`, {
      timeout: 30_000,
    });
    await executor.exec(`${prefix} rollout status deployment/${workload} --timeout=300s`, {
      timeout: 315_000,
    });
  });
  return inventory(deploymentId, organizationId);
}

export async function restart(
  deploymentId: string,
  organizationId: string,
  workloadName: string,
): Promise<KubernetesInventory> {
  const target = await binding(deploymentId, organizationId);
  const workload = safeName(workloadName, "deployment name");
  await sshManager.withExecutor(target.serverId, async (executor) => {
    const prefix = `sudo -n kubectl -n ${target.namespace}`;
    const owned = await executor.exec(
      ownedResourceQuery(prefix, "deployment", workload, target.selector),
      { timeout: 30_000 },
    );
    assertOwnedResource(owned, workload);
    await executor.exec(`${prefix} rollout restart deployment/${workload}`, { timeout: 30_000 });
    await executor.exec(`${prefix} rollout status deployment/${workload} --timeout=300s`, {
      timeout: 315_000,
    });
  });
  return inventory(deploymentId, organizationId);
}

export async function replacePod(
  deploymentId: string,
  organizationId: string,
  podName: string,
): Promise<KubernetesInventory> {
  const target = await binding(deploymentId, organizationId);
  const pod = safeName(podName, "pod name");
  await sshManager.withExecutor(target.serverId, async (executor) => {
    const prefix = `sudo -n kubectl -n ${target.namespace}`;
    const owned = await executor.exec(
      ownedResourceQuery(prefix, "pod", pod, target.selector),
      { timeout: 30_000 },
    );
    assertOwnedResource(owned, pod);

    const podRaw = await executor.exec(`${prefix} get pod/${pod} -o json`, {
      timeout: 30_000,
    });
    const podResource = JSON.parse(podRaw) as PodItem;
    const workload = safeName(
      podResource.metadata?.labels?.["openship.io/service-name"] ?? "",
      "deployment name",
    );
    const ownedWorkload = await executor.exec(
      ownedResourceQuery(prefix, "deployment", workload, target.selector),
      { timeout: 30_000 },
    );
    assertOwnedResource(ownedWorkload, workload);

    await executor.exec(`${prefix} delete pod/${pod} --wait=false`, { timeout: 30_000 });
    await executor.exec(`${prefix} rollout status deployment/${workload} --timeout=300s`, {
      timeout: 315_000,
    });
  });
  return inventory(deploymentId, organizationId);
}
