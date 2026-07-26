import { repos, type DnsProviderConnection } from "@repo/db";
import { ValidationError } from "@repo/core";
import type { RequestContext } from "../../lib/request-context";
import { decrypt, encrypt } from "../../lib/encryption";
import {
  getOrganizationDomainRecords,
  type OrganizationDomainRecord,
} from "./organization-domain.service";

const PROVIDER = "cloudflare";
const API_BASE = "https://api.cloudflare.com/client/v4";
const MANAGED_COMMENT = "Managed by OpenShip";

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  comment?: string;
}

export interface DnsSyncRecord {
  type: OrganizationDomainRecord["type"];
  name: string;
  value: string;
  action: "created" | "unchanged" | "conflict";
  detail?: string;
}

export interface DnsSyncResult {
  domainId: string;
  domain: string;
  provider: "cloudflare";
  zoneId?: string;
  status: "in_sync" | "conflict" | "unavailable";
  changed: number;
  records: DnsSyncRecord[];
}

function publicConnection(row: DnsProviderConnection | undefined) {
  if (!row) return { provider: PROVIDER, connected: false as const };
  return {
    provider: PROVIDER,
    connected: true as const,
    tokenSetAt: row.tokenSetAt,
    lastValidatedAt: row.lastValidatedAt,
  };
}

async function cloudflareFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  let payload: CloudflareEnvelope<T> | undefined;
  try {
    payload = (await response.json()) as CloudflareEnvelope<T>;
  } catch {
    // The provider occasionally returns an HTML edge error. Keep credentials
    // and raw bodies out of the surfaced error.
  }
  if (!response.ok || !payload?.success) {
    const detail = payload?.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new ValidationError(
      detail ? `Cloudflare rejected the request: ${detail}` : `Cloudflare request failed (${response.status}).`,
    );
  }
  return payload.result;
}

async function requireConnection(organizationId: string): Promise<DnsProviderConnection> {
  const row = await repos.dnsProviderConnection.find(organizationId, PROVIDER);
  if (!row) {
    throw new ValidationError("Connect Cloudflare before syncing DNS.");
  }
  return row;
}

async function findZone(token: string, domain: string): Promise<CloudflareZone> {
  const zones = await cloudflareFetch<CloudflareZone[]>(
    token,
    `/zones?name=${encodeURIComponent(domain)}&status=active&per_page=50`,
  );
  const zone = zones.find((candidate) => candidate.name.toLowerCase() === domain.toLowerCase());
  if (!zone) {
    throw new ValidationError(
      `Cloudflare token cannot access the active ${domain} zone. Grant Zone:Read and DNS:Edit for this zone.`,
    );
  }
  return zone;
}

