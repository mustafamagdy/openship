import { repos, type Project } from "@repo/db";
import { safeErrorMessage } from "@repo/core";
import { buildBackgroundContext } from "../../lib/request-context";
import { resolveOrgOwner } from "../../lib/org-actor";
import { triggerDeployment } from "../deployments/build.service";
import {
  beginPullRequestPreviewStatus,
  completePullRequestPreviewStatus,
} from "../deployments/pull-request-preview-status";
import { createProjectEnvironment } from "./project-crud.service";
import { teardownProject } from "./project-teardown";

export interface PullRequestPreviewEvent {
  provider: "github" | "azure-devops";
  action: "upsert" | "close";
  owner: string;
  repo: string;
  pullRequestNumber: number;
  branch: string;
  commitSha?: string;
  title?: string;
  projectIds?: string[];
}

export interface PullRequestPreviewResult {
  projectId: string;
  environmentId?: string;
  deploymentId?: string;
  previewUrl?: string;
  action: "deployed" | "removed" | "skipped" | "failed";
  message?: string;
}

function previewSlug(pullRequestNumber: number) {
  return `pr-${pullRequestNumber}`;
}

async function previewUrl(projectId: string): Promise<string | undefined> {
  const primary = await repos.domain.getPrimaryByProject(projectId).catch(() => null);
  return primary?.hostname ? `https://${primary.hostname}` : undefined;
}

function routeSlug(projectSlug: string, serviceName: string, routeIndex = 0): string {
  const servicePart =
    serviceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16) || "service";
  const suffix = routeIndex > 0 ? `${servicePart}-${routeIndex + 1}` : servicePart;
  const projectPart = projectSlug.slice(0, Math.max(1, 63 - suffix.length - 1)).replace(/-+$/g, "");
  return `${projectPart}-${suffix}`.slice(0, 63).replace(/-+$/g, "");
}

/**
 * Preview environments are separate project rows. Copy the production
 * service graph and the source project's PREVIEW-scoped encrypted env values
 * once so the first PR deployment has the same runtime shape without exposing
 * production-only secrets. Public routes are replaced with isolated managed
 * preview hostnames.
 */
async function clonePreviewConfiguration(source: Project, preview: Project): Promise<void> {
  const sourceServices = await repos.service.listByProject(source.id);
  const serviceIds = new Map<string, string>();

  for (const service of sourceServices) {
    const {
      id,
      projectId,
      createdAt,
      updatedAt,
      domain,
      customDomain,
      domainType,
      publicEndpoints,
      ...configuration
    } = service;
    void projectId;
    void createdAt;
    void updatedAt;
    void domain;
    void customDomain;
    void domainType;

    const clonedEndpoints = (publicEndpoints ?? []).map((endpoint, index) => ({
      port: endpoint.port,
      domainType: "free" as const,
      domain: routeSlug(preview.slug, service.name, index),
    }));
    const cloned = await repos.service.create({
      ...configuration,
      projectId: preview.id,
      domain: service.exposed ? routeSlug(preview.slug, service.name) : null,
      customDomain: null,
      domainType: "free",
      publicEndpoints: clonedEndpoints,
    });
    serviceIds.set(id, cloned.id);
  }

  const variables = await repos.project.listEnvVars(source.id, "preview");
  await Promise.all(
    variables.map((variable) =>
      repos.project.setEnvVar({
        projectId: preview.id,
        environment: "preview",
        serviceId: variable.serviceId ? (serviceIds.get(variable.serviceId) ?? null) : null,
        key: variable.key,
        value: variable.value,
        isSecret: variable.isSecret,
      }),
    ),
  );
}

async function webhookContext(project: Project) {
  const owner = await resolveOrgOwner(project.organizationId).catch(() => null);
  if (!owner) {
    throw new Error(`No organization owner is available for project ${project.id}`);
  }
  return buildBackgroundContext({
    userId: owner.userId,
    organizationId: project.organizationId,
    label: `${project.gitProvider ?? "git"}:pull-request-preview`,
  });
}

