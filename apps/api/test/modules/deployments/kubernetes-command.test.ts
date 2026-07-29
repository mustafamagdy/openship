import { describe, expect, test } from "vitest";
import { ownedResourceQuery } from "../../../src/modules/deployments/kubernetes/kubernetes-command";

describe("ownedResourceQuery", () => {
  const prefix = "sudo -n kubectl -n openship-shop";
  const selector = "openship.io/project-id=proj_123";

  test.each([
    ["deployment", "frontend"],
    ["pod", "frontend-6bbf56d9f7-abcde"],
  ] as const)("scopes %s by OpenShip ownership and metadata.name", (resource, name) => {
    const command = ownedResourceQuery(prefix, resource, name, selector);

    expect(command).toBe(
      `${prefix} get ${resource} -l ${selector} --field-selector metadata.name=${name} -o name`,
    );
    expect(command).not.toContain(`${resource}/${name} -l`);
  });
});
