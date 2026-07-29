import "../mail/_setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@repo/core";

const organizationDomainRepo = vi.hoisted(() => ({
  listByOrganization: vi.fn(),
  findById: vi.fn(),
  findByDomain: vi.fn(),
  create: vi.fn(),
  markVerified: vi.fn(),
  setDefault: vi.fn(),
  remove: vi.fn(),
}));

const projectRepo = vi.hoisted(() => ({
  listByOrganization: vi.fn(),
}));

const projectDomainRepo = vi.hoisted(() => ({
  listByProject: vi.fn(),
}));

const resolveRecords = vi.hoisted(() => vi.fn());
const previewRecords = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({
  repos: {
    organizationDomain: organizationDomainRepo,
    project: projectRepo,
    domain: projectDomainRepo,
  },
}));

vi.mock("../../../src/lib/dns-resolver", () => ({
  resolveRecords,
}));

vi.mock("../../../src/modules/domains/domain.service", () => ({
  previewRecords,
}));

import {
  registerOrganizationDomain,
  removeOrganizationDomain,
  setDefaultOrganizationDomain,
  verifyOrganizationDomain,
} from "../../../src/modules/domains/organization-domain.service";

const context = {
  organizationId: "org_123",
  userId: "user_123",
};

const pendingDomain = {
  id: "odm_123",
  organizationId: context.organizationId,
  domain: "example.com",
  verificationToken: "token-123",
  status: "pending",
  verified: false,
  verifiedAt: null,
  isDefault: false,
  createdAt: new Date("2026-07-25T00:00:00Z"),
  updatedAt: new Date("2026-07-25T00:00:00Z"),
};

describe("organization domain registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationDomainRepo.findById.mockResolvedValue(pendingDomain);
    organizationDomainRepo.listByOrganization.mockResolvedValue([pendingDomain]);
    projectRepo.listByOrganization.mockResolvedValue({ rows: [] });
    projectDomainRepo.listByProject.mockResolvedValue([]);
    previewRecords.mockResolvedValue({
      records: [{ type: "A", host: "openship-preview", value: "203.0.113.10" }],
    });
  });

  it("registers a normalized base domain and returns ownership and wildcard DNS records", async () => {
    organizationDomainRepo.findByDomain.mockResolvedValue(undefined);
    organizationDomainRepo.create.mockImplementation(async (data) => ({
      ...pendingDomain,
      ...data,
      domain: "example.com",
    }));

    const result = await registerOrganizationDomain(context as any, " HTTPS://EXAMPLE.COM/// ");

    expect(organizationDomainRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: context.organizationId,
        domain: "example.com",
        verified: false,
      }),
    );
    expect(previewRecords).toHaveBeenCalledWith(
      "openship-preview.example.com",
      context.organizationId,
    );
    expect(result.records).toEqual([
      expect.objectContaining({
        type: "TXT",
        host: "_openship-domain",
        name: "_openship-domain.example.com",
      }),
      {
        type: "A",
        host: "*",
        name: "*.example.com",
        value: "203.0.113.10",
      },
    ]);
  });

  it("marks a domain verified when the ownership TXT record matches", async () => {
    resolveRecords.mockResolvedValue([
      `openship-domain-verification=${pendingDomain.verificationToken}`,
    ]);
    organizationDomainRepo.markVerified.mockResolvedValue({
      ...pendingDomain,
      status: "active",
      verified: true,
      isDefault: true,
    });

    const result = await verifyOrganizationDomain(context as any, pendingDomain.id);

    expect(result.verified).toBe(true);
    expect(result.domain).toMatchObject({ verified: true, isDefault: true });
    expect(organizationDomainRepo.markVerified).toHaveBeenCalledWith(
      context.organizationId,
      pendingDomain.id,
    );
  });

  it("only allows a verified domain to become the default", async () => {
    organizationDomainRepo.setDefault.mockResolvedValue(undefined);

    await expect(
      setDefaultOrganizationDomain(context as any, pendingDomain.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to remove a base domain while project routes still use it", async () => {
    projectRepo.listByOrganization.mockResolvedValue({
      rows: [{ id: "proj_123" }],
    });
    projectDomainRepo.listByProject.mockResolvedValue([{ hostname: "app.example.com" }]);

    await expect(removeOrganizationDomain(context as any, pendingDomain.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(organizationDomainRepo.remove).not.toHaveBeenCalled();
  });
});
