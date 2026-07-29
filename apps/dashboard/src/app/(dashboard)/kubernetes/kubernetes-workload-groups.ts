import type { KubernetesClusterOverview } from "@/lib/api/system";

type KubernetesWorkload = KubernetesClusterOverview["workloads"][number];

export interface KubernetesProjectGroup {
  key: string;
  projectId: string | null;
  projectName: string;
  namespace: string;
  serviceCount: number;
  desiredReplicas: number;
  readyReplicas: number;
  ready: boolean;
}

/**
 * The cluster API returns Kubernetes Deployments because that is the unit K8s
 * operates. The infrastructure UI is an OpenShip surface, so collapse those
 * deployments back into their owning project before rendering them.
 */
export function groupWorkloadsByProject(workloads: KubernetesWorkload[]): KubernetesProjectGroup[] {
  const groups = new Map<
    string,
    Omit<KubernetesProjectGroup, "ready"> & { allServicesReady: boolean }
  >();

  for (const workload of workloads) {
    // Legacy/unbound resources have no OpenShip project identity. Keep each one
    // independently visible instead of accidentally merging unrelated apps.
    const key = workload.projectId
      ? `project:${workload.projectId}`
      : `workload:${workload.namespace}/${workload.name}`;
    const current = groups.get(key);
    const serviceReady = workload.readyReplicas === workload.desiredReplicas;

    if (current) {
      current.serviceCount += 1;
      current.desiredReplicas += workload.desiredReplicas;
      current.readyReplicas += workload.readyReplicas;
      current.allServicesReady &&= serviceReady;
      continue;
    }

    groups.set(key, {
      key,
      projectId: workload.projectId,
      projectName: workload.projectName ?? workload.name,
      namespace: workload.namespace,
      serviceCount: 1,
      desiredReplicas: workload.desiredReplicas,
      readyReplicas: workload.readyReplicas,
      allServicesReady: serviceReady,
    });
  }

  return Array.from(groups.values())
    .map(({ allServicesReady, ...group }) => ({
      ...group,
      ready: allServicesReady,
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}
