import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const mocks = vi.hoisted(() => ({
  cacheDir: `/tmp/openship-dashboard-source-test-${process.pid}`,
  assetUrl: vi.fn(),
  downloadToFile: vi.fn(),
  expectedSha256: vi.fn(),
  resolveLatestTag: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("../../src/lib/cache", () => ({
  CACHE_DIR: mocks.cacheDir,
  downloadToFile: mocks.downloadToFile,
}));

vi.mock("../../src/lib/github-releases", () => ({
  assetUrl: mocks.assetUrl,
  expectedSha256: mocks.expectedSha256,
  resolveLatestTag: mocks.resolveLatestTag,
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock("../../src/lib/update-source", () => ({
  loadUpdateSource: () => ({
    channel: "fork",
    repo: "mustafamagdy/openship",
  }),
  validateReleaseRepo: (repo: string) => repo,
}));

import { ensureDashboard } from "../../src/lib/dashboard";

describe("ensureDashboard release source", () => {
  beforeEach(() => {
    rmSync(mocks.cacheDir, { recursive: true, force: true });
    mocks.assetUrl.mockReset();
    mocks.downloadToFile.mockReset();
    mocks.expectedSha256.mockReset();
    mocks.resolveLatestTag.mockReset();
    mocks.spawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(mocks.cacheDir, { recursive: true, force: true });
  });

  it("resolves and reuses dashboard releases from the configured fork", async () => {
    mocks.resolveLatestTag.mockResolvedValue("v0.4.2");
    const releaseDir = join(
      mocks.cacheDir,
      "dashboard",
      "mustafamagdy",
      "openship",
      "v0.4.2",
    );
    const dashboardDir = join(releaseDir, "apps", "dashboard");
    mkdirSync(dashboardDir, { recursive: true });
    writeFileSync(join(dashboardDir, "server.js"), "");
    writeFileSync(join(releaseDir, ".extracted"), "v0.4.2\n");

    const bundle = await ensureDashboard();

    expect(mocks.resolveLatestTag).toHaveBeenCalledWith("mustafamagdy/openship");
    expect(bundle).toEqual({
      tag: "v0.4.2",
      entry: join(dashboardDir, "server.js"),
      cwd: dashboardDir,
    });
  });

  it("downloads and verifies a tagged dashboard from the configured fork", async () => {
    mocks.assetUrl.mockReturnValue("https://example.test/fork-dashboard.tgz");
    mocks.expectedSha256.mockResolvedValue("expected-sha");
    mocks.downloadToFile.mockImplementation(async (_url: string, tarball: string) => {
      const dashboardDir = join(dirname(tarball), "apps", "dashboard");
      mkdirSync(dashboardDir, { recursive: true });
      writeFileSync(join(dashboardDir, "server.js"), "");
      return { sha256: "expected-sha", size: 1 };
    });
    mocks.spawnSync.mockReturnValue({ status: 0 });

    const bundle = await ensureDashboard({ tag: "v0.4.2" });

    expect(mocks.assetUrl).toHaveBeenCalledWith(
      "v0.4.2",
      "openship-dashboard-v0.4.2.tar.gz",
      "mustafamagdy/openship",
    );
    expect(mocks.expectedSha256).toHaveBeenCalledWith(
      "v0.4.2",
      "openship-dashboard-v0.4.2.tar.gz",
      "mustafamagdy/openship",
    );
    expect(bundle.cwd).toContain(
      join("dashboard", "mustafamagdy", "openship", "v0.4.2", "apps", "dashboard"),
    );
  });
});
