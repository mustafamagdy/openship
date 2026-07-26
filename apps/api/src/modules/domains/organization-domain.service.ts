import { repos, type OrganizationDomain } from "@repo/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  isValidCustomHostname,
  normalizeCustomHostname,
} from "@repo/core";
import type { RequestContext } from "../../lib/request-context";
import { generateToken } from "../../lib/domain-token";
import { resolveRecords } from "../../lib/dns-resolver";
import { getRoutingBaseDomain } from "../../lib/routing-domains";
import { previewRecords } from "./domain.service";

const TXT_PREFIX = "openship-domain-verification=";

export interface OrganizationDomainRecord {
  type: "A" | "CNAME" | "TXT";
  host: string;
  name: string;
  value: string;
}

function verificationName(domain: string) {
  return `_openship-domain.${domain}`;
}

function verificationValue(token: string) {
  return `${TXT_PREFIX}${token}`;
}

function publicRow(row: OrganizationDomain) {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    verified: row.verified,
    verifiedAt: row.verifiedAt,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateBaseDomain(input: string): string {
  const domain = normalizeCustomHostname(input.trim());
  if (!domain || !isValidCustomHostname(domain)) {
    throw new ValidationError(`"${input}" is not a valid public domain.`);
  }
  const routingBase = getRoutingBaseDomain().toLowerCase();
  if (domain === routingBase || domain.endsWith(`.${routingBase}`)) {
    throw new ValidationError(`${routingBase} is already managed by OpenShip.`);
  }
  return domain;
}

async function requireDomain(organizationId: string, id: string): Promise<OrganizationDomain> {
  const row = await repos.organizationDomain.findById(organizationId, id);
  if (!row) throw new NotFoundError("Registered domain", id);
  return row;
}

export async function listOrganizationDomains(ctx: RequestContext) {
  const rows = await repos.organizationDomain.listByOrganization(ctx.organizationId);
  return rows.map(publicRow);
}

export async function getOrganizationDomainRecords(
  ctx: RequestContext,
  id: string,
): Promise<OrganizationDomainRecord[]> {
  const row = await requireDomain(ctx.organizationId, id);
  const preview = await previewRecords(`openship-preview.${row.domain}`, ctx.organizationId);
  const routeRecord = preview.records.find((record) => record.type !== "TXT");
  return [
    {
      type: "TXT",
      host: "_openship-domain",
      name: verificationName(row.domain),
      value: verificationValue(row.verificationToken),
    },
    ...(routeRecord
      ? [
          {
            type: routeRecord.type,
            host: "*",
            name: `*.${row.domain}`,
            value: routeRecord.value,
          } satisfies OrganizationDomainRecord,
        ]
      : []),
  ];
}

export async function registerOrganizationDomain(ctx: RequestContext, input: string) {
  const domain = validateBaseDomain(input);
  const existing = await repos.organizationDomain.findByDomain(domain);
  if (existing) {
    if (existing.organizationId !== ctx.organizationId) {
      throw new ConflictError(`Domain "${domain}" is already registered.`);
    }
    return {
      domain: publicRow(existing),
      records: await getOrganizationDomainRecords(ctx, existing.id),
    };
  }

  const row = await repos.organizationDomain.create({
    organizationId: ctx.organizationId,
    domain,
    verificationToken: generateToken(`${ctx.organizationId}:${domain}`),
    status: "pending",
    verified: false,
    isDefault: false,
  });
  return {
    domain: publicRow(row),
    records: await getOrganizationDomainRecords(ctx, row.id),
  };
}

export async function verifyOrganizationDomain(ctx: RequestContext, id: string) {
  const row = await requireDomain(ctx.organizationId, id);
  const expected = verificationValue(row.verificationToken);
  const records = await resolveRecords(verificationName(row.domain), "TXT");
  const verified = records.some((record) => record.replace(/^"|"$/g, "").trim() === expected);
  if (!verified) {
    return {
      verified: false,
      message: `TXT ${verificationName(row.domain)} must equal "${expected}".`,
      domain: publicRow(row),
    };
  }

  const updated = await repos.organizationDomain.markVerified(ctx.organizationId, id);
  if (!updated) throw new NotFoundError("Registered domain", id);
  return {
    verified: true,
    message: `${updated.domain} is verified and ready for subdomains.`,
    domain: publicRow(updated),
  };
}

export async function setDefaultOrganizationDomain(ctx: RequestContext, id: string) {
  const updated = await repos.organizationDomain.setDefault(ctx.organizationId, id);
  if (!updated) {
    throw new ValidationError("Only a verified registered domain can be the default.");
  }
  return publicRow(updated);
}

export async function removeOrganizationDomain(ctx: RequestContext, id: string) {
  const row = await requireDomain(ctx.organizationId, id);
  const projects = await repos.project.listByOrganization(ctx.organizationId, {
    page: 1,
    perPage: 1000,
  });
  const projectDomains = (
    await Promise.all(projects.rows.map((project) => repos.domain.listByProject(project.id)))
  ).flat();
  const inUse = projectDomains.filter((domain) =>
    domain.hostname.toLowerCase().endsWith(`.${row.domain}`),
  );
  if (inUse.length > 0) {
    throw new ConflictError(
      `${row.domain} is still used by ${inUse.length} project route${inUse.length === 1 ? "" : "s"}.`,
    );
  }

  if (row.isDefault) {
    const replacement = (
      await repos.organizationDomain.listByOrganization(ctx.organizationId)
    ).find((candidate) => candidate.id !== id && candidate.verified);
    if (replacement) {
      await repos.organizationDomain.setDefault(ctx.organizationId, replacement.id);
    }
  }
  await repos.organizationDomain.remove(ctx.organizationId, id);
}
