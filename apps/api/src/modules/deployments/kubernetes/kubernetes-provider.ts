import type { CommandExecutor, ResourceConfig } from "@repo/adapters";
import { resolvePublicUrlPlaceholders } from "@repo/core";

const DNS_LABEL_MAX = 63;
const DEFAULT_STACK_ROLLOUT_TIMEOUT_SECONDS = 900;
const DEFAULT_PVC_SIZE = "10Gi";

export interface KubernetesDeployInput {
  projectId: string;
  projectSlug: string;
  deploymentId: string;
  imageRef: string;
  port: number;
  envVars: Record<string, string>;
  resources: ResourceConfig;
  replicas?: number;
  namespace?: string;
  rolloutTimeoutSeconds?: number;
  /** Command used on the managed cluster server. Defaults to non-interactive
   * sudo because K3s installs its kubeconfig root-readable by default. */
  kubectlCommand?: "kubectl" | "sudo -n kubectl";
  registryAuth?: {
    server: string;
    username: string;
    password: string;
  };
}

export interface KubernetesDeployResult {
  workloadId: string;
  namespace: string;
  deploymentName: string;
  serviceName: string;
  nodePort: number;
}

export interface KubernetesStackService {
  name: string;
  image: string;
  ports?: string[];
  exposedPort?: string;
  exposed?: boolean;
  environment?: Record<string, string>;
  dependsOn?: string[];
  volumes?: string[];
  command?: string;
  replicas?: number;
}

export interface KubernetesStackDeployInput {
  projectId: string;
  projectSlug: string;
  deploymentId: string;
  services: KubernetesStackService[];
  resources: ResourceConfig;
  defaultReplicas?: number;
  namespace?: string;
  rolloutTimeoutSeconds?: number;
  kubectlCommand?: "kubectl" | "sudo -n kubectl";
  registryAuth?: KubernetesDeployInput["registryAuth"];
  /** StorageClass used for Compose named volumes. Undefined deliberately uses
   * the cluster's default StorageClass. */
  storageClassName?: string;
  /** Requested capacity for each Compose named volume. */
  defaultVolumeSize?: string;
  /** Host clients use to reach exposed NodePorts. */
  publicHost?: string;
}

export interface KubernetesStackDeployResult {
  workloadId: string;
  namespace: string;
  deployments: string[];
  services: Array<{
    name: string;
    serviceName: string;
    port: number;
    nodePort?: number;
  }>;
}

type KubernetesObject = Record<string, unknown>;

function dnsLabel(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DNS_LABEL_MAX)
    .replace(/-+$/g, "");
  return normalized || fallback;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function resourceQuantity(resources: ResourceConfig): {
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
} {
  const cpu = Math.max(resources.cpuCores ?? 0.25, 0.05);
  const memoryMb = Math.max(resources.memoryMb ?? 256, 64);
  return {
    requests: {
      cpu: `${Math.max(Math.round(cpu * 500), 25)}m`,
      memory: `${Math.max(Math.round(memoryMb / 2), 32)}Mi`,
    },
    limits: {
      cpu: `${Math.round(cpu * 1000)}m`,
      memory: `${Math.round(memoryMb)}Mi`,
    },
  };
}

