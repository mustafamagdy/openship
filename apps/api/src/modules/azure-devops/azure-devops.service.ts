import { generateId } from "@repo/core";
import { repos, type AzureDevopsConnection } from "@repo/db";
import { decrypt, encrypt } from "../../lib/encryption";
import { azureDevopsWebhookUrl } from "../../lib/public-url";
import type { RequestContext } from "../../lib/request-context";
import type {
  AzureDevopsCommit,
  AzureDevopsItem,
  AzureDevopsProject,
  AzureDevopsRef,
  AzureDevopsRepository,
} from "./azure-devops.types";

const API_VERSION = "7.1";
const REQUEST_TIMEOUT_MS = 20_000;
const ORGANIZATION_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export interface AzureRepoCoordinates {
  organization: string;
  project: string;
  repo: string;
}

export interface PublicAzureDevopsConnection {
  organization: string;
  organizationUrl: string;
  patSetAt: string;
  connected: true;
}

function publicConnection(row: AzureDevopsConnection): PublicAzureDevopsConnection {
  return {
    organization: row.azureOrganization,
    organizationUrl: row.organizationUrl,
    patSetAt: row.patSetAt.toISOString(),
    connected: true,
  };
}

export function normalizeAzureOrganization(input: string): string {
  const value = input.trim().replace(/^https?:\/\/dev\.azure\.com\//i, "").replace(/\/+$/, "");
  if (!ORGANIZATION_RE.test(value)) {
    throw new Error(
      "Azure DevOps organization must be its organization name (for example, geeksclub).",
    );
  }
  return value.toLowerCase();
}

export function azureOrganizationUrl(organization: string): string {
  return `https://dev.azure.com/${normalizeAzureOrganization(organization)}`;
}

export function azureRepoOwner(organization: string, project: string): string {
  const org = normalizeAzureOrganization(organization);
  const projectName = project.trim();
  if (!projectName) throw new Error("Azure DevOps project is required");
  return `${org}/${projectName}`;
}

export function parseAzureRepoOwner(owner: string, repo: string): AzureRepoCoordinates {
  const slash = owner.indexOf("/");
  if (slash <= 0 || slash === owner.length - 1) {
    throw new Error(
      'Azure Repos owner must be "<azure-organization>/<azure-project>".',
    );
  }
  const organization = normalizeAzureOrganization(owner.slice(0, slash));
  const project = owner.slice(slash + 1).trim();
  const repoName = repo.trim();
  if (!project || !repoName) throw new Error("Azure DevOps project and repository are required");
  return { organization, project, repo: repoName };
}

export function azureCloneUrl(coords: AzureRepoCoordinates): string {
  return (
    `https://dev.azure.com/${encodeURIComponent(coords.organization)}/` +
    `${encodeURIComponent(coords.project)}/_git/${encodeURIComponent(coords.repo)}`
  );
}

export function azureRepositoryWebUrl(coords: AzureRepoCoordinates): string {
  return azureCloneUrl(coords);
}

async function requireConnection(
  ctx: Pick<RequestContext, "organizationId">,
  azureOrganization: string,
): Promise<AzureDevopsConnection> {
  if (!ctx.organizationId) throw new Error("Organization context is required");
  const normalized = normalizeAzureOrganization(azureOrganization);
  const connection = await repos.azureDevopsConnection.findByAzureOrganization(
    ctx.organizationId,
    normalized,
  );
  if (!connection) {
    throw new Error(
      `Azure DevOps organization "${normalized}" is not connected. Connect it in Settings first.`,
    );
  }
  return connection;
}

function basicAuthHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`, "utf8").toString("base64")}`;
}

