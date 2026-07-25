import { describe, expect, it } from "vitest";
import {
  azureCloneUrl,
  azureRepoOwner,
  normalizeAzureOrganization,
  parseAzureRepoOwner,
} from "../../../src/modules/azure-devops/azure-devops.service";

describe("Azure Repos coordinates", () => {
  it("normalizes organization names and canonical URLs", () => {
    expect(normalizeAzureOrganization("  GeeksClub ")).toBe("geeksclub");
    expect(
      normalizeAzureOrganization("https://dev.azure.com/GeeksClub/"),
    ).toBe("geeksclub");
  });

  it("rejects arbitrary hosts and nested organization paths", () => {
    expect(() =>
      normalizeAzureOrganization("https://example.com/geeksclub"),
    ).toThrow("organization name");
    expect(() => normalizeAzureOrganization("geeksclub/relay")).toThrow(
      "organization name",
    );
  });

  it("round-trips organization/project ownership", () => {
    const owner = azureRepoOwner("GeeksClub", "Relay Platform");
    expect(owner).toBe("geeksclub/Relay Platform");
    expect(parseAzureRepoOwner(owner, "api")).toEqual({
      organization: "geeksclub",
      project: "Relay Platform",
      repo: "api",
    });
  });

  it("builds an encoded Azure Repos HTTPS clone URL", () => {
    expect(
      azureCloneUrl({
        organization: "geeksclub",
        project: "Relay Platform",
        repo: "web app",
      }),
    ).toBe(
      "https://dev.azure.com/geeksclub/Relay%20Platform/_git/web%20app",
    );
  });
});
