import "../mail/_setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectRepo = vi.hoisted(() => ({
  findByGitRepo: vi.fn(),
  listByGroup: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  listEnvVars: vi.fn(),
  setEnvVar: vi.fn(),
}));

const domainRepo = vi.hoisted(() => ({
  getPrimaryByProject: vi.fn(),
}));

const serviceRepo = vi.hoisted(() => ({
  listByProject: vi.fn(),
  create: vi.fn(),
}));

const createProjectEnvironment = vi.hoisted(() => vi.fn());
const teardownProject = vi.hoisted(() => vi.fn());
const triggerDeployment = vi.hoisted(() => vi.fn());
const beginPullRequestPreviewStatus = vi.hoisted(() => vi.fn());
const completePullRequestPreviewStatus = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => ({
  repos: {
    project: projectRepo,
    domain: domainRepo,
    service: serviceRepo,
  },
}));

vi.mock("../../../src/lib/org-actor", () => ({
  resolveOrgOwner: vi.fn().mockResolvedValue({ userId: "user_123" }),
}));

vi.mock("../../../src/modules/projects/project-crud.service", () => ({
  createProjectEnvironment,
}));

vi.mock("../../../src/modules/projects/project-teardown", () => ({
  teardownProject,
}));

vi.mock("../../../src/modules/deployments/build.service", () => ({
  triggerDeployment,
}));

vi.mock("../../../src/modules/deployments/pull-request-preview-status", () => ({
  beginPullRequestPreviewStatus,
  completePullRequestPreviewStatus,
}));

import { handlePullRequestPreview } from "../../../src/modules/projects/pull-request-preview.service";

const productionProject = {
  id: "proj_production",
  slug: "site",
  groupId: "group_123",
  organizationId: "org_123",
  gitProvider: "github",
  gitOwner: "acme",
  gitRepo: "site",
  environmentSlug: "production",
  environmentType: "production",
  autoDeploy: true,
};

const previewProject = {
  ...productionProject,
  id: "proj_preview",
  environmentSlug: "pr-42",
  environmentType: "preview",
  environmentName: "PR #42",
  slug: "site-pr-42",
  gitBranch: "feature/preview",
};

describe("pull request preview lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRepo.findByGitRepo.mockResolvedValue([productionProject]);
    projectRepo.listByGroup.mockResolvedValue([productionProject]);
    projectRepo.findById.mockResolvedValue(previewProject);
    projectRepo.listEnvVars.mockResolvedValue([]);
    serviceRepo.listByProject.mockResolvedValue([]);
    createProjectEnvironment.mockResolvedValue({ id: previewProject.id });
    domainRepo.getPrimaryByProject.mockResolvedValue({
      hostname: "site-pr-42.opsh.io",
    });
    triggerDeployment.mockResolvedValue({
      deployment: {
        id: "dep_123",
        projectId: previewProject.id,
        commitSha: "abc123",
        status: "queued",
      },
      skipped: false,
    });
  });

  it("creates a stable preview environment and starts its deployment status", async () => {
    serviceRepo.listByProject.mockResolvedValue([
      {
        id: "svc_prod",
        projectId: productionProject.id,
        name: "web",
        kind: "compose",
        exposed: true,
        domain: "site-web",
        customDomain: null,
        domainType: "free",
        publicEndpoints: [{ port: 3000, domainType: "free", domain: "site-web" }],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    serviceRepo.create.mockResolvedValue({ id: "svc_preview" });
    projectRepo.listEnvVars.mockResolvedValue([
      {
        serviceId: "svc_prod",
        key: "DATABASE_URL",
        value: "encrypted-value",
        isSecret: true,
      },
    ]);

    const results = await handlePullRequestPreview({
      provider: "github",
      action: "upsert",
      owner: "acme",
      repo: "site",
      pullRequestNumber: 42,
      branch: "feature/preview",
      commitSha: "abc123",
      title: "Preview this change",
    });

    expect(createProjectEnvironment).toHaveBeenCalledWith(
      productionProject.id,
      expect.objectContaining({ organizationId: "org_123" }),
      expect.objectContaining({
        environmentName: "PR #42",
        environmentSlug: "pr-42",
        environmentType: "preview",
        gitBranch: "feature/preview",
      }),
    );
    expect(triggerDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_123" }),
      expect.objectContaining({
        projectId: previewProject.id,
        branch: "feature/preview",
        commitSha: "abc123",
        environment: "preview",
      }),
    );
    expect(serviceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: previewProject.id,
        domain: "site-pr-42-web",
        customDomain: null,
        domainType: "free",
      }),
    );
    expect(projectRepo.listEnvVars).toHaveBeenCalledWith(productionProject.id, "preview");
    expect(projectRepo.setEnvVar).toHaveBeenCalledWith({
      projectId: previewProject.id,
      environment: "preview",
      serviceId: "svc_preview",
      key: "DATABASE_URL",
      value: "encrypted-value",
      isSecret: true,
    });
    expect(beginPullRequestPreviewStatus).toHaveBeenCalledWith(
      previewProject,
      expect.objectContaining({ id: "dep_123" }),
      "https://site-pr-42.opsh.io",
    );
    expect(results).toEqual([
      expect.objectContaining({
        action: "deployed",
        environmentId: previewProject.id,
        previewUrl: "https://site-pr-42.opsh.io",
      }),
    ]);
  });

  it("tears down the preview environment when the pull request closes", async () => {
    projectRepo.listByGroup.mockResolvedValue([productionProject, previewProject]);
    teardownProject.mockResolvedValue({
      rowDeleted: true,
      unrecoverable: [],
    });

    const results = await handlePullRequestPreview({
      provider: "github",
      action: "close",
      owner: "acme",
      repo: "site",
      pullRequestNumber: 42,
      branch: "feature/preview",
    });

    expect(teardownProject).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_123" }),
      previewProject.id,
      expect.objectContaining({
        force: true,
        preserveWebhook: true,
        wipeVolumes: true,
      }),
    );
    expect(results[0]).toMatchObject({
      action: "removed",
      environmentId: previewProject.id,
    });
  });

  it("does not cross an Azure webhook's authorized project boundary", async () => {
    projectRepo.findByGitRepo.mockResolvedValue([
      { ...productionProject, gitProvider: "azure-devops" },
      {
        ...productionProject,
        id: "proj_other_org",
        groupId: "group_other",
        organizationId: "org_other",
        gitProvider: "azure-devops",
      },
    ]);

    await handlePullRequestPreview({
      provider: "azure-devops",
      action: "upsert",
      owner: "azure:acme/project",
      repo: "site",
      pullRequestNumber: 42,
      branch: "feature/preview",
      projectIds: [productionProject.id],
    });

    expect(createProjectEnvironment).toHaveBeenCalledTimes(1);
    expect(createProjectEnvironment).toHaveBeenCalledWith(
      productionProject.id,
      expect.anything(),
      expect.anything(),
    );
  });
});