async function azureFetch<T>(
  connection: AzureDevopsConnection,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
  const pat = decrypt(connection.patEncrypted);
  const url = new URL(path, `${connection.organizationUrl}/`);
  if (!url.searchParams.has("api-version")) {
    url.searchParams.set("api-version", API_VERSION);
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", basicAuthHeader(pat));
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = text.slice(0, 500).replace(/\s+/g, " ").trim();
    throw new Error(
      `Azure DevOps returned ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  const data = (text ? JSON.parse(text) : {}) as T;
  return { data, response };
}

async function listAll<T>(
  connection: AzureDevopsConnection,
  path: string,
): Promise<T[]> {
  const rows: T[] = [];
  let continuationToken: string | undefined;

  do {
    const url = new URL(path, `${connection.organizationUrl}/`);
    url.searchParams.set("$top", "100");
    if (continuationToken) url.searchParams.set("continuationToken", continuationToken);
    const { data, response } = await azureFetch<{ value?: T[] }>(connection, url.toString());
    rows.push(...(Array.isArray(data.value) ? data.value : []));
    continuationToken =
      response.headers.get("x-ms-continuationtoken") ??
      response.headers.get("x-ms-continuation-token") ??
      undefined;
  } while (continuationToken);

  return rows;
}

export async function listConnections(
  ctx: Pick<RequestContext, "organizationId">,
): Promise<PublicAzureDevopsConnection[]> {
  if (!ctx.organizationId) return [];
  const rows = await repos.azureDevopsConnection.listByOrganization(ctx.organizationId);
  return rows.map(publicConnection);
}

export async function connect(
  ctx: RequestContext,
  input: { organization: string; pat: string },
): Promise<PublicAzureDevopsConnection> {
  if (!ctx.organizationId) throw new Error("Organization context is required");
  const organization = normalizeAzureOrganization(input.organization);
  const pat = input.pat.trim();
  if (pat.length < 20 || pat.length > 1024) {
    throw new Error("Azure DevOps PAT is invalid");
  }

  const candidate: AzureDevopsConnection = {
    id: generateId("azdo"),
    organizationId: ctx.organizationId,
    connectedByUserId: ctx.userId,
    azureOrganization: organization,
    organizationUrl: azureOrganizationUrl(organization),
    patEncrypted: encrypt(pat),
    patSetAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Validate before persisting. The PAT must be able to enumerate projects;
  // private-repo cloning is exercised later by the selected repository.
  await azureFetch<{ count?: number; value?: AzureDevopsProject[] }>(
    candidate,
    `_apis/projects?$top=1`,
  );

  const saved = await repos.azureDevopsConnection.upsert(candidate);
  return publicConnection(saved);
}

export async function disconnect(
  ctx: Pick<RequestContext, "organizationId">,
  azureOrganization: string,
): Promise<void> {
  if (!ctx.organizationId) throw new Error("Organization context is required");
  await repos.azureDevopsConnection.delete(
    ctx.organizationId,
    normalizeAzureOrganization(azureOrganization),
  );
}

export async function listProjects(
  ctx: Pick<RequestContext, "organizationId">,
  azureOrganization: string,
): Promise<AzureDevopsProject[]> {
  const connection = await requireConnection(ctx, azureOrganization);
  return listAll<AzureDevopsProject>(connection, "_apis/projects");
}

export async function listRepositories(
  ctx: Pick<RequestContext, "organizationId">,
  azureOrganization: string,
  project: string,
): Promise<AzureDevopsRepository[]> {
  const connection = await requireConnection(ctx, azureOrganization);
  return listAll<AzureDevopsRepository>(
    connection,
    `${encodeURIComponent(project)}/_apis/git/repositories`,
  );
}

export async function getRepository(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
  opts: { withBranches?: boolean } = {},
) {
  const connection = await requireConnection(ctx, coords.organization);
  const path =
    `${encodeURIComponent(coords.project)}/_apis/git/repositories/` +
    encodeURIComponent(coords.repo);
  const { data } = await azureFetch<AzureDevopsRepository>(connection, path);
  const branches = opts.withBranches ? await listBranches(ctx, coords) : undefined;
  const defaultBranch = data.defaultBranch?.replace(/^refs\/heads\//, "") || "main";
  return {
    id: data.id,
    name: data.name,
    full_name: `${coords.organization}/${data.project.name}/${data.name}`,
    owner: azureRepoOwner(coords.organization, data.project.name),
    project_id: data.project.id,
    private: true,
    default_branch: defaultBranch,
    clone_url: data.remoteUrl || azureCloneUrl(coords),
    html_url: data.webUrl || azureRepositoryWebUrl(coords),
    branches,
  };
}

export async function listBranches(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
) {
  const connection = await requireConnection(ctx, coords.organization);
  const path =
    `${encodeURIComponent(coords.project)}/_apis/git/repositories/` +
    `${encodeURIComponent(coords.repo)}/refs?filter=heads/`;
  const refs = await listAll<AzureDevopsRef>(connection, path);
  return refs.map((ref) => ({
    name: ref.name.replace(/^refs\/heads\//, ""),
    commit: { sha: ref.objectId },
    protected: false,
  }));
}

export async function getLatestCommit(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
  branch: string,
) {
  const connection = await requireConnection(ctx, coords.organization);
  const url = new URL(
    `${encodeURIComponent(coords.project)}/_apis/git/repositories/` +
      `${encodeURIComponent(coords.repo)}/commits`,
    `${connection.organizationUrl}/`,
  );
  url.searchParams.set("searchCriteria.itemVersion.version", branch);
  url.searchParams.set("searchCriteria.itemVersion.versionType", "branch");
  url.searchParams.set("$top", "1");
  const { data } = await azureFetch<{ value?: AzureDevopsCommit[] }>(
    connection,
    url.toString(),
  );
  const commit = data.value?.[0];
  if (!commit) return null;
  return {
    sha: commit.commitId,
    message: commit.comment ?? "",
    author: commit.author?.name ?? "",
    authorAvatar: null,
    date: commit.author?.date ?? null,
    url:
      commit.remoteUrl ??
      `${azureRepositoryWebUrl(coords)}/commit/${encodeURIComponent(commit.commitId)}`,
  };
}

export async function getRecentCommits(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
  branch: string,
  limit = 10,
) {
  const connection = await requireConnection(ctx, coords.organization);
  const url = new URL(
    `${encodeURIComponent(coords.project)}/_apis/git/repositories/` +
      `${encodeURIComponent(coords.repo)}/commits`,
    `${connection.organizationUrl}/`,
  );
  url.searchParams.set("searchCriteria.itemVersion.version", branch);
  url.searchParams.set("searchCriteria.itemVersion.versionType", "branch");
  url.searchParams.set("$top", String(Math.min(Math.max(limit, 1), 100)));
  const { data } = await azureFetch<{ value?: AzureDevopsCommit[] }>(
    connection,
    url.toString(),
  );
  return (data.value ?? []).map((commit) => ({
    sha: commit.commitId,
    message: commit.comment ?? "",
    author: commit.author?.name ?? "",
    authorAvatar: null,
    date: commit.author?.date ?? null,
    url:
      commit.remoteUrl ??
      `${azureRepositoryWebUrl(coords)}/commit/${encodeURIComponent(commit.commitId)}`,
  }));
}

export async function listItems(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
  branch: string,
): Promise<AzureDevopsItem[]> {
  const connection = await requireConnection(ctx, coords.organization);
  const url = new URL(
    `${encodeURIComponent(coords.project)}/_apis/git/repositories/` +
      `${encodeURIComponent(coords.repo)}/items`,
    `${connection.organizationUrl}/`,
  );
  url.searchParams.set("scopePath", "/");
  url.searchParams.set("recursionLevel", "Full");
  url.searchParams.set("includeContentMetadata", "true");
  url.searchParams.set("versionDescriptor.version", branch);
  url.searchParams.set("versionDescriptor.versionType", "branch");
  const { data } = await azureFetch<{ value?: AzureDevopsItem[] }>(
    connection,
    url.toString(),
  );
  return data.value ?? [];
}

export async function getFileContent(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
  path: string,
  branch: string,
): Promise<string | undefined> {
  const connection = await requireConnection(ctx, coords.organization);
  const url = new URL(
    `${encodeURIComponent(coords.project)}/_apis/git/repositories/` +
      `${encodeURIComponent(coords.repo)}/items`,
    `${connection.organizationUrl}/`,
  );
  url.searchParams.set("path", path.startsWith("/") ? path : `/${path}`);
  url.searchParams.set("includeContent", "true");
  url.searchParams.set("versionDescriptor.version", branch);
  url.searchParams.set("versionDescriptor.versionType", "branch");
  try {
    const { data } = await azureFetch<AzureDevopsItem>(connection, url.toString());
    return typeof data.content === "string" ? data.content : undefined;
  } catch {
    return undefined;
  }
}

/** PAT for a remote clone. The caller must never log or persist the plaintext. */
export async function resolveCloneCredential(
  ctx: Pick<RequestContext, "organizationId">,
  owner: string,
): Promise<{ token: string; username: string }> {
  const { organization } = parseAzureRepoOwner(owner, "_");
  const connection = await requireConnection(ctx, organization);
  return { token: decrypt(connection.patEncrypted), username: "openship" };
}

export async function createPushSubscription(
  ctx: Pick<RequestContext, "organizationId">,
  coords: AzureRepoCoordinates,
  secret: string,
): Promise<{ id: string; status?: string }> {
  const connection = await requireConnection(ctx, coords.organization);
  const callbackUrl = azureDevopsWebhookUrl();
  const parsedCallback = new URL(callbackUrl);
  if (
    parsedCallback.protocol !== "https:" ||
    parsedCallback.hostname === "localhost" ||
    parsedCallback.hostname === "127.0.0.1"
  ) {
    throw new Error(
      "Azure Repos auto-deploy requires a public HTTPS OpenShip URL.",
    );
  }

  const repository = await getRepository(ctx, coords);
  const { data } = await azureFetch<{ id?: string; status?: string }>(
    connection,
    "_apis/hooks/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        publisherId: "tfs",
        eventType: "git.push",
        resourceVersion: "1.0",
        consumerId: "webHooks",
        consumerActionId: "httpRequest",
        publisherInputs: {
          projectId: repository.project_id,
          repository: repository.id,
        },
        consumerInputs: {
          url: callbackUrl,
          resourceDetailsToSend: "all",
          messagesToSend: "none",
          detailedMessagesToSend: "none",
          basicAuthUsername: "openship",
          basicAuthPassword: secret,
        },
      }),
    },
  );
  if (!data.id) {
    throw new Error("Azure DevOps did not return a service-hook subscription ID");
  }
  return { id: data.id, status: data.status };
}

export async function deletePushSubscription(
  ctx: Pick<RequestContext, "organizationId">,
  azureOrganization: string,
  subscriptionId: string,
): Promise<void> {
  const connection = await requireConnection(ctx, azureOrganization);
  await azureFetch(
    connection,
    `_apis/hooks/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE" },
  );
}
