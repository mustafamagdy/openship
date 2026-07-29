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

  it("deploys every stack workload and returns public service ports", async () => {
    const commands: string[] = [];
    const executor = {
      mkdir: async () => {},
      writeFile: async () => {},
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
  });
});
