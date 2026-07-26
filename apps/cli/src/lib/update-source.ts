import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const UPSTREAM_RELEASE_REPO = "oblien/openship";
export const UPDATE_SOURCE_FILE = join(homedir(), ".openship", "update-source.json");

export type UpdateChannel = "upstream" | "fork" | "pinned";

export interface UpdateSource {
  channel: UpdateChannel;
  repo: string;
  pinnedVersion?: string;
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, "");
}

export function validateReleaseRepo(value: string): string {
  const repo = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repository "${value}". Expected owner/repository.`);
  }
  return repo;
}

export function normalizeUpdateSource(input: Partial<UpdateSource>): UpdateSource {
  const channel = input.channel ?? "upstream";
  if (!["upstream", "fork", "pinned"].includes(channel)) {
    throw new Error(`Invalid update channel "${String(channel)}".`);
  }

  const repo =
    channel === "upstream"
      ? UPSTREAM_RELEASE_REPO
      : validateReleaseRepo(input.repo ?? "");

  if (channel === "pinned") {
    const pinnedVersion = normalizeVersion(input.pinnedVersion ?? "");
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pinnedVersion)) {
      throw new Error("Pinned update sources require a semantic version.");
    }
    return { channel, repo, pinnedVersion };
  }

  return { channel, repo };
}

export function loadUpdateSource(
  path = UPDATE_SOURCE_FILE,
  env: NodeJS.ProcessEnv = process.env,
): UpdateSource {
  const envRepo = env.OPENSHIP_RELEASE_REPO?.trim();
  const envPinned = env.OPENSHIP_UPDATE_VERSION?.trim();
  if (envRepo || envPinned) {
    return normalizeUpdateSource({
      channel: envPinned ? "pinned" : envRepo === UPSTREAM_RELEASE_REPO ? "upstream" : "fork",
      repo: envRepo || UPSTREAM_RELEASE_REPO,
      pinnedVersion: envPinned,
    });
  }

  if (!existsSync(path)) return normalizeUpdateSource({ channel: "upstream" });
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<UpdateSource>;
    return normalizeUpdateSource(parsed);
  } catch {
    return normalizeUpdateSource({ channel: "upstream" });
  }
}

export function saveUpdateSource(source: UpdateSource, path = UPDATE_SOURCE_FILE): UpdateSource {
  const normalized = normalizeUpdateSource(source);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

export function updateSourceLabel(source: UpdateSource): string {
  if (source.channel === "upstream") return `upstream stable (${source.repo})`;
  if (source.channel === "pinned") {
    return `pinned v${source.pinnedVersion} (${source.repo})`;
  }
  return `fork stable (${source.repo})`;
}
