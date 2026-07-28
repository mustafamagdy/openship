/**
 * `openship update` — update the globally-installed CLI (which bundles the
 * self-hosted API server) to the latest published release.
 *
 * Talks to the configured GitHub release source, NOT the Openship API. Official
 * upstream releases install from the package registry; fork releases install a
 * checksum-verified CLI tarball attached to that fork's GitHub release.
 *
 *   openship update            update if a newer release exists
 *   openship update --check    report current/latest only (no install)
 *   openship update --via npm  force the package manager (default: bun if present, else npm)
 *
 * FROM-SOURCE installs (scripts/install-source.sh, marked by
 * ~/.openship-dev/source-install.json) take a different path: instead of
 * reinstalling an npm release, `openship update` pulls the tracked git ref and
 * rebuilds the CLI + dashboard in place — a quick update with no release in the
 * loop. `--rebuild` forces it even when already at the remote tip.
 */
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliUpdatePlan, cliInstallCommand, type CliPackageManager } from "@repo/core";
import { assetUrl, expectedSha256, resolveLatestTag } from "../lib/github-releases";
import { restart as restartService } from "../lib/service";
import { readInstallMethod, composeUpdate } from "../lib/compose";
import { err, info, isJsonMode, ok, printJson } from "../lib/output";
import {
  loadUpdateSource,
  normalizeReleaseVersion,
  normalizeUpdateSource,
  saveUpdateSource,
  updateSourceLabel,
  UPSTREAM_RELEASE_REPO,
  type UpdateChannel,
  type UpdateSource,
} from "../lib/update-source";
import { shortSha } from "../lib/from-source";
import {
  readSourceInstall,
  rebuildFromSource,
  remoteSha,
  type SourceInstall,
} from "../lib/source-install";

declare const __CLI_VERSION__: string;

interface UpdateOpts {
  check?: boolean;
  via?: string;
  rebuild?: boolean;
  setSource?: string;
  repo?: string;
  version?: string;
  showSource?: boolean;
}

/**
 * Quick update for a from-source install: pull the tracked ref and rebuild the
 * CLI + dashboard in place (like `bun dev`), then restart the service. No npm
 * release is involved. Compares the local checkout sha against the remote tip.
 */
