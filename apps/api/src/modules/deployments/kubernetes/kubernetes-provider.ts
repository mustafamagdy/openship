import type { CommandExecutor, ResourceConfig } from "@repo/adapters";

const DNS_LABEL_MAX = 63;

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
            ...(input.registryAuth
              ? { imagePullSecrets: [{ name: imagePullSecretName }] }
              : {}),
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

function safeKubectlName(value: string): string {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)) {
    throw new Error(`Unsafe Kubernetes resource name: ${value}`);
  }
  return value;
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
