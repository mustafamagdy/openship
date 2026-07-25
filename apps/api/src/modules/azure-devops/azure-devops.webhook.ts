import crypto from "node:crypto";
import { repos, type Project } from "@repo/db";
import { safeErrorMessage } from "@repo/core";
import { decrypt } from "../../lib/encryption";
import { buildBackgroundContext } from "../../lib/request-context";
import { resolveOrgOwner } from "../../lib/org-actor";
import { triggerDeployment } from "../deployments/build.service";
import { handlePullRequestPreview } from "../projects/pull-request-preview.service";
import type {
  WebhookHandlerResult,
  WebhookProvider,
  WebhookVerifyResult,
} from "../webhooks/webhook.types";
import { azureRepoOwner, normalizeAzureOrganization } from "./azure-devops.service";

interface AzurePushPayload {
  id?: string;
  subscriptionId?: string;
  eventType?: string;
  resource?: {
    refUpdates?: Array<{
      name?: string;
      oldObjectId?: string;
      newObjectId?: string;
    }>;
    commits?: Array<{
      commitId?: string;
      comment?: string;
    }>;
    pullRequestId?: number;
    status?: string;
    title?: string;
    sourceRefName?: string;
    lastMergeSourceCommit?: {
      commitId?: string;
    };
    repository?: {
      id?: string;
      name?: string;
      remoteUrl?: string;
      webUrl?: string;
      project?: { id?: string; name?: string };
    };
  };
  resourceContainers?: {
    account?: { baseUrl?: string };
    project?: { id?: string; baseUrl?: string };
  };
}

function organizationFromUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() === "dev.azure.com") {
      const organization = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
      return organization ? normalizeAzureOrganization(organization) : null;
    }
    const legacy = url.hostname.match(/^([^.]+)\.visualstudio\.com$/i)?.[1];
    return legacy ? normalizeAzureOrganization(legacy) : null;
  } catch {
    return null;
  }
}

function coordinates(payload: AzurePushPayload) {
  const repository = payload.resource?.repository;
  const project = repository?.project?.name?.trim();
  const repo = repository?.name?.trim();
  const organization =
    organizationFromUrl(payload.resourceContainers?.account?.baseUrl) ??
    organizationFromUrl(repository?.remoteUrl) ??
    organizationFromUrl(repository?.webUrl);
  if (!organization || !project || !repo) return null;
  return {
    organization,
    project,
    owner: azureRepoOwner(organization, project),
    repo,
  };
}

