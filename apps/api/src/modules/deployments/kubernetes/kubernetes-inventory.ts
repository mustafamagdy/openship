export type KubernetesInventoryDeployment = {
  name: string;
  desired: number;
  ready: number;
  available: number;
  updated: number;
  unavailable: number;
};

export type KubernetesInventoryPod = {
  name: string;
  serviceName?: string;
  node?: string;
  phase?: string;
  podIP?: string;
  ready: boolean;
  restarts: number;
};

export type KubernetesInventorySummary = {
  deployments: number;
  desiredReplicas: number;
  readyReplicas: number;
  pods: number;
  readyPods: number;
  healthy: boolean;
};

/** A zero-replica deployment is stopped, not a healthy running workload. */
export function inventorySummary(
  deployments: KubernetesInventoryDeployment[],
  pods: KubernetesInventoryPod[],
): KubernetesInventorySummary {
  const desiredReplicas = deployments.reduce((total, item) => total + item.desired, 0);
  const readyReplicas = deployments.reduce((total, item) => total + item.ready, 0);
  const readyPods = pods.filter((pod) => pod.ready).length;
  return {
    deployments: deployments.length,
    desiredReplicas,
    readyReplicas,
    pods: pods.length,
    readyPods,
    healthy:
      deployments.length > 0 &&
      desiredReplicas > 0 &&
      desiredReplicas === readyReplicas &&
      pods.length === readyPods,
  };
}