async function runSourceUpdate(source: SourceInstall, opts: UpdateOpts): Promise<void> {
  const current = shortSha(source.dir);
  const remote = remoteSha(source.repo, source.ref);

  if (opts.check) {
    const behind = remote != null && remote !== current;
    if (isJsonMode()) {
      printJson({ source: true, ref: source.ref, current, remote, updateAvailable: behind });
    } else if (remote == null) {
      info(`On source ${source.ref} @ ${current} — couldn't reach ${source.repo} to compare.`);
    } else if (behind) {
      info(
        `Source update available on ${source.ref}: ${current} → ${remote}. Run \`openship update\`.`,
      );
    } else {
      ok(`Up to date on source ${source.ref} (${current}).`);
    }
    return;
  }

  if (!opts.rebuild && remote != null && remote === current) {
    ok(`Already up to date on source ${source.ref} (${current}). Use --rebuild to force.`);
    return;
  }

  info(`Updating from source (${source.ref})…`);
  let sha: string;
  try {
    sha = await rebuildFromSource(source);
  } catch (e) {
    err(`Source update failed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const { restarted } = restartService();
  if (isJsonMode()) {
    printJson({ updated: true, source: true, ref: source.ref, from: current, to: sha, restarted });
  } else if (restarted) {
    ok(`Rebuilt from source (${source.ref} @ ${sha}) and restarted the service.`);
  } else {
    ok(`Rebuilt from source (${source.ref} @ ${sha}). Restart to run it: openship up`);
  }
}

/** Prefer bun (the curl installer uses `bun add -g`); fall back to npm. */
function detectPackageManager(override?: string): CliPackageManager {
  if (override === "bun" || override === "npm") return override;
  const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
  return hasBun ? "bun" : "npm";
}

export const updateCommand = new Command("update")
  .description("Update the Openship CLI + bundled server to the latest release")
  .option("--check", "Only report the current + latest version; don't install")
  .option("--via <manager>", "Package manager to update with: bun | npm")
  .option("--set-source <channel>", "Persist update source: upstream | fork | pinned")
  .option("--repo <owner/repo>", "GitHub release repository for fork/pinned sources")
  .option("--version <version>", "Pinned release version (with --set-source pinned)")
  .option("--show-source", "Show the effective update source and exit")
  .option("--rebuild", "From-source installs: rebuild even if already at the remote tip")
  .action(async (opts: UpdateOpts) => {
    // From-source installs rebuild from git in place; the release path below is
    // for the published npm package.
    const sourceInstall = readSourceInstall();
    if (sourceInstall) return runSourceUpdate(sourceInstall, opts);

    const current = __CLI_VERSION__;
    let source: UpdateSource;
    try {
      if (opts.setSource) {
        source = saveUpdateSource(
          normalizeUpdateSource({
            channel: opts.setSource as UpdateChannel,
            repo: opts.repo,
            pinnedVersion: opts.version,
          }),
        );
      } else {
        source = loadUpdateSource();
      }
    } catch (error) {
      err(error instanceof Error ? error.message : "Invalid update source.");
      process.exitCode = 1;
      return;
    }

    if (opts.showSource || opts.setSource) {
      if (isJsonMode()) printJson(source);
      else ok(`Update source: ${updateSourceLabel(source)}`);
      if (opts.showSource || !opts.check) return;
    }

    let latest: string;
    try {
      latest =
        source.channel === "pinned"
          ? source.pinnedVersion!
          : normalizeReleaseVersion(await resolveLatestTag(source.repo));
    } catch (error) {
      err(
        error instanceof Error && /release version/i.test(error.message)
          ? error.message
          : "Could not reach GitHub to check for updates. Try again, or reinstall manually.",
      );
      process.exitCode = 1;
      return;
    }

    const plan = resolveCliUpdatePlan(current, latest);

    if (opts.check) {
      if (isJsonMode()) {
        printJson({
          current,
          latest,
          updateAvailable: plan.action === "install",
          source,
        });
      } else if (plan.action === "install") {
        info(
          `Update available from ${updateSourceLabel(source)}: v${current} → v${latest}. Run \`openship update\`.`,
        );
      } else {
        ok(`Up to date (v${current}) on ${updateSourceLabel(source)}.`);
      }
      return;
    }

    if (plan.action === "up-to-date") {
      ok(`Already on the latest version (v${current}).`);
      return;
    }

    const pm = detectPackageManager(opts.via);
    let installRef = `openship@${latest}`;
    let cleanup: (() => void) | undefined;
    if (source.repo !== UPSTREAM_RELEASE_REPO) {
      try {
        const prepared = await downloadForkCli(source.repo, latest);
        installRef = prepared.path;
        cleanup = prepared.cleanup;
      } catch (error) {
        err(
          `Could not download the verified fork CLI bundle: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exitCode = 1;
        return;
      }
    }

    const installDescription =
      source.repo === UPSTREAM_RELEASE_REPO
        ? cliInstallCommand(pm, latest)
        : `${pm} install verified ${source.repo} release bundle`;
    info(`Updating v${current} → v${latest} (${installDescription})...`);
    const res =
      pm === "bun" && source.repo !== UPSTREAM_RELEASE_REPO
        ? installForkBundleWithBun(installRef, latest)
        : spawnSync(pm, pm === "bun" ? ["add", "-g", installRef] : ["install", "-g", installRef], {
            stdio: "inherit",
            shell: process.platform === "win32",
          });
    cleanup?.();
    if (res.status !== 0) {
      err(
        `Update failed (${pm} exited ${res.status ?? "with a signal"}). ${
          source.repo === UPSTREAM_RELEASE_REPO
            ? `Reinstall manually: ${cliInstallCommand(pm, latest)}`
            : `Retry after checking release v${latest} in ${source.repo}.`
        }`,
      );
      process.exitCode = 1;
      return;
    }

    // Compose install → pull the new-version images + recreate the stack (the
    // CLI package update above refreshed the compose template/pin). Bare install
    // → restart the process service so it picks up the new bundle.
    if (readInstallMethod() === "compose") {
      const pulled = composeUpdate(latest);
      if (isJsonMode()) {
        printJson({
          updated: true,
          from: current,
          to: latest,
          via: pm,
          method: "compose",
          pulled,
          source,
        });
      } else if (pulled) {
        ok(
          `Updated to v${latest} and pulled the new images — the compose stack is on the new version.`,
        );
      } else {
        err(
          `Updated the CLI to v${latest}, but \`docker compose pull\` failed. Run \`openship up\` to retry.`,
        );
        process.exitCode = 1;
      }
      return;
    }

    // Redeploy: restart the installed service so it picks up the new bundle.
    // No service installed (e.g. `openship up --foreground`) → tell them to
    // relaunch. The service manager (KeepAlive / Restart=always) handles the
    // brief blip while the new version boots.
    const { restarted } = restartService();
    const healthy = restarted ? await waitForApiHealth() : false;

    if (isJsonMode()) {
      printJson({
        updated: true,
        from: current,
        to: latest,
        via: pm,
        restarted,
        healthy,
        source,
      });
    } else if (restarted && healthy) {
      ok(`Updated to v${latest}; the restarted service passed its health check.`);
    } else if (restarted) {
      err(
        `Updated to v${latest}, but the restarted service did not become healthy. Check \`openship status\` and the service logs.`,
      );
      process.exitCode = 1;
    } else {
      ok(`Updated to v${latest}. Restart the server to run the new version: openship up`);
    }
  });

