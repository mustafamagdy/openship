import { describe, expect, it } from "vitest";
import type { CommandExecutor } from "@repo/adapters";
import {
  buildKubernetesObjects,
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
});
