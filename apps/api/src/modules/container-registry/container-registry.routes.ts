import { Hono } from "hono";
import { tbValidator } from "@hono/typebox-validator";
import { secureRouter } from "../../lib/secure-router";
import * as ctrl from "./container-registry.controller";
import { ConnectContainerRegistryBody } from "./container-registry.schema";

const r = secureRouter(new Hono(), {
  module: "container-registry",
  basePath: "/api/container-registries",
});

r.get("/", { tag: "settings:read" }, ctrl.list);
r.post(
  "/",
  { tag: "settings:admin" },
  tbValidator("json", ConnectContainerRegistryBody),
  ctrl.connect,
);
r.delete("/:id", { tag: "settings:admin" }, ctrl.disconnect);

export const containerRegistryRoutes = r.hono;
