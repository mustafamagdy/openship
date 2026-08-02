import { Hono } from "hono";
import { secureRouter } from "../../lib/secure-router";
import * as ctrl from "./azure-devops.controller";

const r = secureRouter(new Hono(), {
  module: "azure-devops",
  basePath: "/api/azure-devops",
});

r.get("/connections", { tag: "azure_devops:list" }, ctrl.getConnections);
r.post("/connections", { tag: "azure_devops:write", collection: true }, ctrl.connect);
r.delete(
  "/connections/:organization",
  { tag: "azure_devops:admin", ids: { azure_devops: "organization" } },
  ctrl.disconnect,
);
r.get(
  "/connections/:organization/projects",
  { tag: "azure_devops:list" },
  ctrl.listProjects,
);
r.get(
  "/connections/:organization/projects/:project/repos",
  { tag: "azure_devops:list" },
  ctrl.listRepositories,
);
r.get(
  "/connections/:organization/projects/:project/repos/:repo/branches",
  { tag: "azure_devops:list" },
  ctrl.listBranches,
);

export const azureDevopsRoutes = r.hono;
