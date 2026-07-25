import type { Context } from "hono";
import { audit, auditContextFrom } from "../../lib/audit";
import { getRequestContext } from "../../lib/request-context";
import * as service from "./azure-devops.service";

function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new Error(`Missing route param: ${name}`);
  return decodeURIComponent(value);
}

export async function getConnections(c: Context) {
  return c.json({ connections: await service.listConnections(getRequestContext(c)) });
}

export async function connect(c: Context) {
  const ctx = getRequestContext(c);
  const body = await c.req.json<{ organization?: string; pat?: string }>();
  if (!body.organization || !body.pat) {
    return c.json({ error: "organization and pat are required" }, 400);
  }
  try {
    const connection = await service.connect(ctx, {
      organization: body.organization,
      pat: body.pat,
    });
    audit.recordAsync(auditContextFrom(c, ctx.organizationId, ctx.userId), {
      eventType: "azure_devops.connected",
      resourceType: "azure_devops",
      resourceId: connection.organization,
      after: { organization: connection.organization },
    });
    return c.json({ connection }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect Azure DevOps";
    return c.json({ error: message }, 400);
  }
}

export async function disconnect(c: Context) {
  const ctx = getRequestContext(c);
  const organization = param(c, "organization");
  await service.disconnect(ctx, organization);
  audit.recordAsync(auditContextFrom(c, ctx.organizationId, ctx.userId), {
    eventType: "azure_devops.disconnected",
    resourceType: "azure_devops",
    resourceId: organization,
  });
  return c.json({ success: true });
}

export async function listProjects(c: Context) {
  const projects = await service.listProjects(
    getRequestContext(c),
    param(c, "organization"),
  );
  return c.json({ projects });
}

export async function listRepositories(c: Context) {
  const repositories = await service.listRepositories(
    getRequestContext(c),
    param(c, "organization"),
    param(c, "project"),
  );
  return c.json({ repositories });
}

export async function listBranches(c: Context) {
  const organization = param(c, "organization");
  const project = param(c, "project");
  const repo = param(c, "repo");
  const branches = await service.listBranches(getRequestContext(c), {
    organization,
    project,
    repo,
  });
  return c.json({ branches });
}
