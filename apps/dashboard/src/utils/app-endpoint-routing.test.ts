import { describe, expect, it } from "vitest";
import { buildHttpServiceRouteUpdates, type AppEndpointExposure } from "./app-endpoint-routing";

const endpoints = [
  { service: "minio", port: 9001, label: "Console", kind: "http" as const },
  { service: "minio", port: 9000, label: "S3 API", kind: "http" as const },
];

const domainExposure: Record<string, Extract<AppEndpointExposure, { kind: "http" }>> = {
  "minio:9001": { kind: "http", mode: "domain", ep: { id: "1", port: "", targetPath: "", domain: "", customDomain: "", domainType: "free" } },
  "minio:9000": { kind: "http", mode: "domain", ep: { id: "2", port: "", targetPath: "", domain: "", customDomain: "", domainType: "free" } },
};

const service = [{ id: "svc-minio", name: "minio", publicEndpoints: [
  { port: 9001, domainType: "free" as const, domain: "minio" },
  { port: 9000, domainType: "free" as const, domain: "minio-s3" },
] }];

describe("buildHttpServiceRouteUpdates", () => {
  it("preserves every default route for a multi-port service", () => {
    expect(buildHttpServiceRouteUpdates(endpoints, domainExposure, service, true)).toEqual([
      { serviceId: "svc-minio", exposed: true, publicEndpoints: [
        { port: 9001, domainType: "free", domain: "minio" },
        { port: 9000, domainType: "free", domain: "minio-s3" },
      ] },
    ]);
  });

  it("keeps a port-only Kubernetes service as a NodePort without routes", () => {
    const portOnly: Record<string, AppEndpointExposure> = {
      "minio:9001": { kind: "http", mode: "port", ep: domainExposure["minio:9001"]!.ep },
      "minio:9000": { kind: "http", mode: "port", ep: domainExposure["minio:9000"]!.ep },
    };
    expect(buildHttpServiceRouteUpdates(endpoints, portOnly, service, true)).toEqual([
      {
        serviceId: "svc-minio",
        exposed: true,
        exposedPort: "",
        domain: "",
        customDomain: "",
        publicEndpoints: [],
      },
    ]);
  });
});