export async function handlePullRequestPreview(
  event: PullRequestPreviewEvent,
): Promise<PullRequestPreviewResult[]> {
  const rows = await repos.project.findByGitRepo(event.owner, event.repo);
  const allowedProjectIds = event.projectIds ? new Set(event.projectIds) : null;
  const productionByGroup = new Map<string, Project>();
  for (const project of rows) {
    if (
      project.gitProvider === event.provider &&
      project.environmentSlug === "production" &&
      project.autoDeploy &&
      (!allowedProjectIds || allowedProjectIds.has(project.id))
    ) {
      productionByGroup.set(project.groupId, project);
    }
  }

  const results: PullRequestPreviewResult[] = [];
  for (const base of productionByGroup.values()) {
    try {
      const ctx = await webhookContext(base);
      const slug = previewSlug(event.pullRequestNumber);
      let environment = (await repos.project.listByGroup(base.groupId)).find(
        (project) => project.environmentSlug === slug && project.environmentType === "preview",
      );

      if (event.action === "close") {
        if (!environment) {
          results.push({
            projectId: base.id,
            action: "skipped",
            message: `Preview ${slug} does not exist.`,
          });
          continue;
        }
        const teardown = await teardownProject(ctx, environment.id, {
          force: true,
          forceOrphan: false,
          preserveWebhook: true,
          wipeVolumes: true,
        });
        results.push({
          projectId: base.id,
          environmentId: environment.id,
          action: teardown.rowDeleted ? "removed" : "failed",
          message: teardown.rowDeleted
            ? `Preview ${slug} removed.`
            : teardown.unrecoverable
                .map((step) => step.error)
                .filter(Boolean)
                .join("; "),
        });
        continue;
      }

      if (!environment) {
        let createdNew = false;
        try {
          const created = await createProjectEnvironment(base.id, ctx, {
            environmentName: `PR #${event.pullRequestNumber}`,
            environmentSlug: slug,
            environmentType: "preview",
            gitBranch: event.branch,
            sourceMode: "manual",
          });
          environment = await repos.project.findById(created.id);
          createdNew = true;
        } catch (createError) {
          // A created + updated delivery can race on the same PR. The unique
          // group/slug index elects one creator; the loser reuses its row.
          environment = (await repos.project.listByGroup(base.groupId)).find(
            (project) => project.environmentSlug === slug && project.environmentType === "preview",
          );
          if (!environment) throw createError;
        }
        if (environment && createdNew) {
          try {
            await clonePreviewConfiguration(base, environment);
          } catch (cloneError) {
            // Never leave a half-cloned preview that later deliveries would
            // mistake for operational.
            await teardownProject(ctx, environment.id, {
              force: true,
              forceOrphan: false,
              preserveWebhook: true,
              wipeVolumes: true,
            }).catch(() => undefined);
            throw cloneError;
          }
        }
      } else if (environment.gitBranch !== event.branch) {
        await repos.project.update(environment.id, { gitBranch: event.branch });
        environment = await repos.project.findById(environment.id);
      }

      if (!environment) {
        throw new Error(`Could not create preview environment ${slug}`);
      }

      const triggered = await triggerDeployment(ctx, {
        projectId: environment.id,
        branch: event.branch,
        commitSha: event.commitSha,
        commitMessage: event.title,
        environment: "preview",
        trigger: "webhook",
      });
      const url = await previewUrl(environment.id);
      if (triggered.deployment) {
        if (triggered.skipped && triggered.deployment.status === "ready") {
          await completePullRequestPreviewStatus(environment, triggered.deployment, "success", {
            previewUrl: url,
          });
        } else {
          await beginPullRequestPreviewStatus(environment, triggered.deployment, url);
        }
      }
      results.push({
        projectId: base.id,
        environmentId: environment.id,
        deploymentId: triggered.deployment?.id,
        previewUrl: url,
        action: "deployed",
      });
    } catch (error) {
      results.push({
        projectId: base.id,
        action: "failed",
        message: safeErrorMessage(error),
      });
    }
  }
  return results;
}
