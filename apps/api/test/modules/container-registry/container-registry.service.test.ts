import "../mail/_setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@repo/core";

const registryRepo = vi.hoisted(() => ({
  listByOrganization: vi.fn(),
  findDefault: vi.fn(),
  findById: vi.fn(),
  upsertDefault: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  repos: { containerRegistryConnection: registryRepo },
}));

vi.mock("../../../src/lib/encryption", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
}));

import {
  connect,
  normalizeRegistryHost,
  publishBuildArtifact,
} from "../../../src/modules/container-registry/container-registry.service";

const context = { organizationId: "org_123", userId: "user_123" };

describe("container registry connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes registry hosts and rejects paths", () => {
    expect(normalizeRegistryHost("https://GHCR.IO/")).toBe("ghcr.io");
    expect(() => normalizeRegistryHost("https://ghcr.io/acme")).toThrow(ValidationError);
  });

  it("validates credentials before encrypting and persisting them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    registryRepo.upsertDefault.mockImplementation(async (input) => ({
      id: "reg_123",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    }));

    const result = await connect(context as any, {
      provider: "ghcr",
      registryHost: "ghcr.io",
      namespace: "MustafaMagdy",
      username: "mustafamagdy",
      token: "package-token",
    });

    expect(registryRepo.upsertDefault).toHaveBeenCalledWith(
      expect.objectContaining({
        registryHost: "ghcr.io",
        namespace: "mustafamagdy",
        tokenEncrypted: "encrypted:package-token",
      }),
    );
    expect(result).not.toHaveProperty("tokenEncrypted");
  });

  it("publishes deployment-tagged artifacts through Docker", async () => {
    registryRepo.findDefault.mockResolvedValue({
      id: "reg_123",
      registryHost: "ghcr.io",
      namespace: "acme",
      username: "bot",
      tokenEncrypted: "encrypted:token",
    });
    const runtime = {
      publishImage: vi.fn().mockResolvedValue({
        imageRef: `ghcr.io/acme/openship-shop@sha256:${"b".repeat(64)}`,
        imageDigest: `sha256:${"b".repeat(64)}`,
      }),
    };

    await publishBuildArtifact({
      organizationId: context.organizationId,
      runtime: runtime as any,
      localRef: "openship/shop:bld_1",
      projectSlug: "Shop API",
      artifactKey: "dep_123",
    });

    expect(runtime.publishImage).toHaveBeenCalledWith(
      "openship/shop:bld_1",
      "ghcr.io/acme/openship-shop-api:dep_123",
      expect.objectContaining({ username: "bot", password: "token" }),
    );
  });
});
