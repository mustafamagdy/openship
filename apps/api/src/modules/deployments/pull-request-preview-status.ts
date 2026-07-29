import { repos, type Deployment, type Project } from "@repo/db";
import { runtimeTarget } from "../../config";
import { buildBackgroundContext } from "../../lib/request-context";
import { resolveOrgOwner } from "../../lib/org-actor";
import { createCheckRun, updateCheckRun } from "../github/github.service";
import {
  parseAzureRepoOwner,
  publishPullRequestStatus,
} from "../azure-devops/azure-devops.service";

const CHECK_NAME = "openship/preview";

function pullRequestNumber(project: Project): number | null {
  if (project.environmentType !== "preview") return null;
  const match = project.environmentSlug.match(/^pr-(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function actorContext(project: Project) {
  const owner = await resolveOrgOwner(project.organizationId).catch(() => null);
  if (!owner) return null;
  return buildBackgroundContext({
    userId: owner.userId,
    organizationId: project.organizationId,
    label: "pull-request:preview-status",
  });
}

async function stablePreviewUrl(
  project: Project,
  deploymentId: string,
  explicitUrl?: string | null,
): Promise<string> {
  const primary = await repos.domain.getPrimaryByProject(project.id).catch(() => null);
  if (primary?.hostname) return `https://${primary.hostname}`;
  if (explicitUrl) return explicitUrl;
  return `${runtimeTarget.dashboard.replace(/\/$/, "")}/build/${deploymentId}`;
}

export async function beginPullRequestPreviewStatus(
  project: Project,
  deployment: Deployment,
  previewUrl?: string | null,
): Promise<void> {
  const prNumber = pullRequestNumber(project);
  if (!prNumber || !deployment.commitSha || !project.gitOwner || !project.gitRepo) return;

  const ctx = await actorContext(project);
  if (!ctx) return;
  const targetUrl = await stablePreviewUrl(project, deployment.id, previewUrl);

  if (project.gitProvider === "azure-devops") {
    await publishPullRequestStatus(
      ctx,
      parseAzureRepoOwner(project.gitOwner, project.gitRepo),
      prNumber,
      {
        state: "pending",
        description: "OpenShip is deploying this preview.",
        targetUrl,
      },
    ).catch(() => undefined);
    return;
  }

  const existing = await repos.deploymentCheckRun.findRollup(deployment.id).catch(() => undefined);
  if (existing) return;

  const check = await createCheckRun(ctx, project.gitOwner, project.gitRepo, {
    name: CHECK_NAME,
    headSha: deployment.commitSha,
    status: "in_progress",
    detailsUrl: targetUrl,
    output: {
      title: "Preview deployment in progress",
      summary: `OpenShip is deploying ${project.gitBranch ?? "the pull request branch"}.`,
    },
  });
  if (!check?.id) return;
  const stored = await repos.deploymentCheckRun
    .createRollup({
      deploymentId: deployment.id,
      checkRunId: check.id,
      name: CHECK_NAME,
      status: "in_progress",
    })
    .catch(() => undefined);
  if (stored && stored.checkRunId !== check.id) {
    await updateCheckRun(ctx, project.gitOwner, project.gitRepo, check.id, {
      status: "completed",
      conclusion: "neutral",
      detailsUrl: targetUrl,
      output: {
        title: "Duplicate preview delivery ignored",
        summary: "Another OpenShip preview check already tracks this deployment.",
      },
    });
  }
}

export async function completePullRequestPreviewStatus(
  project: Project,
  deployment: Deployment,
  outcome: "success" | "failure" | "cancelled",
  opts: { previewUrl?: string | null; error?: string | null } = {},
): Promise<void> {
  const prNumber = pullRequestNumber(project);
  if (!prNumber || !deployment.commitSha || !project.gitOwner || !project.gitRepo) return;

  const ctx = await actorContext(project);
  if (!ctx) return;
  const targetUrl = await stablePreviewUrl(project, deployment.id, opts.previewUrl);
  const succeeded = outcome === "success";
  const title = succeeded
    ? "Preview is ready"
    : outcome === "cancelled"
      ? "Preview deployment cancelled"
      : "Preview deployment failed";
  const summary = succeeded ? `Preview URL: ${targetUrl}` : (opts.error ?? title);

  if (project.gitProvider === "azure-devops") {
    await publishPullRequestStatus(
      ctx,
      parseAzureRepoOwner(project.gitOwner, project.gitRepo),
      prNumber,
      {
        state: succeeded ? "succeeded" : outcome === "cancelled" ? "notApplicable" : "failed",
        description: title,
        targetUrl,
      },
    ).catch(() => undefined);
    return;
  }

  const stored = await repos.deploymentCheckRun.findRollup(deployment.id).catch(() => undefined);
  if (stored) {
    await updateCheckRun(ctx, project.gitOwner, project.gitRepo, stored.checkRunId, {
      status: "completed",
      conclusion: outcome,
      detailsUrl: targetUrl,
      output: { title, summary },
    });
    await repos.deploymentCheckRun.completeRollup(deployment.id, outcome).catch(() => undefined);
    return;
  }

  await createCheckRun(ctx, project.gitOwner, project.gitRepo, {
    name: CHECK_NAME,
    headSha: deployment.commitSha,
    status: "completed",
    conclusion: outcome,
    detailsUrl: targetUrl,
    output: { title, summary },
  });
}