function servicePort(service: KubernetesStackService): number {
  const raw = service.exposedPort ?? service.ports?.[0];
  const containerSide = raw?.trim().split(":").pop()?.split("/")[0];
  const port = Number(containerSide);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Kubernetes service "${service.name}" needs a valid container port.`);
  }
  return port;
}

interface ParsedNamedVolume {
  source: string;
  target: string;
  readOnly: boolean;
}

function parseNamedVolume(raw: string, serviceName: string): ParsedNamedVolume {
  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `Kubernetes stack service "${serviceName}" has invalid volume "${raw}". Expected named-volume:/container/path[:ro].`,
    );
  }
  const [source, target, mode] = parts;
  if (
    !source ||
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.includes("\\") ||
    source.includes("/")
  ) {
    throw new Error(
      `Kubernetes stack service "${serviceName}" uses host bind mount "${raw}". Kubernetes stack mode supports named volumes only.`,
    );
  }
  if (!target?.startsWith("/")) {
    throw new Error(
      `Kubernetes stack service "${serviceName}" volume "${raw}" needs an absolute container path.`,
    );
  }
  if (mode && mode !== "ro" && mode !== "rw") {
    throw new Error(
      `Kubernetes stack service "${serviceName}" volume "${raw}" has unsupported mode "${mode}".`,
    );
  }
  return { source, target, readOnly: mode === "ro" };
}

function assertSupportedStackService(service: KubernetesStackService): void {
  if (!service.image?.trim()) {
    throw new Error(
      `Kubernetes stack service "${service.name}" must use a published image. Source builds are not supported in stack mode yet.`,
    );
  }
  if (service.command?.trim()) {
    throw new Error(
      `Kubernetes stack service "${service.name}" has a custom command. Command translation is not supported yet.`,
    );
  }
  for (const volume of service.volumes ?? []) parseNamedVolume(volume, service.name);
}

function orderStackServices(services: KubernetesStackService[]): KubernetesStackService[] {
  const byName = new Map(services.map((service) => [service.name, service]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: KubernetesStackService[] = [];

  const visit = (service: KubernetesStackService) => {
    if (visited.has(service.name)) return;
    if (visiting.has(service.name)) {
      throw new Error(`Kubernetes stack has a dependency cycle involving "${service.name}".`);
    }
    visiting.add(service.name);
    for (const dependency of service.dependsOn ?? []) {
      const dependencyService = byName.get(dependency);
      if (dependencyService) visit(dependencyService);
    }
    visiting.delete(service.name);
    visited.add(service.name);
    ordered.push(service);
  };

  for (const service of services) visit(service);
  return ordered;
}

function dockerConfigJson(auth: NonNullable<KubernetesDeployInput["registryAuth"]>): string {
  const token = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
  return Buffer.from(
    JSON.stringify({
      auths: {
        [auth.server]: {
          username: auth.username,
          password: auth.password,
          auth: token,
        },
      },
    }),
  ).toString("base64");
}

export function buildKubernetesObjects(input: KubernetesDeployInput): {
  namespace: string;
  deploymentName: string;
  serviceName: string;
  objects: KubernetesObject[];
} {
  const slug = dnsLabel(input.projectSlug, "app");
  const namespace = dnsLabel(input.namespace ?? `openship-${slug}`, "openship-app");
  const deploymentName = dnsLabel(slug, "app");
  const serviceName = `${deploymentName}-web`.slice(0, DNS_LABEL_MAX);
  const labels = {
    "app.kubernetes.io/name": deploymentName,
    "app.kubernetes.io/managed-by": "openship",
    "openship.io/project-id": input.projectId,
  };
  const podAnnotations = {
    "openship.io/deployment-id": input.deploymentId,
  };
  const secretName = `${deploymentName}-env`.slice(0, DNS_LABEL_MAX);
  const imagePullSecretName = `${deploymentName}-registry`.slice(0, DNS_LABEL_MAX);
  const quantities = resourceQuantity(input.resources);

  const objects: KubernetesObject[] = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: namespace,
        labels: {
          "app.kubernetes.io/managed-by": "openship",
          "openship.io/project-id": input.projectId,
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName, namespace, labels },
      type: "Opaque",
      stringData: input.envVars,
    },
  ];

  if (input.registryAuth) {
    objects.push({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: imagePullSecretName, namespace, labels },
      type: "kubernetes.io/dockerconfigjson",
      data: { ".dockerconfigjson": dockerConfigJson(input.registryAuth) },
    });
  }

  objects.push(
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: deploymentName,
        namespace,
        labels,
        annotations: { "openship.io/deployment-id": input.deploymentId },
      },
      spec: {
        replicas: positiveInt(input.replicas, 1),
        revisionHistoryLimit: 5,
        progressDeadlineSeconds: positiveInt(input.rolloutTimeoutSeconds, 300),
        strategy: {
          type: "RollingUpdate",
          rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
        },
        selector: { matchLabels: { "openship.io/project-id": input.projectId } },
        template: {
          metadata: { labels, annotations: podAnnotations },
          spec: {
            ...(input.registryAuth ? { imagePullSecrets: [{ name: imagePullSecretName }] } : {}),
            securityContext: {
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [
              {
                name: "app",
                image: input.imageRef,
                imagePullPolicy: "IfNotPresent",
                ports: [{ name: "http", containerPort: input.port, protocol: "TCP" }],
                envFrom: [{ secretRef: { name: secretName } }],
                resources: quantities,
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ["ALL"] },
                },
                readinessProbe: {
                  tcpSocket: { port: "http" },
                  initialDelaySeconds: 2,
                  periodSeconds: 5,
                  timeoutSeconds: 2,
                  failureThreshold: 12,
                },
                livenessProbe: {
                  tcpSocket: { port: "http" },
                  initialDelaySeconds: 20,
                  periodSeconds: 10,
                  timeoutSeconds: 2,
                  failureThreshold: 6,
                },
              },
            ],
          },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: serviceName, namespace, labels },
      spec: {
        type: "NodePort",
        selector: { "openship.io/project-id": input.projectId },
        ports: [{ name: "http", port: input.port, targetPort: "http", protocol: "TCP" }],
      },
    },
  );

  return { namespace, deploymentName, serviceName, objects };
}

export function buildKubernetesStackObjects(input: KubernetesStackDeployInput): {
  namespace: string;
  deployments: string[];
  serviceDescriptors: Array<{
    name: string;
    serviceName: string;
    port: number;
    exposed: boolean;
  }>;
  objects: KubernetesObject[];
} {
  const projectSlug = dnsLabel(input.projectSlug, "stack");
  const namespace = dnsLabel(input.namespace ?? `openship-${projectSlug}`, "openship-stack");
  const quantities = resourceQuantity(input.resources);
  const projectLabels = {
    "app.kubernetes.io/managed-by": "openship",
    "openship.io/project-id": input.projectId,
  };
  const objects: KubernetesObject[] = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace, labels: projectLabels },
    },
  ];
  const deployments: string[] = [];
  const serviceDescriptors: Array<{
    name: string;
    serviceName: string;
    port: number;
    exposed: boolean;
  }> = [];
  const seenNames = new Set<string>();
  const volumeClaims = new Map<string, string>();
  const seenClaimNames = new Map<string, string>();

  for (const service of input.services) {
    assertSupportedStackService(service);
    for (const volume of service.volumes ?? []) {
      const parsed = parseNamedVolume(volume, service.name);
      if (volumeClaims.has(parsed.source)) continue;
      const claimName = `data-${dnsLabel(parsed.source, "volume")}`.slice(0, DNS_LABEL_MAX);
      const collision = seenClaimNames.get(claimName);
      if (collision && collision !== parsed.source) {
        throw new Error(
          `Kubernetes volume names "${collision}" and "${parsed.source}" normalize to the same PVC name.`,
        );
      }
      seenClaimNames.set(claimName, parsed.source);
      volumeClaims.set(parsed.source, claimName);
      objects.push({
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: claimName, namespace, labels: projectLabels },
        spec: {
          accessModes: ["ReadWriteOnce"],
          ...(input.storageClassName
            ? { storageClassName: safeKubectlName(input.storageClassName) }
            : {}),
          resources: {
            requests: { storage: input.defaultVolumeSize ?? DEFAULT_PVC_SIZE },
          },
        },
      });
    }
  }

  for (const service of orderStackServices(input.services)) {
    assertSupportedStackService(service);
    const name = dnsLabel(service.name, "service");
    if (seenNames.has(name)) {
      throw new Error(`Kubernetes stack contains duplicate service name "${name}".`);
    }
    seenNames.add(name);
    const port = servicePort(service);
    const parsedVolumes = (service.volumes ?? []).map((volume) =>
      parseNamedVolume(volume, service.name),
    );
    const requestedReplicas = positiveInt(
      service.replicas,
      service.exposed ? positiveInt(input.defaultReplicas, 2) : 1,
    );
    // ReadWriteOnce is the portable baseline for the default cluster storage.
    // A stateful service must not run multiple writers against that claim.
    const replicas = parsedVolumes.length > 0 ? 1 : requestedReplicas;
    const labels = {
      ...projectLabels,
      "app.kubernetes.io/name": name,
      "openship.io/service-name": name,
    };
    const secretName = `${name}-env`.slice(0, DNS_LABEL_MAX);
    const serviceName = name;

    objects.push({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName, namespace, labels },
      type: "Opaque",
      stringData: service.environment ?? {},
    });

    objects.push({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name,
        namespace,
        labels,
        annotations: { "openship.io/deployment-id": input.deploymentId },
      },
      spec: {
        replicas,
        revisionHistoryLimit: 5,
        progressDeadlineSeconds: positiveInt(
          input.rolloutTimeoutSeconds,
          DEFAULT_STACK_ROLLOUT_TIMEOUT_SECONDS,
        ),
        strategy: {
          ...(parsedVolumes.length > 0
            ? { type: "Recreate" }
            : {
                type: "RollingUpdate",
                rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
              }),
        },
        selector: { matchLabels: { "openship.io/service-name": name } },
        template: {
          metadata: {
            labels,
            annotations: { "openship.io/deployment-id": input.deploymentId },
          },
          spec: {
            ...(input.registryAuth
              ? { imagePullSecrets: [{ name: `${projectSlug}-registry` }] }
              : {}),
            securityContext: { seccompProfile: { type: "RuntimeDefault" } },
            topologySpreadConstraints:
              replicas > 1
                ? [
                    {
                      maxSkew: 1,
                      topologyKey: "kubernetes.io/hostname",
                      whenUnsatisfiable: "DoNotSchedule",
                      labelSelector: {
                        matchLabels: { "openship.io/service-name": name },
                      },
                    },
                  ]
                : undefined,
            containers: [
              {
                name,
                image: service.image,
                imagePullPolicy: "IfNotPresent",
                ports: [{ name: "tcp", containerPort: port, protocol: "TCP" }],
                envFrom: [{ secretRef: { name: secretName } }],
                ...(parsedVolumes.length > 0
                  ? {
                      volumeMounts: parsedVolumes.map((volume) => ({
                        name: dnsLabel(volume.source, "data"),
                        mountPath: volume.target,
                        readOnly: volume.readOnly,
                      })),
                    }
                  : {}),
                resources: quantities,
                securityContext: {
                  allowPrivilegeEscalation: false,
                },
                readinessProbe: {
                  tcpSocket: { port: "tcp" },
                  initialDelaySeconds: 2,
                  periodSeconds: 5,
                  timeoutSeconds: 2,
                  failureThreshold: 12,
                },
                livenessProbe: {
                  tcpSocket: { port: "tcp" },
                  initialDelaySeconds: 20,
                  periodSeconds: 10,
                  timeoutSeconds: 2,
                  failureThreshold: 6,
                },
              },
            ],
            ...(parsedVolumes.length > 0
              ? {
                  volumes: parsedVolumes.map((volume) => ({
                    name: dnsLabel(volume.source, "data"),
                    persistentVolumeClaim: {
                      claimName: volumeClaims.get(volume.source),
                      readOnly: volume.readOnly,
                    },
                  })),
                }
              : {}),
          },
        },
      },
    });

    objects.push({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: serviceName, namespace, labels },
      spec: {
        type: service.exposed ? "NodePort" : "ClusterIP",
        selector: { "openship.io/service-name": name },
        ports: [{ name: "tcp", port, targetPort: "tcp", protocol: "TCP" }],
      },
    });

    if (replicas > 1) {
      objects.push({
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: { name: `${name}-pdb`.slice(0, DNS_LABEL_MAX), namespace, labels },
        spec: {
          maxUnavailable: 1,
          selector: { matchLabels: { "openship.io/service-name": name } },
        },
      });
    }

    deployments.push(name);
    serviceDescriptors.push({
      name: service.name,
      serviceName,
      port,
      exposed: Boolean(service.exposed),
    });
  }

  if (input.registryAuth) {
    objects.splice(1, 0, {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: `${projectSlug}-registry`,
        namespace,
        labels: projectLabels,
      },
      type: "kubernetes.io/dockerconfigjson",
      data: { ".dockerconfigjson": dockerConfigJson(input.registryAuth) },
    });
  }

  return { namespace, deployments, serviceDescriptors, objects };
}

function safeKubectlName(value: string): string {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)) {
    throw new Error(`Unsafe Kubernetes resource name: ${value}`);
  }
  return value;
}

function kubernetesObjectName(object: KubernetesObject): string {
  const metadata = object.metadata;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("name" in metadata) ||
    typeof metadata.name !== "string"
  ) {
    throw new Error(`Kubernetes ${String(object.kind ?? "resource")} is missing metadata.name`);
  }
  return safeKubectlName(metadata.name);
}

export async function deployToKubernetes(
  executor: CommandExecutor,
  input: KubernetesDeployInput,
  onLog?: (message: string) => void,
): Promise<KubernetesDeployResult> {
  const built = buildKubernetesObjects(input);
  const namespace = safeKubectlName(built.namespace);
  const deploymentName = safeKubectlName(built.deploymentName);
  const serviceName = safeKubectlName(built.serviceName);
  const remoteDir = `/tmp/openship-kubernetes/${dnsLabel(input.deploymentId, "deployment")}`;
  const manifestPath = `${remoteDir}/manifest.json`;
  const kubectl = input.kubectlCommand ?? "sudo -n kubectl";

  await executor.mkdir(remoteDir);
  try {
    await executor.writeFile(
      manifestPath,
      JSON.stringify({ apiVersion: "v1", kind: "List", items: built.objects }),
    );
    onLog?.(`Applying Kubernetes resources in namespace ${namespace}...`);
    await executor.exec(
      `${kubectl} apply --server-side --field-manager=openship -f ${manifestPath}`,
      { timeout: 120_000 },
    );
    const timeout = positiveInt(input.rolloutTimeoutSeconds, 300);
    onLog?.(`Waiting for deployment/${deploymentName} rollout...`);
    await executor.exec(
      `${kubectl} -n ${namespace} rollout status deployment/${deploymentName} --timeout=${timeout}s`,
      { timeout: (timeout + 15) * 1_000 },
    );
    const nodePortRaw = await executor.exec(
      `${kubectl} -n ${namespace} get service ${serviceName} -o jsonpath='{.spec.ports[0].nodePort}'`,
      { timeout: 30_000 },
    );
    const nodePort = Number(nodePortRaw.trim().replace(/^'|'$/g, ""));
    if (!Number.isInteger(nodePort) || nodePort < 30000 || nodePort > 32767) {
      throw new Error(`Kubernetes did not assign a valid NodePort to service/${serviceName}`);
    }
    return {
      workloadId: `kubernetes:${namespace}/${deploymentName}`,
      namespace,
      deploymentName,
      serviceName,
      nodePort,
    };
  } finally {
    await executor.rm(remoteDir).catch(() => {});
  }
}

export async function deployStackToKubernetes(
  executor: CommandExecutor,
  input: KubernetesStackDeployInput,
  onLog?: (message: string) => void,
): Promise<KubernetesStackDeployResult> {
  const built = buildKubernetesStackObjects(input);
  const namespace = safeKubectlName(built.namespace);
  const remoteDir = `/tmp/openship-kubernetes/${dnsLabel(input.deploymentId, "deployment")}`;
  const foundationManifestPath = `${remoteDir}/foundation.json`;
  const kubectl = input.kubectlCommand ?? "sudo -n kubectl";
  const timeout = positiveInt(
    input.rolloutTimeoutSeconds,
    DEFAULT_STACK_ROLLOUT_TIMEOUT_SECONDS,
  );
  const deploymentObjects = new Map(
    built.objects
      .filter((object) => object.kind === "Deployment")
      .map((object) => [kubernetesObjectName(object), object]),
  );
  const foundationObjects = built.objects.filter((object) => object.kind !== "Deployment");

  await executor.mkdir(remoteDir);
  try {
    await executor.writeFile(
      foundationManifestPath,
      JSON.stringify({ apiVersion: "v1", kind: "List", items: foundationObjects }),
    );
    onLog?.(`Applying Kubernetes stack foundation in ${namespace}...`);
    await executor.exec(
      `${kubectl} apply --server-side --field-manager=openship -f ${foundationManifestPath}`,
      { timeout: 120_000 },
    );

    // Services are part of the foundation, so Kubernetes has allocated every
    // exposed NodePort before any workload starts. Resolve catalog
    // {{publicUrl:service}} placeholders now and re-apply only the Secrets.
    // Internal-only references use cluster DNS; exposed references use the
    // externally reachable cluster host + assigned NodePort.
    const services: KubernetesStackDeployResult["services"] = [];
    const publicUrls = new Map<string, string>();
    for (const descriptor of built.serviceDescriptors) {
      let nodePort: number | undefined;
      if (descriptor.exposed) {
        const raw = await executor.exec(
          `${kubectl} -n ${namespace} get service ${safeKubectlName(descriptor.serviceName)} -o jsonpath='{.spec.ports[0].nodePort}'`,
          { timeout: 30_000 },
        );
        nodePort = Number(raw.trim().replace(/^'|'$/g, ""));
        if (!Number.isInteger(nodePort) || nodePort < 30000 || nodePort > 32767) {
          throw new Error(
            `Kubernetes did not assign a valid NodePort to service/${descriptor.serviceName}`,
          );
        }
      }
      const internalUrl = `http://${descriptor.serviceName}:${descriptor.port}`;
      publicUrls.set(
        descriptor.name,
        nodePort && input.publicHost ? `http://${input.publicHost}:${nodePort}` : internalUrl,
      );
      publicUrls.set(`${descriptor.name}:${descriptor.port}`, internalUrl);
      services.push({ ...descriptor, nodePort });
    }
    const secretObjects = built.objects
      .filter((object) => object.kind === "Secret" && object.stringData)
      .map((object) => ({
        ...object,
        stringData: resolvePublicUrlPlaceholders(
          object.stringData as Record<string, string>,
          (name, port) => publicUrls.get(port === undefined ? name : `${name}:${port}`),
        ),
      }));
    if (secretObjects.length > 0) {
      const secretsManifestPath = `${remoteDir}/secrets.json`;
      await executor.writeFile(
        secretsManifestPath,
        JSON.stringify({ apiVersion: "v1", kind: "List", items: secretObjects }),
      );
      await executor.exec(
        `${kubectl} apply --server-side --field-manager=openship -f ${secretsManifestPath}`,
        { timeout: 120_000 },
      );
    }

    for (const [index, deployment] of built.deployments.entries()) {
      const safeDeployment = safeKubectlName(deployment);
      const deploymentObject = deploymentObjects.get(safeDeployment);
      if (!deploymentObject) {
        throw new Error(`Missing Kubernetes Deployment manifest for ${safeDeployment}`);
      }
      const deploymentManifestPath = `${remoteDir}/deployment-${safeDeployment}.json`;
      await executor.writeFile(deploymentManifestPath, JSON.stringify(deploymentObject));
      onLog?.(
        `Deploying service ${index + 1}/${built.deployments.length}: deployment/${safeDeployment}...`,
      );
      await executor.exec(
        `${kubectl} apply --server-side --field-manager=openship -f ${deploymentManifestPath}`,
        { timeout: 120_000 },
      );
      onLog?.(`Waiting for deployment/${safeDeployment} before starting the next service...`);
      await executor.exec(
        `${kubectl} -n ${namespace} rollout status deployment/${safeDeployment} --timeout=${timeout}s`,
        { timeout: (timeout + 15) * 1_000 },
      );
    }

    return {
      workloadId: `kubernetes-stack:${namespace}`,
      namespace,
      deployments: built.deployments,
      services,
    };
  } finally {
    await executor.rm(remoteDir).catch(() => {});
  }
}
