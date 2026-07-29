import "../mail/_setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const domainRepo = vi.hoisted(() => ({
  getPrimaryByProject: vi.fn(),
}));
const checkRunRepo = vi.hoisted(() => ({
  createRollup: vi.fn(),
  findRollup: vi.fn(),
  completeRollup: vi.fn(),
}));
const createCheckRun = vi.hoisted(() => vi.fn());
const updateCheckRun = vi.hoisted(() => vi.fn());
const publishPullRequestStatus = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({
  repos: {
    domain: domainRepo,
    deploymentCheckRun: checkRunRepo,
  },
}));

vi.mock("../../../src/lib/org-actor", () => ({
  resolveOrgOwner: vi.fn().mockResolvedValue({ userId: "owner-1" }),
}));

vi.mock("../../../src/modules/github/github.service", () => ({
  createCheckRun,
  updateCheckRun,
}));

vi.mock("../../../src/modules/azure-devops/azure-devops.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/modules/azure-devops/azure-devops.service")>();
  return {
    ...actual,
    publishPullRequestStatus,
  };
});

import {
  beginPullRequestPreviewStatus,
  completePullRequestPreviewStatus,
} from "../../../src/modules/deployments/pull-request-preview-status";

const project = {
  id: "proj-preview",
  organizationId: "org-1",
  environmentType: "preview",
  environmentSlug: "pr-42",
  gitProvider: "github",
  gitOwner: "acme",
  gitRepo: "site",
  gitBranch: "feature/preview",
};

const deployment = {
  id: "dep-1",
  projectId: project.id,
  organizationId: project.organizationId,
  commitSha: "abc123",
};

describe("pull request preview status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRunRepo.createRollup.mockResolvedValue(undefined);
    checkRunRepo.findRollup.mockResolvedValue(undefined);
    checkRunRepo.completeRollup.mockResolvedValue(undefined);
    publishPullRequestStatus.mockResolvedValue(undefined);
    domainRepo.getPrimaryByProject.mockResolvedValue({
      hostname: "site-pr-42.opsh.io",
    });
  });

  it("publishes and persists a GitHub check linked to the preview URL", async () => {
    createCheckRun.mockResolvedValue({ id: 99 });

    await beginPullRequestPreviewStatus(project as any, deployment as any);

    expect(createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      "acme",
      "site",
      expect.objectContaining({
        name: "openship/preview",
        headSha: "abc123",
        status: "in_progress",
        detailsUrl: "https://site-pr-42.opsh.io",
      }),
    );
    expect(checkRunRepo.createRollup).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        checkRunId: 99,
      }),
    );
  });

  it("completes the same GitHub check when deployment succeeds", async () => {
    checkRunRepo.findRollup.mockResolvedValue({ checkRunId: 99 });

    await completePullRequestPreviewStatus(project as any, deployment as any, "success");

    expect(updateCheckRun).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "site",
      99,
      expect.objectContaining({
        status: "completed",
        conclusion: "success",
        detailsUrl: "https://site-pr-42.opsh.io",
      }),
    );
    expect(checkRunRepo.completeRollup).toHaveBeenCalledWith("dep-1", "success");
  });

  it("updates the Azure PR status with the same preview target", async () => {
    await beginPullRequestPreviewStatus(
      {
        ...project,
        gitProvider: "azure-devops",
        gitOwner: "geeksclub/relay",
        gitRepo: "site",
      } as any,
      deployment as any,
    );

    expect(publishPullRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      {
        organization: "geeksclub",
        project: "relay",
        repo: "site",
      },
      42,
      expect.objectContaining({
        state: "pending",
        targetUrl: "https://site-pr-42.opsh.io",
      }),
    );
  });
});
