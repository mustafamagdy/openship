import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packageManagerExecutable,
  packageManagerFailure,
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
    expect(packageManagerExecutable("bun", "1.3.10", "/opt/bun/bin/bun")).toBe(
      "/opt/bun/bin/bun",
    );
    expect(packageManagerExecutable("bun", null, "/usr/local/bin/node", {}, "/missing")).toBe("bun");
    expect(packageManagerExecutable("npm")).toBe("npm");
  });

  it("finds Bun installed for a Node-managed service before falling back to PATH", () => {
    const home = mkdtempSync(join(tmpdir(), "openship-bun-home-"));
    const bunInstall = mkdtempSync(join(tmpdir(), "openship-bun-install-"));
    temporaryDirectories.push(home);
    temporaryDirectories.push(bunInstall);
    const bunBin = join(home, ".bun", "bin");
    const executable = join(bunBin, process.platform === "win32" ? "bun.exe" : "bun");
    const configuredBin = join(bunInstall, "bin");
    const configuredExecutable = join(
      configuredBin,
      process.platform === "win32" ? "bun.exe" : "bun",
    );
    mkdirSync(bunBin, { recursive: true });
    mkdirSync(configuredBin, { recursive: true });
    writeFileSync(executable, "");
    writeFileSync(configuredExecutable, "");

    expect(packageManagerExecutable("bun", null, "/usr/local/bin/node", {}, home)).toBe(executable);
    expect(
      packageManagerExecutable("bun", null, "/usr/local/bin/node", { BUN_INSTALL: bunInstall }, home),
    ).toBe(configuredExecutable);
  });

  it("reports a missing Bun executable instead of mislabeling it as a signal", () => {
    expect(
      packageManagerFailure("/home/user/.bun/bin/bun", {
        status: null,
        signal: null,
        error: new Error("spawn /home/user/.bun/bin/bun ENOENT"),
      }),
    ).toBe("could not start /home/user/.bun/bin/bun: spawn /home/user/.bun/bin/bun ENOENT");
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
