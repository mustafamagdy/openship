import { describe, expect, test } from "vitest";
import {
  inventorySummary,
  type KubernetesInventoryDeployment,
  type KubernetesInventoryPod,
} from "./kubernetes-inventory";

const deployment = (
  name: string,
  desired: number,
  ready = desired,
): KubernetesInventoryDeployment => ({
  name,
  desired,
  ready,
  available: ready,
  updated: ready,
  unavailable: Math.max(0, desired - ready),
});

const pod = (ready: boolean): KubernetesInventoryPod => ({
  name: "pod",
  phase: ready ? "Running" : "Pending",
  ready,
  restarts: 0,
});

describe("inventorySummary", () => {
  test("reports a ready running workload as healthy", () => {
    expect(inventorySummary([deployment("api", 2)], [pod(true), pod(true)])).toMatchObject({
      desiredReplicas: 2,
      readyReplicas: 2,
      healthy: true,
    });
  });

  test("does not call a scaled-to-zero workload healthy", () => {
    expect(inventorySummary([deployment("api", 0)], [])).toMatchObject({
      desiredReplicas: 0,
      readyReplicas: 0,
      healthy: false,
    });
  });

  test("reports an incomplete rollout as degraded", () => {
    expect(inventorySummary([deployment("api", 2, 1)], [pod(true), pod(false)])).toMatchObject({
      healthy: false,
    });
  });
});
