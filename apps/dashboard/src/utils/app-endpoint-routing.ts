import type { AppEndpoint } from "@repo/core";
import type { PublicEndpoint } from "@/context/deployment/types";

export type AppEndpointExposure =
  | { kind: "http"; mode: "port" | "domain"; ep: PublicEndpoint }
  | { kind: "tcp"; mode: "publish" | "internal" };

type ServiceRoutingSource = {
  id: string;
  name: string;
  publicEndpoints?: Array<{
    port?: number | string;
    domain?: string;
    customDomain?: string;
    domainType?: "free" | "custom";
  }> | null;
};

export type HttpServiceRouteUpdate = {
  serviceId: string;
  exposed: boolean;
  /** Empty strings deliberately clear the legacy scalar route fields. They are
   * normalized to null by the service API, while `publicEndpoints: []` clears
   * the structured multi-route list. */
  exposedPort?: string;
  domain?: string;
  customDomain?: string;
  publicEndpoints: Array<{
    port: number;
    domainType: "free" | "custom";
    domain?: string;
    customDomain?: string;
  }>;
};

const endpointKey = (endpoint: AppEndpoint) => `${endpoint.service}:${endpoint.port}`;

/**
 * Build one routing update per service. The service API owns the complete route
 * list, so sending one update for every endpoint loses all but the final route.
 */
export function buildHttpServiceRouteUpdates(
  endpoints: readonly AppEndpoint[],
  exposure: Record<string, AppEndpointExposure>,
  services: readonly ServiceRoutingSource[],
  isKubernetes: boolean,
): HttpServiceRouteUpdate[] {
  const byService = new Map(services.map((service) => [service.name, service]));
  const endpointGroups = new Map<string, AppEndpoint[]>();
  for (const endpoint of endpoints) {
    if (endpoint.kind !== "http") continue;
    const group = endpointGroups.get(endpoint.service) ?? [];
    group.push(endpoint);
    endpointGroups.set(endpoint.service, group);
  }

  const updates: HttpServiceRouteUpdate[] = [];
  for (const [serviceName, serviceEndpoints] of endpointGroups) {
    const service = byService.get(serviceName);
    if (!service) continue;
    const publicEndpoints: HttpServiceRouteUpdate["publicEndpoints"] = [];
    for (const endpoint of serviceEndpoints) {
      const state = exposure[endpointKey(endpoint)];
      if (state?.kind !== "http" || state.mode !== "domain") continue;
      const existing = service.publicEndpoints?.find((item) => Number(item.port) === endpoint.port);
      if (state.ep.domainType === "custom") {
        const customDomain = state.ep.customDomain.trim().toLowerCase() || existing?.customDomain;
        if (customDomain) publicEndpoints.push({ port: endpoint.port, domainType: "custom", customDomain });
      } else {
        const domain = state.ep.domain.trim().toLowerCase() || existing?.domain;
        if (domain) publicEndpoints.push({ port: endpoint.port, domainType: "free", domain });
      }
    }
    updates.push({
      serviceId: service.id,
      exposed: publicEndpoints.length > 0 || isKubernetes,
      // Templates seed the old scalar route fields as well as the endpoint
      // list. An explicit port-only choice must clear both representations;
      // otherwise the API correctly detects the stale free domain and blocks a
      // disconnected self-hosted deployment.
      ...(publicEndpoints.length === 0
        ? { exposedPort: "", domain: "", customDomain: "" }
        : {}),
      publicEndpoints,
    });
  }
  return updates;
}
