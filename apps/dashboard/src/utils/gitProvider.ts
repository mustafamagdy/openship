export type RemoteGitProvider = "github" | "azure-devops";

export function repositoryWebUrl(
  provider: string | null | undefined,
  owner: string,
  repo: string,
): string {
  if (provider === "azure-devops") {
    const slash = owner.indexOf("/");
    const organization = slash >= 0 ? owner.slice(0, slash) : owner;
    const project = slash >= 0 ? owner.slice(slash + 1) : "";
    return (
      `https://dev.azure.com/${encodeURIComponent(organization)}/` +
      `${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`
    );
  }
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function commitWebUrl(
  provider: string | null | undefined,
  owner: string,
  repo: string,
  sha: string,
): string {
  const repository = repositoryWebUrl(provider, owner, repo);
  return `${repository}/commit/${encodeURIComponent(sha)}`;
}

export function gitProviderLabel(provider: string | null | undefined): string {
  return provider === "azure-devops" ? "Azure Repos" : "GitHub";
}
