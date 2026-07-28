import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packageManagerExecutable,
  resolveBunGlobalDir,
  updateBunGlobalManifest,
} from "../../src/commands/update";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Bun global fork updates", () => {
  it("uses the active Bun runtime even when bun is absent from PATH", () => {
    expect(packageManagerExecutable("bun")).toBe(process.execPath);
    expect(packageManagerExecutable("npm")).toBe("npm");
  });

  it("resolves Bun's documented global directory precedence", () => {
    expect(
      resolveBunGlobalDir(
        {
          BUN_INSTALL_GLOBAL_DIR: "/custom/global",
          BUN_INSTALL: "/bun",
          XDG_CACHE_HOME: "/cache",
        },
        "/home/user",
      ),
    ).toBe("/custom/global");
    expect(resolveBunGlobalDir({ BUN_INSTALL: "/bun" }, "/home/user")).toBe("/bun/install/global");
    expect(resolveBunGlobalDir({ XDG_CACHE_HOME: "/cache" }, "/home/user")).toBe(
      "/cache/.bun/install/global",
    );
    expect(resolveBunGlobalDir({}, "/home/user")).toBe("/home/user/.bun/install/global");
  });

  it("replaces a stale temporary tarball while preserving other global packages", () => {
    const globalDir = mkdtempSync(join(tmpdir(), "openship-bun-global-"));
    temporaryDirectories.push(globalDir);
    const manifestPath = join(globalDir, "package.json");
    const original = JSON.stringify({
      dependencies: {
        openship: "/tmp/openship-cli-v0.4.6.tgz",
        prettier: "^3.0.0",
      },
    });
    writeFileSync(manifestPath, original);

    const previous = updateBunGlobalManifest(
      globalDir,
      "/home/user/.openship/cache/cli-releases/openship-cli-v0.4.7.tgz",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf8"));

    expect(previous).toBe(original);
    expect(updated.dependencies).toEqual({
      openship: "/home/user/.openship/cache/cli-releases/openship-cli-v0.4.7.tgz",
      prettier: "^3.0.0",
    });
  });
});
