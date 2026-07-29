import { safeErrorMessage } from "@repo/core";
import { handlePullRequestPreview } from "../projects/pull-request-preview.service";
import type { WebhookHandlerResult } from "../webhooks/webhook.types";
import type { GitHubPullRequestPayload } from "./github.types";

const UPSERT_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

export async function handlePullRequest(
  payload: GitHubPullRequestPayload,
): Promise<WebhookHandlerResult> {
  const event = "pull_request";
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const number = payload.pull_request?.number ?? payload.number;
  const action = payload.action;

  if (!owner || !repo || !Number.isSafeInteger(number) || number < 1) {
    return { success: false, event, error: "Missing pull request repository or number" };
  }
  if (action !== "closed" && !UPSERT_ACTIONS.has(action)) {
    return { success: true, event, message: `Pull request action '${action}' ignored` };
  }

  const headRepo = payload.pull_request?.head?.repo?.full_name;
  if (
    action !== "closed" &&
    headRepo &&
    headRepo.toLowerCase() !== payload.repository.full_name.toLowerCase()
  ) {
    return {
      success: true,
      event,
      message: "Fork pull request previews are not deployed automatically",
    };
  }

  try {
    const results = await handlePullRequestPreview({
      provider: "github",
      action: action === "closed" ? "close" : "upsert",
      owner,
      repo,
      pullRequestNumber: number,
      branch: payload.pull_request?.head?.ref ?? "",
      commitSha: payload.pull_request?.head?.sha,
      title: payload.pull_request?.title,
    });
    const failed = results.filter((result) => result.action === "failed");
    return {
      success: failed.length === 0,
      event,
      message:
        results.length === 0
          ? "No auto-deploy production project is linked to this repository"
          : `${results.length - failed.length} preview operation(s) completed, ${failed.length} failed`,
      ...(failed.length > 0
        ? {
            error: failed
              .map((result) => result.message)
              .filter(Boolean)
              .join("; "),
          }
        : {}),
    };
  } catch (error) {
    return { success: false, event, error: safeErrorMessage(error) };
  }
}
