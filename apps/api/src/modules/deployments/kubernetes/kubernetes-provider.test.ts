import { describe, expect, it } from "vitest";
import type { CommandExecutor } from "@repo/adapters";
import {
  buildKubernetesObjects,
  buildKubernetesStackObjects,
  deployStackToKubernetes,
  deployToKubernetes,
} from "./kubernetes-provider";

const base = {
  projectId: "project-123",
  projectSlug: "My API",
  deploymentId: "dep-456",
  imageRef: "registry.example/openship-my-api@sha256:abc",
  port: 3000,
  envVars: { DATABASE_URL: "postgres://internal" },
  resources: { cpuCores: 1, memoryMb: 512, diskMb: 1024 },
};

describe("Kubernetes provider", () => {
  it("builds namespaced, secure rolling-update resources", () => {
    const built = buildKubernetesObjects(base);
    expect(built.namespace).toBe("openship-my-api");
    expect(built.objects.map((item) => item.kind)).toEqual([
      "Namespace",
      "Secret",
      "Deployment",
      "Service",
    ]);
    const deployment = built.objects[2] as any;
    expect(deployment.spec.strategy.rollingUpdate).toEqual({
      maxSurge: 1,
      maxUnavailable: 0,
    });
    expect(deployment.spec.template.spec.securityContext.seccompProfile.type).toBe(
      "RuntimeDefault",
    );
    expect(deployment.spec.template.spec.containers[0].image).toBe(base.imageRef);
    expect(deployment.spec.template.spec.containers[0].securityContext.capabilities.drop).toEqual([
      "ALL",
    ]);
  });

  it("applies, waits for rollout, and returns the allocated NodePort", async () => {
    const commands: string[] = [];
    const executor = {
      mkdir: async () => {},
      writeFile: async () => {},
      exec: async (command: string) => {
        commands.push(command);
        return command.includes("jsonpath") ? "31042" : "";
      },
      rm: async () => {},
    } as unknown as CommandExecutor;

    const result = await deployToKubernetes(executor, base);
    expect(result.nodePort).toBe(31042);
    expect(result.workloadId).toBe("kubernetes:openship-my-api/my-api");
    expect(commands.some((command) => command.startsWith("sudo -n kubectl apply"))).toBe(true);
    expect(commands.some((command) => command.includes("rollout status"))).toBe(true);
  });

  it("builds a multi-service stack with HA policy for exposed services", () => {
    const built = buildKubernetesStackObjects({
      projectId: "project-123",
      projectSlug: "boutique",
      deploymentId: "dep-stack",
      resources: base.resources,
      defaultReplicas: 3,
      services: [
        {
          name: "frontend",
          image: "example/frontend:v1",
          ports: ["8080"],
          exposed: true,
          environment: { CATALOG_ADDR: "catalog:3550" },
        },
        {
          name: "catalog",
          image: "example/catalog:v1",
          ports: ["3550"],
        },
      ],
    });

    expect(built.deployments).toEqual(["frontend", "catalog"]);
    const frontend = built.objects.find(
      (object: any) => object.kind === "Deployment" && object.metadata.name === "frontend",
    ) as any;
    expect(frontend.spec.replicas).toBe(3);
    expect(frontend.spec.template.spec.topologySpreadConstraints[0].topologyKey).toBe(
      "kubernetes.io/hostname",
    );
    const disruptionBudget = built.objects.find(
      (object: any) =>
        object.kind === "PodDisruptionBudget" && object.metadata.name === "frontend-pdb",
    ) as any;
    expect(disruptionBudget.spec.maxUnavailable).toBe(1);
    const catalog = built.objects.find(
      (object: any) => object.kind === "Deployment" && object.metadata.name === "catalog",
    ) as any;
    expect(catalog.spec.replicas).toBe(1);
  });

  it("translates named Compose volumes into shared PVC mounts", () => {
    const built = buildKubernetesStackObjects({
      projectId: "project-123",
      projectSlug: "supabase",
      deploymentId: "dep-stateful",
      resources: base.resources,
      defaultReplicas: 3,
      services: [
        {
          name: "db",
          image: "postgres:17",
          ports: ["5432"],
          volumes: ["supabase_db_data:/var/lib/postgresql/data"],
        },
        {
          name: "storage",
          image: "example/storage:v1",
          ports: ["5000"],
          volumes: ["supabase_storage_data:/var/lib/storage"],
        },
        {
          name: "imgproxy",
          image: "example/imgproxy:v1",
          ports: ["5001"],
          volumes: ["supabase_storage_data:/var/lib/storage:ro"],
        },
      ],
    });

    const claims = built.objects.filter(
      (object: any) => object.kind === "PersistentVolumeClaim",
    ) as any[];
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.metadata.name)).toEqual([
      "data-supabase-db-data",
      "data-supabase-storage-data",
    ]);
    expect(claims[0].spec.accessModes).toEqual(["ReadWriteOnce"]);
    expect(claims[0].spec.resources.requests.storage).toBe("10Gi");
    expect(claims[0].spec.storageClassName).toBeUndefined();

    const storage = built.objects.find(
      (object: any) => object.kind === "Deployment" && object.metadata.name === "storage",
    ) as any;
    const imgproxy = built.objects.find(
      (object: any) => object.kind === "Deployment" && object.metadata.name === "imgproxy",
    ) as any;
    expect(storage.spec.replicas).toBe(1);
    expect(storage.spec.strategy).toEqual({ type: "Recreate" });
    expect(storage.spec.template.spec.volumes[0].persistentVolumeClaim.claimName).toBe(
      "data-supabase-storage-data",
    );
    expect(imgproxy.spec.template.spec.containers[0].volumeMounts[0].readOnly).toBe(true);
  });

  it("orders stack workloads after their known dependencies", () => {
    const built = buildKubernetesStackObjects({
      projectId: "project-123",
      projectSlug: "ordered",
      deploymentId: "dep-ordered",
      resources: base.resources,
      services: [
        {
          name: "gateway",
          image: "example/gateway:v1",
          ports: ["8000"],
          dependsOn: ["api", "external-name"],
        },
        {
          name: "api",
          image: "example/api:v1",
          ports: ["3000"],
          dependsOn: ["db"],
        },
        { name: "db", image: "postgres:17", ports: ["5432"] },
      ],
    });

    expect(built.deployments).toEqual(["db", "api", "gateway"]);
  });

  it("rejects host bind mounts in Kubernetes stack mode", () => {
    expect(() =>
      buildKubernetesStackObjects({
        projectId: "project-123",
        projectSlug: "unsafe",
        deploymentId: "dep-unsafe",
        resources: base.resources,
        services: [
          {
            name: "db",
            image: "postgres:17",
            ports: ["5432"],
            volumes: ["/srv/postgres:/var/lib/postgresql/data"],
          },
        ],
      }),
    ).toThrow(/host bind mount/);
  });

  it("deploys every stack workload and returns public service ports", async () => {
    const commands: string[] = [];
    const writtenFiles = new Map<string, string>();
    const executor = {
      mkdir: async () => {},
      writeFile: async (path: string, contents: string) => {
        writtenFiles.set(path, contents);
      },
      exec: async (command: string) => {
        commands.push(command);
        return command.includes("jsonpath") ? "31234" : "";
      },
      rm: async () => {},
    } as unknown as CommandExecutor;

    const result = await deployStackToKubernetes(executor, {
      projectId: "project-123",
      projectSlug: "boutique",
      deploymentId: "dep-stack",
      resources: base.resources,
      defaultReplicas: 2,
      services: [
        { name: "frontend", image: "example/frontend:v1", ports: ["8080"], exposed: true },
        { name: "catalog", image: "example/catalog:v1", ports: ["3550"] },
      ],
    });

    expect(result.workloadId).toBe("kubernetes-stack:openship-boutique");
    expect(result.services[0]?.nodePort).toBe(31234);
    expect(commands.filter((command) => command.includes("rollout status"))).toHaveLength(2);
    expect(commands.some((command) => command.includes("--timeout=900s"))).toBe(true);
    expect(commands.filter((command) => command.includes(" apply "))).toHaveLength(3);
    const foundationApply = commands.findIndex((command) =>
      command.includes("foundation.json"),
    );
    const frontendApply = commands.findIndex((command) =>
      command.includes("deployment-frontend.json"),
    );
    expect(foundationApply).toBeGreaterThan(-1);
    expect(frontendApply).toBeGreaterThan(foundationApply);
    const firstRollout = commands.findIndex((command) =>
      command.includes("rollout status deployment/frontend"),
    );
    const catalogApply = commands.findIndex((command) =>
      command.includes("deployment-catalog.json"),
    );
    expect(firstRollout).toBeGreaterThan(-1);
    expect(catalogApply).toBeGreaterThan(firstRollout);

    const foundation = [...writtenFiles.entries()].find(([path]) =>
      path.endsWith("/foundation.json"),
    );
    expect(foundation).toBeDefined();
    expect(JSON.parse(foundation![1]).items.every((object: any) => object.kind !== "Deployment")).toBe(
      true,
    );
    expect(
      [...writtenFiles.keys()].filter((path) => path.includes("/deployment-")),
    ).toHaveLength(2);
  });
});
