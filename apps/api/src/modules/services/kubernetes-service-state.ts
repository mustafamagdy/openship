import type { Service } from "@repo/db";
import type { ServiceContainerState } from "@repo/core";
import type { KubernetesInventory } from "../deployments/kubernetes/kubernetes-control.service";
import type { LiveServiceContainer } from "./service.service";

/**
 * Convert Kubernetes' pod-level truth into the same per-service live view used
 * by Docker and cloud runtimes. A Kubernetes stack has no Docker container on
 * the build/edge host, so asking that host for `docker ps` necessarily reports
 * every service as stopped even while all pods are ready.
 */
export function kubernetesServiceContainers(
  services: Service[],
  inventory: KubernetesInventory,
  hints: Map<string, { imageRef?: string | null; hostPort?: number | null }>,
): LiveServiceContainer[] {
  return services
    .filter((service) => service.enabled !== false)
    .map((service) => {
      const pods = inventory.pods.filter((pod) => pod.serviceName === service.name);
      const readyPod = pods.find((pod) => pod.ready);
      const serviceResource = inventory.services.find((item) => item.name === service.name);
      const hasFailed = pods.some((pod) => pod.phase === "Failed");
      const status: ServiceContainerState = readyPod
        ? "running"
        : hasFailed
          ? "failed"
          : pods.length > 0
            ? "starting"
            : "stopped";
      const hint = hints.get(service.id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        // A pod name is deliberately not exposed as a Docker container id.
        // Kubernetes actions resolve the current pod by service label.
        containerId: null,
        status,
        ip: readyPod?.podIP ?? pods.find((pod) => pod.podIP)?.podIP ?? null,
        hostPort:
          serviceResource?.nodePort ??
          serviceResource?.port ??
          hint?.hostPort ??
          null,
        imageRef: hint?.imageRef ?? service.image ?? null,
        matchedBy: null,
        duplicates: [],
      };
    });
}
