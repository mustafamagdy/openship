import { beforeEach, describe, expect, it, vi } from "vitest";

const handlePullRequestPreview = vi.hoisted(() => vi.fn());

vi.mock("../../../src/modules/projects/pull-request-preview.service", () => ({
  handlePullRequestPreview,
}));

import { handlePullRequest } from "../../../src/modules/github/webhook-pull-request";

function payload(action: "opened" | "synchronize" | "closed") {
  return {
    action,
    number: 42,
    pull_request: {
      number: 42,
      title: "Preview this change",
      state: action === "closed" ? "closed" : "open",
      head: {
        ref: "feature/preview",
        sha: "abc123",
        repo: { full_name: "acme/site" },
      },
      base: { ref: "main", sha: "def456" },
    },
    repository: {
      name: "site",
      full_name: "acme/site",
      owner: { login: "acme", id: 1 },
    },
    sender: { id: 2, login: "developer" },
  } as const;
}

describe("GitHub pull request previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlePullRequestPreview.mockResolvedValue([{ projectId: "proj-1", action: "deployed" }]);
  });

  it("deploys opened and synchronized pull requests", async () => {
    const result = await handlePullRequest(payload("synchronize") as any);

    expect(result.success).toBe(true);
    expect(handlePullRequestPreview).toHaveBeenCalledWith({
      provider: "github",
      action: "upsert",
      owner: "acme",
      repo: "site",
      pullRequestNumber: 42,
      branch: "feature/preview",
      commitSha: "abc123",
      title: "Preview this change",
    });
  });

  it("removes the preview when the pull request closes", async () => {
    await handlePullRequest(payload("closed") as any);
    expect(handlePullRequestPreview).toHaveBeenCalledWith(
      expect.objectContaining({ action: "close", pullRequestNumber: 42 }),
    );
  });

  it("does not clone code from fork pull requests", async () => {
    const fork = payload("opened");
    const result = await handlePullRequest({
      ...fork,
      pull_request: {
        ...fork.pull_request,
        head: {
          ...fork.pull_request.head,
          repo: { full_name: "contributor/site" },
        },
      },
    } as any);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Fork");
    expect(handlePullRequestPreview).not.toHaveBeenCalled();
  });
});
