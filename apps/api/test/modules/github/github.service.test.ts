import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  githubFetch,
  listRegisteredGitHubDeployWebhooks,
  resolveOrgOwner,
  decrypt,
} = vi.hoisted(() => ({
  githubFetch: vi.fn(),
  listRegisteredGitHubDeployWebhooks: vi.fn(),
  resolveOrgOwner: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("../../../src/modules/github/github.auth", () => ({
  githubFetch,
  getUserStatus: vi.fn(),
  getUserInstallations: vi.fn(),
  mapAccounts: vi.fn(),
  getGitHubAuthMode: vi.fn(),
}));

vi.mock("../../../src/modules/github/github.local-auth", () => ({
  getLocalGhStatus: vi.fn(),
}));

vi.mock("../../../src/config/env", () => ({
  env: {},
  runtimeTarget: { id: "local" },
}));

vi.mock("@repo/db", () => ({
  repos: {
    project: {
      listRegisteredGitHubDeployWebhooks,
    },
  },
}));

vi.mock("../../../src/lib/org-actor", () => ({
  resolveOrgOwner,
}));

vi.mock("../../../src/lib/request-context", () => ({
  buildBackgroundContext: vi.fn((input) => input),
}));

vi.mock("../../../src/lib/encryption", () => ({
  encrypt: vi.fn(),
  decrypt,
}));

vi.mock("../../../src/lib/public-url", () => ({
  resolveApiPublicUrl: vi.fn(() => "https://openship.example.com"),
  sharedWebhookUrl: vi.fn(() => "https://openship.example.com/api/webhooks/github"),
  domainWebhookUrl: vi.fn(
    (domain: string) => `https://${domain}/_openship/hooks/github`,
  ),
}));

import {
  listRepositoryTree,
  reconcileGitHubDeployWebhookEvents,
} from "../../../src/modules/github/github.service";

function createFile(name: string, path: string) {
  return {
    name,
    path,
    sha: `${path}-sha`,
    size: 1,
    type: "file" as const,
    download_url: null,
  };
}

function createDir(name: string, path: string) {
  return {
    name,
    path,
    sha: `${path}-sha`,
    size: 0,
    type: "dir" as const,
    download_url: null,
  };
}

describe("listRepositoryTree", () => {
  beforeEach(() => {
    githubFetch.mockReset();
  });

  it("falls back to repository contents when the recursive git tree is truncated", async () => {
    githubFetch.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes("/git/trees/")) {
        return {
          sha: "tree-sha",
          truncated: true,
          tree: [{ path: "apps", mode: "040000", type: "tree", sha: "apps-sha", url: "" }],
        };
      }

      if (url.endsWith("/contents/")) {
        return [createDir("apps", "apps"), createFile("package.json", "package.json")];
      }

      if (url.endsWith("/contents/apps")) {
        return [createDir("web", "apps/web")];
      }

      if (url.endsWith("/contents/apps/web")) {
        return [createFile("package.json", "apps/web/package.json")];
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const tree = await listRepositoryTree("user-1", "openship", "repo", { branch: "main" });

    expect(tree).toEqual([
      { path: "apps", type: "dir" },
      { path: "package.json", type: "file" },
      { path: "apps/web", type: "dir" },
      { path: "apps/web/package.json", type: "file" },
    ]);
    expect(githubFetch).toHaveBeenCalledTimes(4);
  });
});

describe("reconcileGitHubDeployWebhookEvents", () => {
  beforeEach(() => {
    githubFetch.mockReset();
    listRegisteredGitHubDeployWebhooks.mockReset();
    resolveOrgOwner.mockReset();
    decrypt.mockReset();
  });

  it("upgrades an existing production webhook to push and pull-request events", async () => {
    listRegisteredGitHubDeployWebhooks.mockResolvedValue([
      {
        id: "project-1",
        organizationId: "org-1",
        gitOwner: "oblien",
        gitRepo: "openship",
        webhookId: 42,
        webhookSecret: "encrypted-secret",
        webhookDomain: null,
      },
    ]);
    resolveOrgOwner.mockResolvedValue({ userId: "user-1" });
    decrypt.mockReturnValue("plain-secret");
    githubFetch.mockResolvedValue({
      id: 42,
      active: true,
      events: ["push", "pull_request"],
    });

    await reconcileGitHubDeployWebhookEvents();

    expect(githubFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "oblien",
        method: "PATCH",
        url: "https://api.github.com/repos/oblien/openship/hooks/42",
        params: expect.objectContaining({
          active: true,
          events: ["push", "pull_request"],
          config: expect.objectContaining({ secret: "plain-secret" }),
        }),
      }),
    );
  });
});
