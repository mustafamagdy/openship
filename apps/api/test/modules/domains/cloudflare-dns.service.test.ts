import "../mail/_setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dnsProviderConnection = vi.hoisted(() => ({
  find: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
}));

const organizationDomain = vi.hoisted(() => ({
  findById: vi.fn(),
  listByOrganization: vi.fn(),
  setDnsState: vi.fn(),
  clearDnsProvider: vi.fn(),
}));

const getOrganizationDomainRecords = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({
  repos: { dnsProviderConnection, organizationDomain },
}));

vi.mock("../../../src/lib/encryption", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
}));

vi.mock("../../../src/modules/domains/organization-domain.service", () => ({
  getOrganizationDomainRecords,
}));

import {
  connect,
  syncDomain,
} from "../../../src/modules/domains/cloudflare-dns.service";

const context = { organizationId: "org_123", userId: "user_123" };
const domain = {
  id: "odm_123",
  organizationId: context.organizationId,
  domain: "example.com",
};
const desiredRecords = [
  {
    type: "TXT" as const,
    host: "_openship-domain",
    name: "_openship-domain.example.com",
    value: "openship-domain-verification=token",
  },
  {
    type: "A" as const,
    host: "*",
    name: "*.example.com",
    value: "203.0.113.10",
  },
];

function cloudflareResponse(result: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Cloudflare DNS automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dnsProviderConnection.find.mockResolvedValue({
      id: "dns_123",
      organizationId: context.organizationId,
      provider: "cloudflare",
      tokenEncrypted: "encrypted:cf-token",
    });
    organizationDomain.findById.mockResolvedValue(domain);
    organizationDomain.listByOrganization.mockResolvedValue([]);
    organizationDomain.setDnsState.mockResolvedValue(domain);
    getOrganizationDomainRecords.mockResolvedValue(desiredRecords);
  });

  it("validates a token before saving it", async () => {
    const saved = {
      id: "dns_123",
      organizationId: context.organizationId,
      provider: "cloudflare",
      tokenEncrypted: "encrypted:abcdefghijklmnopqrstuvwxyz123456",
      tokenSetAt: new Date(),
      lastValidatedAt: new Date(),
    };
    dnsProviderConnection.upsert.mockResolvedValue(saved);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(cloudflareResponse({ status: "active" })),
    );

    const result = await connect(context as any, "abcdefghijklmnopqrstuvwxyz123456");

    expect(dnsProviderConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: context.organizationId,
        provider: "cloudflare",
        tokenEncrypted: "encrypted:abcdefghijklmnopqrstuvwxyz123456",
      }),
    );
    expect(result.connection.connected).toBe(true);
  });

  it("creates missing records and marks the domain managed", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/zones?")) {
        return cloudflareResponse([{ id: "zone_123", name: "example.com", status: "active" }]);
      }
      if (init?.method === "POST") {
        return cloudflareResponse({ id: "record_123" });
      }
      return cloudflareResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDomain(context, domain.id);

    expect(result).toMatchObject({ status: "in_sync", changed: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(organizationDomain.setDnsState).toHaveBeenLastCalledWith(
      context.organizationId,
      domain.id,
      expect.objectContaining({
        dnsManaged: true,
        dnsProvider: "cloudflare",
        dnsStatus: "in_sync",
      }),
    );
  });

  it("reports a conflict before creating any records", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/zones?")) {
        return cloudflareResponse([{ id: "zone_123", name: "example.com", status: "active" }]);
      }
      if (url.includes("name=*.")) {
        return cloudflareResponse([
          {
            id: "record_existing",
            type: "A",
            name: "*.example.com",
            content: "198.51.100.20",
          },
        ]);
      }
      if (init?.method === "POST") throw new Error("must not write on conflict");
      return cloudflareResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDomain(context, domain.id);

    expect(result.status).toBe("conflict");
    expect(result.changed).toBe(0);
    expect(result.records).toContainEqual(
      expect.objectContaining({ name: "*.example.com", action: "conflict" }),
    );
    expect(fetchMock.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(true);
  });
});
