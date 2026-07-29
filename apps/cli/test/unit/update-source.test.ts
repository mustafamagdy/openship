import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadUpdateSource,
  normalizeReleaseVersion,
  normalizeUpdateSource,
  saveUpdateSource,
  UPSTREAM_RELEASE_REPO,
} from "../../src/lib/update-source";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function configPath() {
  const dir = mkdtempSync(join(tmpdir(), "openship-update-source-test-"));
  dirs.push(dir);
  return join(dir, "source.json");
}

describe("update source", () => {
  it("defaults to upstream stable", () => {
    expect(loadUpdateSource(configPath(), {})).toEqual({
      channel: "upstream",
      repo: UPSTREAM_RELEASE_REPO,
    });
  });

  it("persists a fork release repository", () => {
    const path = configPath();
    saveUpdateSource({ channel: "fork", repo: "mustafamagdy/openship" }, path);
    expect(loadUpdateSource(path, {})).toEqual({
      channel: "fork",
      repo: "mustafamagdy/openship",
    });
  });

  it("requires a semantic version for pinned sources", () => {
    expect(() =>
      normalizeUpdateSource({
        channel: "pinned",
        repo: "mustafamagdy/openship",
        pinnedVersion: "main",
      }),
    ).toThrow(/semantic version/i);
  });

  it("rejects malformed or command-shaped release tags", () => {
    expect(normalizeReleaseVersion("v0.4.0")).toBe("0.4.0");
    expect(() => normalizeReleaseVersion("v0.4.0;whoami")).toThrow(/release version/i);
    expect(() => normalizeReleaseVersion("v0.4.0-../../payload")).toThrow(/release version/i);
    expect(() => normalizeReleaseVersion("release-main")).toThrow(/release version/i);
  });

  it("lets service environment override the persisted source", () => {
    const path = configPath();
    saveUpdateSource({ channel: "upstream", repo: UPSTREAM_RELEASE_REPO }, path);
    expect(
      loadUpdateSource(path, {
        OPENSHIP_RELEASE_REPO: "mustafamagdy/openship",
        OPENSHIP_UPDATE_VERSION: "v0.4.0",
      }),
    ).toEqual({
      channel: "pinned",
      repo: "mustafamagdy/openship",
      pinnedVersion: "0.4.0",
    });
  });
});
