export type OwnedKubernetesResource = "deployment" | "pod";

export function isValidReplicaCount(replicas: number): boolean {
  return Number.isInteger(replicas) && replicas >= 0 && replicas <= 50;
}

/**
 * Query one named resource while retaining the OpenShip ownership label guard.
 *
 * kubectl's TYPE [NAME | -l label] grammar does not allow a resource/name
 * argument and a selector in the same get command. metadata.name is a
 * universally supported Kubernetes field selector, so it safely narrows the
 * label-scoped list without weakening the ownership check.
 */
export function ownedResourceQuery(
  prefix: string,
  resource: OwnedKubernetesResource,
  name: string,
  selector: string,
): string {
  return `${prefix} get ${resource} -l ${selector} --field-selector metadata.name=${name} -o name`;
}
