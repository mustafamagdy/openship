import { describe, expect, it } from "vitest";
import { isValidReplicaCount, ownedResourceQuery } from "./kubernetes-command";

describe("Kubernetes command helpers", () => {
  it("accepts zero replicas so a workload can be paused", () => {
    expect(isValidReplicaCount(0)).toBe(true);
  });

  it("accepts the supported positive replica range", () => {
    expect(isValidReplicaCount(1)).toBe(true);
    expect(isValidReplicaCount(50)).toBe(true);
  });

  it("rejects negative, excessive, and non-integer replica counts", () => {
    expect(isValidReplicaCount(-1)).toBe(false);
    expect(isValidReplicaCount(51)).toBe(false);
    expect(isValidReplicaCount(1.5)).toBe(false);
    expect(isValidReplicaCount(Number.NaN)).toBe(false);
  });

  it("keeps ownership and name guards in resource lookups", () => {
    expect(
      ownedResourceQuery(
        "sudo -n kubectl -n openship-demo",
        "deployment",
        "api",
        "openship.io/project-id=project-123",
      ),
    ).toBe(
      "sudo -n kubectl -n openship-demo get deployment -l openship.io/project-id=project-123 --field-selector metadata.name=api -o name",
    );
  });
});
