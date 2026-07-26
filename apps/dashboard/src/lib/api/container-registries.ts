import { api } from "./client";
import { endpoints } from "./endpoints";

export interface ContainerRegistryConnection {
  id: string;
  name: string;
  provider: "ghcr" | "generic";
  registryHost: string;
  namespace: string;
  username: string;
  isDefault: boolean;
  tokenSetAt: string;
  lastValidatedAt: string;
}

export interface ConnectContainerRegistryInput {
  name?: string;
  provider?: "ghcr" | "generic";
  registryHost: string;
  namespace: string;
  username: string;
  token: string;
}

export const containerRegistriesApi = {
  list: () =>
    api.get<{ connections: ContainerRegistryConnection[] }>(
      endpoints.containerRegistries.list,
    ),
  connect: (input: ConnectContainerRegistryInput) =>
    api.post<{ connection: ContainerRegistryConnection }>(
      endpoints.containerRegistries.list,
      input,
    ),
  disconnect: (id: string) =>
    api.delete<{ success: boolean }>(endpoints.containerRegistries.item(id)),
};
