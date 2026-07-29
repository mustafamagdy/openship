import { ApiError, api } from "./client";
import { endpoints } from "./endpoints";

export interface DomainVerifyResult {
  verified: boolean;
  cnameVerified?: boolean;
  txtVerified?: boolean;
  message?: string;
  sslStatus?: string;
}

/** One DNS record to add. `host` = zone-relative label (`@`/`app`); `name` =
 *  the always-correct FQDN (what verification resolves) — show it as the
 *  fallback when the provider rejects the relative host (multi-part TLDs). */
export interface DomainDnsRecord {
  type: "CNAME" | "A" | "TXT";
  host: string;
  name: string;
  value: string;
}

export interface DomainDnsRecords {
  mode: "cloud" | "selfhosted" | "external";
  records: DomainDnsRecord[];
}

export interface DomainSslVerifyResult {
  domain: string;
  sslStatus: string;
  expiresAt?: string | null;
  issuer?: string | null;
  verified: boolean;
}

export interface RegisteredDomain {
  id: string;
  domain: string;
  status: string;
  verified: boolean;
  verifiedAt?: string | null;
  isDefault: boolean;
  dnsManaged: boolean;
  dnsProvider?: string | null;
  dnsStatus: "manual" | "in_sync" | "conflict" | "unavailable" | string;
  dnsLastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudflareConnection {
  provider: "cloudflare";
  connected: boolean;
  tokenSetAt?: string;
  lastValidatedAt?: string;
}

export interface DnsSyncRecord {
  type: DomainDnsRecord["type"];
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

export interface RegisteredDomainVerifyResult {
  verified: boolean;
  message: string;
  domain: RegisteredDomain;
}

export const domainsApi = {
  cloudflareConnection: () =>
    api.get<{ data: CloudflareConnection }>(endpoints.domains.cloudflare),

  connectCloudflare: (apiToken: string) =>
    api.put<{
      data: { connection: CloudflareConnection; domains: DnsSyncResult[] };
    }>(endpoints.domains.cloudflare, { apiToken }),

  disconnectCloudflare: () =>
    api.delete<{ success: boolean }>(endpoints.domains.cloudflare),

  listRegistered: () => api.get<{ data: RegisteredDomain[] }>(endpoints.domains.registry),

  register: (domain: string) =>
    api.post<{ data: RegisteredDomain; records: DomainDnsRecord[] }>(endpoints.domains.registry, {
      domain,
    }),

  registeredRecords: (id: string) =>
    api.get<{ data: DomainDnsRecord[] }>(endpoints.domains.registryRecords(id)),

  syncRegisteredDns: async (id: string): Promise<DnsSyncResult> => {
    try {
      const response = await api.post<{ data: DnsSyncResult }>(
        endpoints.domains.registryDnsSync(id),
      );
      return response.data;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === "object"
      ) {
        const body = err.body as { data?: DnsSyncResult };
        if (body.data) return body.data;
      }
      throw err;
    }
  },

  verifyRegistered: async (id: string): Promise<RegisteredDomainVerifyResult> => {
    try {
      const response = await api.post<{ data: RegisteredDomainVerifyResult }>(
        endpoints.domains.registryVerify(id),
      );
      return response.data;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 422 &&
        err.body &&
        typeof err.body === "object"
      ) {
        const body = err.body as { data?: RegisteredDomainVerifyResult };
        if (body.data) return body.data;
      }
      throw err;
    }
  },

  setRegisteredDefault: (id: string) =>
    api.post<{ data: RegisteredDomain }>(endpoints.domains.registryDefault(id)),

  removeRegistered: (id: string) =>
    api.delete<{ success: boolean }>(endpoints.domains.registryRemove(id)),

  /** Get DNS records preview for a hostname (no domain creation needed). */
  previewRecords: (hostname: string) =>
    api.post<{ data: DomainDnsRecords }>(endpoints.domains.preview, { hostname }),

  /** Remove a domain/route (DELETE /domains/:id). Drops the route + its edge
   *  registration; the app/service keeps running. Used by the per-card ⋯ menu. */
  remove: (domainId: string) => api.delete(endpoints.domains.byId(domainId)),

  /**
   * Re-run DNS verification for a domain.
   *
   * Returns the verify result on BOTH success and failure — the backend
   * returns 422 with the same shape when verification fails so the UI
   * can surface cnameVerified/txtVerified/message inline without a
   * second request. Any error other than 422 (network, 4xx, 5xx) is
   * re-thrown so callers can show a generic failure toast.
   */
  verify: async (domainId: string): Promise<DomainVerifyResult> => {
    try {
      return await api.post<DomainVerifyResult>(endpoints.domains.verify(domainId));
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 422 &&
        err.body &&
        typeof err.body === "object"
      ) {
        return err.body as DomainVerifyResult;
      }
      throw err;
    }
  },

  /** Fetch the DNS records for an EXISTING (e.g. pending) domain so the user can
   *  re-see exactly what to add at any time — not only right after connect. */
  records: (domainId: string) =>
    api.get<{ data: DomainDnsRecords }>(endpoints.domains.records(domainId)),

  /**
   * Recheck SSL: read-only verification that the Let's Encrypt cert is actually
   * issued + valid on the serving host. No certbot / rate-limit cost. Recovers a
   * domain stuck in "provisioning" once its cert is in place.
   */
  verifySsl: (domainId: string) =>
    api.post<{ data: DomainSslVerifyResult }>(endpoints.domains.verifySsl(domainId)),

  /**
   * Install an operator-supplied certificate (bring-your-own / Cloudflare
   * Origin CA). Serves TLS from the uploaded cert and disables certbot for this
   * domain — the way to get origin TLS behind an external edge (Full-strict).
   */
  uploadCertificate: (domainId: string, body: { certPem: string; keyPem: string }) =>
    api.post<{ data: DomainSslVerifyResult }>(endpoints.domains.certificate(domainId), body),

  /** Make this domain the project's primary (canonical) hostname. Unsets any
   *  prior primary; exactly one row stays primary per project. */
  setPrimary: (domainId: string) =>
    api.post<{ data: { id: string; hostname: string; isPrimary: boolean } }>(
      endpoints.domains.primary(domainId),
    ),
};
