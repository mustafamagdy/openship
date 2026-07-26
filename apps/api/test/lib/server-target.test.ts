import { beforeEach, describe, expect, it, vi } from "vitest";

const serverRepo = vi.hoisted(() => ({
  getInOrganization: vi.fn(),
  findLocal: vi.fn(),
}));

const deploymentRepo = vi.hoisted(() => ({
  findById: vi.fn(),
  findLatestByProject: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  SERVER_IP: undefined as string | undefined,
}));

vi.mock("@repo/db", () => ({
  repos: {
    server: serverRepo,
    deployment: deploymentRepo,
  },
}));

vi.mock("../../src/config/env", () => ({ env: envMock }));

import { resolveServerHost } from "../../src/lib/server-target";

describe("server target DNS address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.SERVER_IP = undefined;
  });

  it("prefers the explicitly configured public server address", async () => {
    envMock.SERVER_IP = "9.9.9.9";
    serverRepo.findLocal.mockResolvedValue({ sshHost: "8.8.8.8" });

    await expect(resolveServerHost("org_123")).resolves.toBe("9.9.9.9");
    expect(serverRepo.findLocal).not.toHaveBeenCalled();
  });

  it("uses the public host persisted on the local server row", async () => {
    serverRepo.findLocal.mockResolvedValue({ sshHost: "8.8.8.8" });

    await expect(resolveServerHost("org_123")).resolves.toBe("8.8.8.8");
    expect(serverRepo.findLocal).toHaveBeenCalledWith("org_123");
  });

  it.each(["127.0.0.1", "192.168.1.169", "localhost"])(
    "does not publish a private local-server placeholder (%s)",
    async (sshHost) => {
      serverRepo.findLocal.mockResolvedValue({ sshHost });

      await expect(resolveServerHost("org_123")).resolves.toBeNull();
    },
  );
});
