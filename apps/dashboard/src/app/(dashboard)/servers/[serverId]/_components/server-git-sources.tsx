"use client";

import { useState } from "react";
import { Github, GitBranch } from "lucide-react";
import { ServerGitHubConnect } from "@/components/github/ServerGitHubConnect";
import { AzureDevopsConnection } from "../../../settings/_components/AzureDevopsConnection";

type GitProvider = "github" | "azure-devops";

const PROVIDERS: Array<{
  id: GitProvider;
  label: string;
  description: string;
  icon: typeof Github;
}> = [
  {
    id: "github",
    label: "GitHub",
    description: "GitHub App, token, SSH key, or deploy keys",
    icon: Github,
  },
  {
    id: "azure-devops",
    label: "Azure DevOps",
    description: "Azure Repos organization and PAT",
    icon: GitBranch,
  },
];

export function ServerGitSources({ serverId }: { serverId: string }) {
  const [provider, setProvider] = useState<GitProvider>("github");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Git sources</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect one or more providers. Each project uses the credentials for its selected source.
        </p>
      </div>

      <div
        className="grid gap-2 rounded-2xl border border-border/50 bg-muted/20 p-2 sm:grid-cols-2"
        role="tablist"
        aria-label="Git source provider"
      >
        {PROVIDERS.map(({ id, label, description, icon: Icon }) => {
          const selected = provider === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`git-source-${id}`}
              onClick={() => setProvider(id)}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-start transition-colors ${
                selected
                  ? "border-primary/30 bg-card text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground"
              }`}
            >
              <Icon className="size-5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div id={`git-source-${provider}`} role="tabpanel">
        {provider === "github" ? (
          <ServerGitHubConnect serverId={serverId} variant="card" />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Azure DevOps connections are shared by every server in this OpenShip organization.
            </p>
            <AzureDevopsConnection />
          </div>
        )}
      </div>
    </div>
  );
}
