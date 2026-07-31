import { createHash } from "node:crypto";
import type { CommandExecutor, ResourceConfig } from "@repo/adapters";
import { resolvePublicUrlPlaceholders } from "@repo/core";

const DNS_LABEL_MAX = 63;
const DEFAULT_STACK_ROLLOUT_TIMEOUT_SECONDS = 900;
const DEFAULT_PVC_SIZE = "10Gi";
const MIN_KUBECTL_APPLY_TIMEOUT_MS = 120_000;
const MAX_KUBECTL_APPLY_TIMEOUT_MS = 900_000;
const KUBECTL_APPLY_TIMEOUT_PER_OBJECT_MS = 20_000;

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
  files?: Array<{ path: string; content: string }>;
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
    /** Every externally published container port, keyed by container port. */
    nodePorts?: Record<string, number>;
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

/**
 * Kubernetes namespaces are the ownership boundary for an OpenShip project.
 *
 * A human-readable slug alone is not an identity: two projects may have the
 * same name, and an app reinstall must not attach to another project's PVCs.
 * The project id is stable across redeploys, so it gives every project one
 * durable namespace while preserving its own state between deployment
 * revisions.
 */
function projectNamespace(projectSlug: string, projectId: string, fallback: string): string {
  // Keep this compact even if a future database uses a long project id. The
  // hash prevents truncation from turning two distinct ids into one namespace.
  const normalizedProjectId = dnsLabel(projectId, "project");
  const identity = `${normalizedProjectId.slice(0, 20)}-${createHash("sha256")
    .update(projectId)
    .digest("hex")
    .slice(0, 8)}`;
  const prefix = "openship-";
  const separator = "-";
  const slugBudget = DNS_LABEL_MAX - prefix.length - separator.length - identity.length;
  const slug = dnsLabel(projectSlug, "app").slice(0, Math.max(slugBudget, 1));
  return dnsLabel(`${prefix}${slug}-${identity}`, fallback);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function kubectlApplyTimeoutMs(objectCount: number): number {
  return Math.min(
    MAX_KUBECTL_APPLY_TIMEOUT_MS,
    Math.max(MIN_KUBECTL_APPLY_TIMEOUT_MS, objectCount * KUBECTL_APPLY_TIMEOUT_PER_OBJECT_MS),
  );
}

function resourceQuantity(resources: ResourceConfig, requestUnits = 1): {
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
} {
  const cpu = Math.max(resources.cpuCores ?? 0.25, 0.05);
  const memoryMb = Math.max(resources.memoryMb ?? 256, 64);
  const units = Math.max(requestUnits, 1);
  return {
    requests: {
      // A stack's resource selection is its shared scheduling budget, not a
      // request to reserve the full budget for every service and replica.
      // Keep portable minimums while distributing its requests across all
      // pods; limits remain per-service burst ceilings.
      cpu: `${Math.max(Math.round((cpu * 500) / units), 25)}m`,
      memory: `${Math.max(Math.round(memoryMb / (2 * units)), 32)}Mi`,
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

/**
 * A Compose service can intentionally publish more than one port (MinIO's S3
 * API + console is the common example). Keep the explicit exposedPort first so
 * it remains the service's primary URL, while exposing every declared container
 * port through the same Kubernetes Service.
 */
function servicePorts(service: KubernetesStackService): number[] {
  const primary = servicePort(service);
  const ports = [primary];
  for (const raw of service.ports ?? []) {
    const containerSide = raw.trim().split(":").pop()?.split("/")[0];
    const port = Number(containerSide);
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && !ports.includes(port)) {
      ports.push(port);
    }
  }
  return ports;
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
  for (const volume of service.volumes ?? []) parseNamedVolume(volume, service.name);
}

/**
 * Compose string commands replace the image CMD while preserving its ENTRYPOINT.
 * Kubernetes has the same behavior when the tokens are supplied as `args`.
 *
 * The curated catalog deliberately accepts only literal argv-style commands:
 * shell expansion, redirects, pipes, and control operators are unsafe to
 * reinterpret and must be modelled as an image entrypoint instead.
 */
function commandArgs(command: string | undefined, serviceName: string): string[] | undefined {
  const source = command?.trim();
  if (!source) return undefined;

  const args: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const push = () => {
    if (token) args.push(token);
    token = "";
  };

  for (const char of source) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if (/[|&;<>`$]/.test(char)) {
      throw new Error(
        `Kubernetes stack service "${serviceName}" uses shell syntax in its command. Use literal command arguments only.`,
      );
    }
    token += char;
  }

  if (escaped || quote) {
    throw new Error(`Kubernetes stack service "${serviceName}" has an unterminated command argument.`);
  }
  push();
  if (!args.length) return undefined;
  return args;
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

function stackReplicaUnits(input: KubernetesStackDeployInput): number {
  return input.services.reduce((total, service) => {
    const parsedVolumes = (service.volumes ?? []).map((volume) =>
      parseNamedVolume(volume, service.name),
    );
    const requested = positiveInt(
      service.replicas,
      service.exposed ? positiveInt(input.defaultReplicas, 2) : 1,
    );
    // A ReadWriteOnce PVC cannot safely be scheduled for more than one writer.
    return total + (parsedVolumes.length > 0 ? 1 : requested);
  }, 0);
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
  const namespace = dnsLabel(
    input.namespace ?? projectNamespace(input.projectSlug, input.projectId, "openship-app"),
    "openship-app",
  );
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
    ports: number[];
    exposed: boolean;
  }>;
  objects: KubernetesObject[];
} {
  const projectSlug = dnsLabel(input.projectSlug, "stack");
  const namespace = dnsLabel(
    input.namespace ?? projectNamespace(input.projectSlug, input.projectId, "openship-stack"),
    "openship-stack",
  );
  const quantities = resourceQuantity(input.resources, stackReplicaUnits(input));
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
    ports: number[];
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
    const ports = servicePorts(service);
    const port = ports[0]!;
    const args = commandArgs(service.command, service.name);
    const parsedVolumes = (service.volumes ?? []).map((volume) =>
      parseNamedVolume(volume, service.name),
    );
    const files = (service.files ?? []).filter(
      (file) => file.path.startsWith("/") && file.content.length > 0,
    );
    const filesVolumeName = `${name}-files`.slice(0, DNS_LABEL_MAX);
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

    if (files.length > 0) {
      objects.push({
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: filesVolumeName, namespace, labels },
        data: Object.fromEntries(files.map((file, index) => [`file-${index}`, file.content])),
      });
    }

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
                ...(args ? { args } : {}),
                ports: ports.map((containerPort) => ({
                  name: `tcp-${containerPort}`,
                  containerPort,
                  protocol: "TCP",
                })),
                envFrom: [{ secretRef: { name: secretName } }],
                ...(parsedVolumes.length > 0 || files.length > 0
                  ? {
                      volumeMounts: [
                        ...parsedVolumes.map((volume) => ({
                          name: dnsLabel(volume.source, "data"),
                          mountPath: volume.target,
                          readOnly: volume.readOnly,
                        })),
                        ...files.map((file, index) => ({
                          name: filesVolumeName,
                          mountPath: file.path,
                          subPath: `file-${index}`,
                          readOnly: true,
                        })),
                      ],
                    }
                  : {}),
                resources: quantities,
                securityContext: {
                  allowPrivilegeEscalation: false,
                },
                readinessProbe: {
                  tcpSocket: { port: `tcp-${port}` },
                  initialDelaySeconds: 2,
                  periodSeconds: 5,
                  timeoutSeconds: 2,
                  failureThreshold: 12,
                },
                livenessProbe: {
                  tcpSocket: { port: `tcp-${port}` },
                  initialDelaySeconds: 20,
                  periodSeconds: 10,
                  timeoutSeconds: 2,
                  failureThreshold: 6,
                },
              },
            ],
            ...(parsedVolumes.length > 0 || files.length > 0
              ? {
                  volumes: [
                    ...parsedVolumes.map((volume) => ({
                      name: dnsLabel(volume.source, "data"),
                      persistentVolumeClaim: {
                        claimName: volumeClaims.get(volume.source),
                        readOnly: volume.readOnly,
                      },
                    })),
                    ...(files.length > 0
                      ? [{ name: filesVolumeName, configMap: { name: filesVolumeName } }]
                      : []),
                  ],
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
        ports: ports.map((servicePort) => ({
          name: `tcp-${servicePort}`,
          port: servicePort,
          targetPort: `tcp-${servicePort}`,
          protocol: "TCP",
        })),
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
      ports,
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
      { timeout: kubectlApplyTimeoutMs(foundationObjects.length) },
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
      let nodePorts: Record<string, number> | undefined;
      if (descriptor.exposed) {
        const raw = await executor.exec(
          `${kubectl} -n ${namespace} get service ${safeKubectlName(descriptor.serviceName)} -o jsonpath='{range .spec.ports[*]}{.port}={.nodePort}{"\\n"}{end}'`,
          { timeout: 30_000 },
        );
        const pairs = raw.trim().replace(/^'|'$/g, "").split(/\s+/).filter(Boolean);
        nodePorts = Object.fromEntries(pairs.map((pair) => {
          const [port, allocated] = pair.split("=");
          return [port!, Number(allocated)];
        }));
        nodePort = nodePorts[String(descriptor.port)];
        if (
          !Number.isInteger(nodePort) || nodePort < 30000 || nodePort > 32767 ||
          descriptor.ports.some((port) => {
            const allocated = nodePorts![String(port)];
            return !Number.isInteger(allocated) || allocated < 30000 || allocated > 32767;
          })
        ) {
          throw new Error(
            `Kubernetes did not assign valid NodePorts to service/${descriptor.serviceName}`,
          );
        }
      }
      const internalUrl = `http://${descriptor.serviceName}:${descriptor.port}`;
      publicUrls.set(
        descriptor.name,
        nodePort && input.publicHost ? `http://${input.publicHost}:${nodePort}` : internalUrl,
      );
      for (const port of descriptor.ports) {
        const internalPortUrl = `http://${descriptor.serviceName}:${port}`;
        const allocated = nodePorts?.[String(port)];
        publicUrls.set(
          `${descriptor.name}:${port}`,
          allocated && input.publicHost ? `http://${input.publicHost}:${allocated}` : internalPortUrl,
        );
      }
      services.push({ ...descriptor, nodePort, ...(nodePorts ? { nodePorts } : {}) });
    }
    const configurationObjects = built.objects
      .filter(
        (object) =>
          (object.kind === "Secret" && object.stringData) ||
          (object.kind === "ConfigMap" && object.data),
      )
      .map((object) => ({
        ...object,
        [object.kind === "Secret" ? "stringData" : "data"]: resolvePublicUrlPlaceholders(
          (object.kind === "Secret" ? object.stringData : object.data) as Record<string, string>,
          (name, port) => publicUrls.get(port === undefined ? name : `${name}:${port}`),
        ),
      }));
    if (configurationObjects.length > 0) {
      const configurationManifestPath = `${remoteDir}/configuration.json`;
      await executor.writeFile(
        configurationManifestPath,
        JSON.stringify({ apiVersion: "v1", kind: "List", items: configurationObjects }),
      );
      await executor.exec(
        `${kubectl} apply --server-side --field-manager=openship -f ${configurationManifestPath}`,
        { timeout: kubectlApplyTimeoutMs(configurationObjects.length) },
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
