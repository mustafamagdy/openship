import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findByGitRepo,
  claim,
  markProcessed,
  triggerDeployment,
  resolveOrgOwner,
  decrypt,
  handlePullRequestPreview,
} = vi.hoisted(() => ({
  findByGitRepo: vi.fn(),
  claim: vi.fn(),
  markProcessed: vi.fn(),
  triggerDeployment: vi.fn(),
  resolveOrgOwner: vi.fn(),
  decrypt: vi.fn((value: string) => value),
  handlePullRequestPreview: vi.fn(),
}));

vi.mock("@repo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/db")>();
  return {
    ...actual,
    repos: {
      project: { findByGitRepo },
      webhookDelivery: { claim, markProcessed },
    },
  };
});

vi.mock("../../../src/lib/encryption", () => ({ decrypt }));
vi.mock("../../../src/lib/org-actor", () => ({ resolveOrgOwner }));
vi.mock("../../../src/modules/deployments/build.service", () => ({
  triggerDeployment,
}));
vi.mock("../../../src/modules/projects/pull-request-preview.service", () => ({
  handlePullRequestPreview,
}));

import { azureDevopsWebhookProvider } from "../../../src/modules/azure-devops/azure-devops.webhook";

function pushPayload(branch = "main") {
  return {
    id: `delivery-${branch}`,
    subscriptionId: "subscription-1",
    eventType: "git.push",
    resource: {
      refUpdates: [
        {
          name: `refs/heads/${branch}`,
          oldObjectId: "1".repeat(40),
          newObjectId: "2".repeat(40),
        },
      ],
      commits: [
        {
          commitId: "2".repeat(40),
          comment: `Push ${branch}`,
        },
      ],
      repository: {
        id: "repo-1",
        name: "relay",
        remoteUrl: "https://dev.azure.com/geeksclub/relay/_git/relay",
        project: { id: "project-1", name: "relay" },
      },
    },
    resourceContainers: {
      account: { baseUrl: "https://dev.azure.com/geeksclub/" },
    },
  };
}

const project = {
  id: "openship-project",
  organizationId: "org-1",
  gitProvider: "azure-devops",
  gitOwner: "geeksclub/relay",
  gitRepo: "relay",
  gitBranch: "main",
  autoDeploy: true,
  webhookSecret: "hook-secret",
  webhookExternalId: "subscription-1",
};

describe("azureDevopsWebhookProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByGitRepo.mockResolvedValue([project]);
    claim.mockResolvedValue({ claimed: true, id: "wdl-azure-1" });
    markProcessed.mockResolvedValue(undefined);
    resolveOrgOwner.mockResolvedValue({ userId: "owner-1" });
    triggerDeployment.mockResolvedValue(undefined);
    handlePullRequestPreview.mockResolvedValue([
      { projectId: project.id, action: "deployed" },
    ]);
  });

  it("accepts only the per-repository Basic auth secret", async () => {
    const payload = JSON.stringify(pushPayload());
    const valid = await azureDevopsWebhookProvider.verify(payload, {
      authorization: `Basic ${Buffer.from("openship:hook-secret").toString("base64")}`,
    });
    expect(valid).toEqual({ valid: true });

    const invalid = await azureDevopsWebhookProvider.verify(payload, {
      authorization: `Basic ${Buffer.from("openship:wrong").toString("base64")}`,
    });
    expect(invalid.valid).toBe(false);
  });

  it("routes a branch push to the matching auto-deploy project", async () => {
    const result = await azureDevopsWebhookProvider.handle(pushPayload(), {
      authorization: `Basic ${Buffer.from("openship:hook-secret").toString("base64")}`,
    });

    expect(result.success).toBe(true);
    expect(findByGitRepo).toHaveBeenCalledWith("geeksclub/relay", "relay");
    expect(triggerDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        organizationId: "org-1",
      }),
      {
        projectId: "openship-project",
        branch: "main",
        trigger: "webhook",
        commitSha: "2".repeat(40),
        commitMessage: "Push main",
      },
    );
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "azure-devops",
        deliveryId: "azure-devops:subscription-1:delivery-main",
      }),
    );
    expect(markProcessed).toHaveBeenCalledWith(
      "wdl-azure-1",
      expect.objectContaining({ outcome: "dispatched" }),
    );
  });

  it("does not deploy an environment tracking another branch", async () => {
    const result = await azureDevopsWebhookProvider.handle(
      pushPayload("develop"),
      {
        authorization: `Basic ${Buffer.from("openship:hook-secret").toString("base64")}`,
      },
    );
    expect(result.success).toBe(true);
    expect(triggerDeployment).not.toHaveBeenCalled();
  });

  it("ignores a duplicate delivery", async () => {
    claim.mockResolvedValue({ claimed: false, id: "" });
    const result = await azureDevopsWebhookProvider.handle(pushPayload(), {
      authorization: `Basic ${Buffer.from("openship:hook-secret").toString("base64")}`,
    });
    expect(result.message).toBe("Duplicate delivery ignored");
    expect(triggerDeployment).not.toHaveBeenCalled();
  });

  it("does not trigger a second OpenShip organization linked to the same Azure repo", async () => {
    findByGitRepo.mockResolvedValue([
      project,
      {
        ...project,
        id: "other-project",
        organizationId: "org-2",
        webhookSecret: "other-secret",
        webhookExternalId: "subscription-2",
      },
    ]);

    await azureDevopsWebhookProvider.handle(pushPayload(), {
      authorization: `Basic ${Buffer.from("openship:hook-secret").toString("base64")}`,
    });

    expect(triggerDeployment).toHaveBeenCalledTimes(1);
    expect(triggerDeployment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "openship-project" }),
    );
  });

  it("routes pull request updates to the authorized preview lifecycle", async () => {
    const payload = {
      id: "delivery-pr-42",
      subscriptionId: "subscription-pr-updated",
      eventType: "git.pullrequest.updated",
      resource: {
        pullRequestId: 42,
        status: "active",
        title: "Preview Azure change",
        sourceRefName: "refs/heads/feature/preview",
        lastMergeSourceCommit: { commitId: "3".repeat(40) },
        repository: {
          id: "repo-1",
          name: "relay",
          remoteUrl: "https://dev.azure.com/geeksclub/relay/_git/relay",
          project: { id: "project-1", name: "relay" },
        },
      },
      resourceContainers: {
        account: { baseUrl: "https://dev.azure.com/geeksclub/" },
      },
    };

    const result = await azureDevopsWebhookProvider.handle(payload, {
      authorization: `Basic ${Buffer.from("openship:hook-secret").toString("base64")}`,
    });

    expect(result.success).toBe(true);
    expect(handlePullRequestPreview).toHaveBeenCalledWith({
      provider: "azure-devops",
      action: "upsert",
      owner: "geeksclub/relay",
      repo: "relay",
      pullRequestNumber: 42,
      branch: "feature/preview",
      commitSha: "3".repeat(40),
      title: "Preview Azure change",
      projectIds: [project.id],
    });
  });
});