function basicPassword(authorization?: string): string | null {
  if (!authorization?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 ? decoded.slice(separator + 1) : null;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function matchingProjects(payload: AzurePushPayload): Promise<Project[]> {
  const coords = coordinates(payload);
  if (!coords) return [];
  const rows = await repos.project.findByGitRepo(coords.owner, coords.repo);
  return rows.filter((row) => row.gitProvider === "azure-devops");
}

function projectsAuthorizedByPassword(
  projects: Project[],
  password: string,
): Project[] {
  return projects.filter((project) => {
    if (!project.webhookSecret) return false;
    try {
      return constantTimeEqual(password, decrypt(project.webhookSecret));
    } catch {
      return false;
    }
  });
}

function deliveryKey(
  payload: AzurePushPayload,
  projects: Project[],
): string | null {
  if (!payload.id) return null;
  const subscription =
    payload.subscriptionId ??
    projects.find((project) => project.webhookExternalId)?.webhookExternalId ??
    "unknown-subscription";
  return `azure-devops:${subscription}:${payload.id}`;
}

async function verify(
  payload: string | Buffer,
  headers: Record<string, string>,
): Promise<WebhookVerifyResult> {
  let parsed: AzurePushPayload;
  try {
    parsed = JSON.parse(Buffer.isBuffer(payload) ? payload.toString("utf8") : payload);
  } catch {
    return { valid: false, error: "Invalid JSON body" };
  }

  const password = basicPassword(headers.authorization);
  if (!password) {
    return { valid: false, error: "Missing Azure DevOps webhook Basic authentication" };
  }
  const projects = await matchingProjects(parsed);
  if (projectsAuthorizedByPassword(projects, password).length === 0) {
    return { valid: false, error: "No matching Azure Repos webhook secret" };
  }
  return { valid: true };
}

async function deployProject(
  project: Project,
  branch: string,
  commitSha?: string,
  commitMessage?: string,
) {
  const owner = await resolveOrgOwner(project.organizationId);
  if (!owner) {
    throw new Error(`No organization owner is available for project ${project.id}`);
  }
  return triggerDeployment(
    buildBackgroundContext({
      userId: owner.userId,
      organizationId: project.organizationId,
      label: "azure-devops:webhook",
    }),
    {
      projectId: project.id,
      branch,
      trigger: "webhook",
      commitSha,
      commitMessage,
    },
  );
}

async function handle(
  raw: unknown,
  headers: Record<string, string>,
): Promise<WebhookHandlerResult> {
  const payload = raw as AzurePushPayload;
  const event = payload.eventType ?? "unknown";
  if (
    event !== "git.push" &&
    event !== "git.pullrequest.created" &&
    event !== "git.pullrequest.updated"
  ) {
    return { success: true, event, message: `Event '${event}' is not handled` };
  }

  const password = basicPassword(headers.authorization);
  if (!password) {
    return { success: false, event, message: "Missing webhook credentials" };
  }
  const projects = projectsAuthorizedByPassword(
    await matchingProjects(payload),
    password,
  );
  const dedupKey = deliveryKey(payload, projects);
  if (dedupKey) {
    const claimed = await repos.githubWebhookEvent
      .claim(dedupKey, event)
      .catch(() => true);
    if (!claimed) {
      return { success: true, event, message: "Duplicate delivery ignored" };
    }
  }

  if (
    event === "git.pullrequest.created" ||
    event === "git.pullrequest.updated"
  ) {
    const coords = coordinates(payload);
    const pullRequestId = payload.resource?.pullRequestId;
    const sourceRef = payload.resource?.sourceRefName;
    if (
      !coords ||
      !pullRequestId ||
      !sourceRef?.startsWith("refs/heads/")
    ) {
      return {
        success: false,
        event,
        message: "Missing Azure Repos pull request coordinates",
      };
    }

    const status = payload.resource?.status?.toLowerCase();
    const results = await handlePullRequestPreview({
      provider: "azure-devops",
      action:
        status === "completed" || status === "abandoned" ? "close" : "upsert",
      owner: coords.owner,
      repo: coords.repo,
      pullRequestNumber: pullRequestId,
      branch: sourceRef.replace(/^refs\/heads\//, ""),
      commitSha: payload.resource?.lastMergeSourceCommit?.commitId,
      title: payload.resource?.title,
      projectIds: projects.map((project) => project.id),
    });
    if (dedupKey) {
      await repos.githubWebhookEvent
        .markProcessed(dedupKey)
        .catch(() => undefined);
    }
    const failures = results.filter((result) => result.action === "failed");
    return {
      success: failures.length === 0,
      event,
      message:
        results.length === 0
          ? "No auto-deploy production project is linked to this repository"
          : `${results.length - failures.length} preview operation(s) completed, ${failures.length} failed`,
      ...(failures.length > 0
        ? {
            error: failures
              .map((result) => result.message)
              .filter(Boolean)
              .join("; "),
          }
        : {}),
    };
  }

  const commits = payload.resource?.commits ?? [];
  const results: PromiseSettledResult<unknown>[] = [];
  for (const update of payload.resource?.refUpdates ?? []) {
    if (!update.name?.startsWith("refs/heads/")) continue;
    if (!update.newObjectId || /^0+$/.test(update.newObjectId)) continue;
    const branch = update.name.replace(/^refs\/heads\//, "");
    const commit = commits.find((item) => item.commitId === update.newObjectId) ?? commits.at(-1);
    const matching = projects.filter(
      (project) =>
        project.autoDeploy &&
        (project.gitBranch?.trim() || "main") === branch,
    );
    results.push(
      ...(await Promise.allSettled(
        matching.map((project) =>
          deployProject(project, branch, update.newObjectId, commit?.comment),
        ),
      )),
    );
  }

  if (dedupKey) {
    await repos.githubWebhookEvent
      .markProcessed(dedupKey)
      .catch(() => undefined);
  }
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    console.error(
      "[Azure Repos Webhook] auto-deploy failures:",
      failures.map((failure) => safeErrorMessage(failure.reason)),
    );
  }
  return {
    success: failures.length === 0,
    event,
    message: `${results.length - failures.length} deployment(s) triggered, ${failures.length} failed`,
  };
}

export const azureDevopsWebhookProvider: WebhookProvider = {
  name: "azure-devops",
  verify,
  handle,
};
