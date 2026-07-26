import type { Context } from "hono";
import { param } from "../../lib/controller-helpers";
import { getRequestContext } from "../../lib/request-context";
import { audit, auditContextFrom } from "../../lib/audit";
import * as service from "./container-registry.service";

export async function list(c: Context) {
  return c.json({ connections: await service.listConnections(getRequestContext(c)) });
}

export async function connect(c: Context) {
  const ctx = getRequestContext(c);
  const connection = await service.connect(ctx, await c.req.json());
  audit.recordAsync(auditContextFrom(c, ctx.organizationId, ctx.userId), {
    eventType: "container_registry.connected",
    resourceType: "organization",
    resourceId: ctx.organizationId,
    after: {
      registryHost: connection.registryHost,
      namespace: connection.namespace,
      provider: connection.provider,
    },
  });
  return c.json({ connection }, 201);
}

export async function disconnect(c: Context) {
  const ctx = getRequestContext(c);
  const id = param(c, "id");
  await service.disconnect(ctx, id);
  audit.recordAsync(auditContextFrom(c, ctx.organizationId, ctx.userId), {
    eventType: "container_registry.disconnected",
    resourceType: "organization",
    resourceId: ctx.organizationId,
    after: { connectionId: id },
  });
  return c.json({ success: true });
}
