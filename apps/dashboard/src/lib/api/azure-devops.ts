import { api } from "./client";
import { endpoints } from "./endpoints";

export interface AzureDevopsConnection {
  organization: string;
  organizationUrl: string;
  patSetAt: string;
  connected: true;
}

export interface AzureDevopsProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  url: string;
}

export interface AzureDevopsRepository {
  id: string;
  name: string;
  remoteUrl: string;
  webUrl: string;
  defaultBranch?: string;
  size?: number;
  project: { id: string; name: string };
}

export const azureDevopsApi = {
  listConnections: () =>
    api.get<{ connections: AzureDevopsConnection[] }>(
      endpoints.azureDevops.connections,
    ),
  connect: (organization: string, pat: string) =>
    api.post<{ connection: AzureDevopsConnection }>(
      endpoints.azureDevops.connections,
      { organization, pat },
    ),
  disconnect: (organization: string) =>
    api.delete<{ success: boolean }>(
      endpoints.azureDevops.connection(organization),
    ),
  listProjects: (organization: string) =>
    api.get<{ projects: AzureDevopsProject[] }>(
      endpoints.azureDevops.projects(organization),
    ),
  listRepositories: (organization: string, project: string) =>
    api.get<{ repositories: AzureDevopsRepository[] }>(
      endpoints.azureDevops.repos(organization, project),
    ),
  listBranches: (organization: string, project: string, repo: string) =>
    api.get<{ branches: Array<{ name: string; commit: { sha: string } }> }>(
      endpoints.azureDevops.branches(organization, project, repo),
    ),
};
