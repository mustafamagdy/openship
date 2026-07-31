import { describe, expect, it } from "vitest";
import { getProjectStatus } from "./project-status";

describe("getProjectStatus", () => {
  it("does not mark a Kubernetes app live when its runtime is stopped", () => {
    expect(
      getProjectStatus({
        activeDeploymentId: "deployment-1",
        runtimeHealthy: false,
      }),
    ).toBe("attention");
  });

  it("preserves the normal live status when Kubernetes runtime is ready", () => {
    expect(
      getProjectStatus({
        activeDeploymentId: "deployment-1",
        runtimeHealthy: true,
      }),
    ).toBe("live");
  });

  it("does not treat an unavailable runtime check as a failure", () => {
    expect(getProjectStatus({ activeDeploymentId: "deployment-1" })).toBe("live");
  });
});
