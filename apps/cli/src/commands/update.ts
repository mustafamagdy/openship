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
 */
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliUpdatePlan, cliInstallCommand, type CliPackageManager } from "@repo/core";
import { assetUrl, expectedSha256, resolveLatestTag } from "../lib/github-releases";
import { restart as restartService } from "../lib/service";
import { readInstallMethod, composeUpdate } from "../lib/compose";
import { err, info, isJsonMode, ok, printJson } from "../lib/output";
import {
  loadUpdateSource,
  normalizeUpdateSource,
  saveUpdateSource,
  updateSourceLabel,
  UPSTREAM_RELEASE_REPO,
  type UpdateChannel,
  type UpdateSource,
} from "../lib/update-source";

declare const __CLI_VERSION__: string;

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
  .action(async (opts) => {
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
          : (await resolveLatestTag(source.repo)).replace(/^v/, "");
    } catch {
      err("Could not reach GitHub to check for updates. Try again, or reinstall manually.");
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

    const argv = pm === "bun" ? ["add", "-g", installRef] : ["install", "-g", installRef];
    const installDescription =
      source.repo === UPSTREAM_RELEASE_REPO
        ? cliInstallCommand(pm, latest)
        : `${pm} install verified ${source.repo} release bundle`;
    info(`Updating v${current} → v${latest} (${installDescription})...`);
    const res = spawnSync(pm, argv, {
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
        ok(`Updated to v${latest} and pulled the new images — the compose stack is on the new version.`);
      } else {
        err(`Updated the CLI to v${latest}, but \`docker compose pull\` failed. Run \`openship up\` to retry.`);
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
    const ports = JSON.parse(
      readFileSync(join(homedir(), ".openship", "ports.json"), "utf8"),
    ) as { api?: unknown };
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