async function waitForApiHealth(): Promise<boolean> {
  let port = 4000;
  try {
    const ports = JSON.parse(readFileSync(join(homedir(), ".openship", "ports.json"), "utf8")) as {
      api?: unknown;
    };
    if (typeof ports.api === "number") port = ports.api;
  } catch {
    // Fresh/legacy installs may not have a remembered port; use the default.
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return true;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function downloadForkCli(
  repo: string,
  version: string,
): Promise<{ path: string; cleanup: () => void }> {
  const tag = `v${version.replace(/^v/, "")}`;
  const name = `openship-cli-${tag}.tgz`;
  const expected = await expectedSha256(tag, name, repo);
  if (!expected) throw new Error(`Release ${tag} is missing ${name}.sha256.`);

  const response = await fetch(assetUrl(tag, name, repo), {
    headers: { "User-Agent": "openship-cli" },
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${name}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${name}; refusing to install it.`);
  }

  const dir = mkdtempSync(join(tmpdir(), "openship-update-"));
  const path = join(dir, name);
  writeFileSync(path, bytes, { mode: 0o600 });
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function resolveBunGlobalDir(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (env.BUN_INSTALL_GLOBAL_DIR) return env.BUN_INSTALL_GLOBAL_DIR;
  if (env.BUN_INSTALL) return join(env.BUN_INSTALL, "install", "global");
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, ".bun", "install", "global");
  return join(home, ".bun", "install", "global");
}

export function updateBunGlobalManifest(globalDir: string, installRef: string): string | null {
  mkdirSync(globalDir, { recursive: true });
  const manifestPath = join(globalDir, "package.json");
  let previous: string | null = null;
  let manifest: Record<string, unknown> = { private: true };
  try {
    previous = readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(previous) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Bun global manifest is invalid JSON: ${manifestPath}`);
    }
  }

  const dependencies =
    manifest.dependencies &&
    typeof manifest.dependencies === "object" &&
    !Array.isArray(manifest.dependencies)
      ? { ...(manifest.dependencies as Record<string, unknown>) }
      : {};
  dependencies.openship = installRef;
  manifest.dependencies = dependencies;

  const temporaryPath = `${manifestPath}.openship-update`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, manifestPath);
  return previous;
}

function restoreBunGlobalManifest(globalDir: string, previous: string | null): void {
  const manifestPath = join(globalDir, "package.json");
  if (previous == null) {
    rmSync(manifestPath, { force: true });
    return;
  }
  const temporaryPath = `${manifestPath}.openship-restore`;
  writeFileSync(temporaryPath, previous, { mode: 0o600 });
  renameSync(temporaryPath, manifestPath);
}

function installForkBundleWithBun(bundlePath: string, version: string) {
  const releaseDir = join(homedir(), ".openship", "cache", "cli-releases");
  mkdirSync(releaseDir, { recursive: true });
  const durableBundlePath = join(releaseDir, `openship-cli-v${version.replace(/^v/, "")}.tgz`);
  copyFileSync(bundlePath, durableBundlePath);

  const globalDir = resolveBunGlobalDir();
  const previousManifest = updateBunGlobalManifest(globalDir, durableBundlePath);
  const result = spawnSync("bun", ["install"], {
    cwd: globalDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) restoreBunGlobalManifest(globalDir, previousManifest);
  return result;
}
