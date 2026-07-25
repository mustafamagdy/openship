"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  GitBranch,
  Loader2,
  Lock,
  Search,
  Settings,
} from "lucide-react";
import {
  azureDevopsApi,
  getApiErrorMessage,
  type AzureDevopsConnection,
  type AzureDevopsProject,
  type AzureDevopsRepository,
} from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { encodeRepoSlug } from "@/utils/repoSlug";

export function AzureReposList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [connections, setConnections] = useState<AzureDevopsConnection[]>([]);
  const [projects, setProjects] = useState<AzureDevopsProject[]>([]);
  const [repositories, setRepositories] = useState<AzureDevopsRepository[]>([]);
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const result = await azureDevopsApi.listConnections();
        const rows = result.connections ?? [];
        setConnections(rows);
        setOrganization((current) => current || rows[0]?.organization || "");
      } catch (error) {
        showToast(
          getApiErrorMessage(error, "Could not load Azure DevOps connections"),
          "error",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  useEffect(() => {
    if (!organization) {
      setProjects([]);
      setProject("");
      return;
    }
    void (async () => {
      try {
        const result = await azureDevopsApi.listProjects(organization);
        const rows = (result.projects ?? []).filter((row) => row.state === "wellFormed");
        setProjects(rows);
        setProject((current) =>
          rows.some((row) => row.name === current) ? current : rows[0]?.name || "",
        );
      } catch (error) {
        showToast(
          getApiErrorMessage(error, "Could not load Azure DevOps projects"),
          "error",
        );
      }
    })();
  }, [organization, showToast]);

  const loadRepositories = useCallback(async () => {
    if (!organization || !project) {
      setRepositories([]);
      return;
    }
    setLoadingRepos(true);
    try {
      const result = await azureDevopsApi.listRepositories(organization, project);
      setRepositories(result.repositories ?? []);
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Could not load Azure Repos repositories"),
        "error",
      );
      setRepositories([]);
    } finally {
      setLoadingRepos(false);
    }
  }, [organization, project, showToast]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...repositories]
      .filter((repo) => !query || repo.name.toLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [repositories, search]);

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-border/50 bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card px-6 py-12 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-info/10">
          <GitBranch className="size-6 text-info" />
        </div>
        <h3 className="text-lg font-medium text-foreground">Connect Azure DevOps</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Add your Azure DevOps organization and a scoped PAT before browsing private Azure Repos.
        </p>
        <button
          type="button"
          onClick={() => router.push("/settings?tab=general")}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          <Settings className="size-4" />
          Open settings
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div className="space-y-3 border-b border-border/50 px-5 py-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            {connections.map((connection) => (
              <option key={connection.organization} value={connection.organization}>
                {connection.organization}
              </option>
            ))}
          </select>
          <select
            value={project}
            onChange={(event) => setProject(event.target.value)}
            className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            {projects.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="relative">
          <Search className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Azure Repos"
            className="w-full rounded-xl border border-border/50 bg-muted/30 py-2.5 ps-10 pe-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {loadingRepos ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          No repositories found in this project.
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {filtered.map((repo) => (
            <button
              key={repo.id}
              type="button"
              onClick={() => {
                const owner = `${organization}/${project}`;
                const slug = encodeRepoSlug(owner, repo.name);
                router.push(`/deploy/${slug}?provider=azure-devops`);
              }}
              className="group flex w-full items-center gap-4 px-5 py-3.5 text-start transition-colors hover:bg-muted/40"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                <Lock className="size-[18px] text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{repo.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {organization} / {project}
                  {repo.defaultBranch
                    ? ` · ${repo.defaultBranch.replace(/^refs\/heads\//, "")}`
                    : ""}
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground rtl:rotate-180" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