async function listRecords(
  token: string,
  zoneId: string,
  name: string,
): Promise<CloudflareRecord[]> {
  return cloudflareFetch<CloudflareRecord[]>(
    token,
    `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
  );
}

function desiredPayload(record: OrganizationDomainRecord) {
  return {
    type: record.type,
    name: record.name,
    content: record.value,
    ttl: 1,
    ...(record.type === "TXT" ? {} : { proxied: false }),
    comment: MANAGED_COMMENT,
  };
}

function conflictingRecords(
  desired: OrganizationDomainRecord,
  existing: CloudflareRecord[],
): CloudflareRecord[] {
  if (desired.type === "TXT") return [];
  return existing.filter((record) => {
    if (record.type === desired.type) return record.content !== desired.value;
    return ["A", "AAAA", "CNAME"].includes(record.type);
  });
}

export async function getConnection(ctx: Pick<RequestContext, "organizationId">) {
  return publicConnection(
    await repos.dnsProviderConnection.find(ctx.organizationId, PROVIDER),
  );
}

export async function connect(
  ctx: RequestContext,
  apiTokenInput: string,
): Promise<{ connection: ReturnType<typeof publicConnection>; domains: DnsSyncResult[] }> {
  const apiToken = apiTokenInput.trim();
  if (apiToken.length < 20 || apiToken.length > 4096) {
    throw new ValidationError("Cloudflare API token is invalid.");
  }

  const verification = await cloudflareFetch<{ status?: string }>(
    apiToken,
    "/user/tokens/verify",
  );
  if (verification.status !== "active") {
    throw new ValidationError("Cloudflare API token is not active.");
  }

  const saved = await repos.dnsProviderConnection.upsert({
    organizationId: ctx.organizationId,
    connectedByUserId: ctx.userId,
    provider: PROVIDER,
    tokenEncrypted: encrypt(apiToken),
    tokenSetAt: new Date(),
    lastValidatedAt: new Date(),
  });

  const domains = await repos.organizationDomain.listByOrganization(ctx.organizationId);
  const results: DnsSyncResult[] = [];
  for (const domain of domains) {
    try {
      results.push(await syncDomain(ctx, domain.id));
    } catch (error) {
      results.push({
        domainId: domain.id,
        domain: domain.domain,
        provider: PROVIDER,
        status: "unavailable",
        changed: 0,
        records: [
          {
            type: "TXT",
            name: domain.domain,
            value: "",
            action: "conflict",
            detail: error instanceof Error ? error.message : "Cloudflare sync failed.",
          },
        ],
      });
    }
  }

  return { connection: publicConnection(saved), domains: results };
}

export async function disconnect(ctx: Pick<RequestContext, "organizationId">): Promise<void> {
  await repos.dnsProviderConnection.remove(ctx.organizationId, PROVIDER);
  await repos.organizationDomain.clearDnsProvider(ctx.organizationId, PROVIDER);
}

export async function syncDomain(
  ctx: Pick<RequestContext, "organizationId">,
  domainId: string,
): Promise<DnsSyncResult> {
  const connection = await requireConnection(ctx.organizationId);
  const token = decrypt(connection.tokenEncrypted);
  const domain = await repos.organizationDomain.findById(ctx.organizationId, domainId);
  if (!domain) throw new ValidationError("Registered domain was not found.");

  const desired = await getOrganizationDomainRecords(ctx, domainId);
  if (desired.length < 2 || desired.some((record) => !record.value)) {
    await repos.organizationDomain.setDnsState(ctx.organizationId, domainId, {
      dnsManaged: false,
      dnsProvider: PROVIDER,
      dnsProviderZoneId: null,
      dnsStatus: "unavailable",
      dnsLastSyncedAt: new Date(),
    });
    throw new ValidationError(
      "OpenShip does not have a public server address yet. Configure SERVER_IP before syncing DNS.",
    );
  }

  const zone = await findZone(token, domain.domain);
  const inspected = await Promise.all(
    desired.map(async (record) => ({
      desired: record,
      existing: await listRecords(token, zone.id, record.name),
    })),
  );

  const resultRecords: DnsSyncRecord[] = [];
  const creates: OrganizationDomainRecord[] = [];
  for (const item of inspected) {
    const exact = item.existing.find(
      (record) => record.type === item.desired.type && record.content === item.desired.value,
    );
    if (exact) {
      resultRecords.push({ ...item.desired, action: "unchanged" });
      continue;
    }

    const conflicts = conflictingRecords(item.desired, item.existing);
    if (conflicts.length > 0) {
      resultRecords.push({
        ...item.desired,
        action: "conflict",
        detail: `Existing ${conflicts.map((record) => record.type).join("/")} record points elsewhere.`,
      });
      continue;
    }
    creates.push(item.desired);
  }

  // Inspect the entire desired state before writing anything. This prevents a
  // half-managed domain when one record conflicts.
  const hasConflict = resultRecords.some((record) => record.action === "conflict");
  if (hasConflict) {
    await repos.organizationDomain.setDnsState(ctx.organizationId, domainId, {
      dnsManaged: false,
      dnsProvider: PROVIDER,
      dnsProviderZoneId: zone.id,
      dnsStatus: "conflict",
      dnsLastSyncedAt: new Date(),
    });
    return {
      domainId,
      domain: domain.domain,
      provider: PROVIDER,
      zoneId: zone.id,
      status: "conflict",
      changed: 0,
      records: resultRecords,
    };
  }

  for (const record of creates) {
    await cloudflareFetch<CloudflareRecord>(
      token,
      `/zones/${encodeURIComponent(zone.id)}/dns_records`,
      { method: "POST", body: JSON.stringify(desiredPayload(record)) },
    );
    resultRecords.push({ ...record, action: "created" });
  }

  await repos.organizationDomain.setDnsState(ctx.organizationId, domainId, {
    dnsManaged: true,
    dnsProvider: PROVIDER,
    dnsProviderZoneId: zone.id,
    dnsStatus: "in_sync",
    dnsLastSyncedAt: new Date(),
  });
  return {
    domainId,
    domain: domain.domain,
    provider: PROVIDER,
    zoneId: zone.id,
    status: "in_sync",
    changed: creates.length,
    records: resultRecords,
  };
}

export async function syncDomainIfConnected(
  ctx: Pick<RequestContext, "organizationId">,
  domainId: string,
): Promise<DnsSyncResult | undefined> {
  const connection = await repos.dnsProviderConnection.find(ctx.organizationId, PROVIDER);
  if (!connection) return undefined;
  return syncDomain(ctx, domainId);
}
