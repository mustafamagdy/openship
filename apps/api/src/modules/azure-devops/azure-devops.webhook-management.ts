import { randomBytes } from "node:crypto";
import { repos, type Project } from "@repo/db";
import { decrypt, encrypt } from "../../lib/encryption";
import type { RequestContext } from "../../lib/request-context";
import {
  createPushSubscription,
  deletePushSubscription,
  parseAzureRepoOwner,
} from "./azure-devops.service";

async function siblingProjects(project: Project): Promise<Project[]> {
  if (!project.gitOwner || !project.gitRepo) return [];
  const rows = await repos.project.findByGitRepo(project.gitOwner, project.gitRepo);
  return rows.filter(
    (row) =>
      row.organizationId === project.organizationId &&
      row.gitProvider === "azure-devops",
  );
}

/**
 * Azure DevOps service hooks are repository-scoped, so all OpenShip
 * environments for the same repository share one subscription and one Basic
 * auth secret. Branch matching remains per project in the receiver.
 */
export async function ensureAzureDevopsPushWebhook(
  ctx: RequestContext,
  project: Project,
): Promise<string> {
  if (!project.gitOwner || !project.gitRepo) {
    throw new Error("No Azure Repos repository is linked");
  }

  const siblings = await siblingProjects(project);
  const reusable = siblings.find((row) => {
    if (!row.webhookExternalId || !row.webhookSecret) return false;
    try {
      return decrypt(row.webhookSecret).length > 0;
    } catch {
      return false;
    }
  });

  if (reusable?.webhookExternalId && reusable.webhookSecret) {
    await Promise.all(
      siblings
        .filter(
          (row) =>
            row.webhookExternalId !== reusable.webhookExternalId ||
            row.webhookSecret !== reusable.webhookSecret,
        )
        .map((row) =>
          repos.project.update(row.id, {
            webhookExternalId: reusable.webhookExternalId,
            webhookSecret: reusable.webhookSecret,
          }),
        ),
    );
    return reusable.webhookExternalId;
  }

  const coords = parseAzureRepoOwner(project.gitOwner, project.gitRepo);
  const secret = randomBytes(32).toString("hex");
  const subscription = await createPushSubscription(ctx, coords, secret);
  const encryptedSecret = encrypt(secret);
  const targets = siblings.length > 0 ? siblings : [project];

  await Promise.all(
    targets.map((row) =>
      repos.project.update(row.id, {
        webhookExternalId: subscription.id,
        webhookSecret: encryptedSecret,
      }),
    ),
  );
  return subscription.id;
}

/** Delete the shared subscription only after the final environment opts out. */
export async function deleteAzureDevopsPushWebhookIfUnused(
  ctx: RequestContext,
  project: Project,
): Promise<void> {
  if (!project.gitOwner || !project.gitRepo) return;
  const siblings = await siblingProjects(project);
  if (siblings.some((row) => row.autoDeploy)) return;

  const subscriptionId =
    project.webhookExternalId ??
    siblings.find((row) => row.webhookExternalId)?.webhookExternalId ??
    null;
  const { organization } = parseAzureRepoOwner(project.gitOwner, project.gitRepo);
  if (subscriptionId) {
    await deletePushSubscription(ctx, organization, subscriptionId);
  }

  await Promise.all(
    siblings.map((row) =>
      repos.project.update(row.id, {
        webhookExternalId: null,
        webhookSecret: null,
      }),
    ),
  );
}
