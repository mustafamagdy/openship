import { beforeEach, describe, expect, it, vi } from "vitest";

const findByGitRepo = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const createPushSubscription = vi.hoisted(() => vi.fn());
const createPullRequestSubscriptions = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({
  repos: {
    project: { findByGitRepo, update },
  },
}));

vi.mock("../../../src/lib/encryption", () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^encrypted:/, "")),
}));

vi.mock("../../../src/modules/azure-devops/azure-devops.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/modules/azure-devops/azure-devops.service")>();
  return {
    ...actual,
    createPushSubscription,
    createPullRequestSubscriptions,
  };
});

import { ensureAzureDevopsPushWebhook } from "../../../src/modules/azure-devops/azure-devops.webhook-management";

const context = {
  organizationId: "org-1",
  userId: "user-1",
};

const project = {
  id: "proj-1",
  organizationId: "org-1",
  gitProvider: "azure-devops",
  gitOwner: "geeksclub/relay",
  gitRepo: "relay",
  webhookExternalId: null,
  webhookSecret: null,
};

describe("Azure DevOps webhook management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByGitRepo.mockResolvedValue([project]);
    createPushSubscription.mockResolvedValue({ id: "push-id" });
    createPullRequestSubscriptions.mockResolvedValue({
      created: "pr-created-id",
      updated: "pr-updated-id",
    });
  });

  it("registers push, PR-created, and PR-updated subscriptions as one bundle", async () => {
    const externalId = await ensureAzureDevopsPushWebhook(context as any, project as any);

    expect(JSON.parse(externalId)).toEqual({
      push: "push-id",
      pullRequestCreated: "pr-created-id",
      pullRequestUpdated: "pr-updated-id",
    });
    expect(update).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        webhookExternalId: externalId,
        webhookSecret: expect.stringMatching(/^encrypted:/),
      }),
    );
  });
});
