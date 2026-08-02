import { describe, expect, it } from "vitest";
import { getRouteRegistry } from "../../../src/lib/route-permission";
import "../../../src/modules/azure-devops/azure-devops.routes";

describe("Azure DevOps route permission scopes", () => {
  it("treats the connection collection as a list/create scope and maps organization deletes", () => {
    const routes = getRouteRegistry().filter((entry) => entry.module === "azure-devops");
    const byPath = new Map(routes.map((entry) => [entry.method + " " + entry.path, entry]));

    expect(byPath.get("GET /api/azure-devops/connections")?.spec).toMatchObject({
      tag: "azure_devops:list",
    });
    expect(byPath.get("POST /api/azure-devops/connections")?.spec).toMatchObject({
      tag: "azure_devops:write",
      collection: true,
    });
    expect(byPath.get("DELETE /api/azure-devops/connections/:organization")?.spec).toMatchObject({
      tag: "azure_devops:admin",
      ids: { azure_devops: "organization" },
    });
  });
});
