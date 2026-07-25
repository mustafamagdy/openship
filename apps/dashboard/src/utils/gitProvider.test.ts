import { describe, expect, it } from "vitest";
import {
  commitWebUrl,
  gitProviderLabel,
  repositoryWebUrl,
} from "./gitProvider";

describe("git provider URLs", () => {
  it("builds Azure Repos links with encoded project and repo names", () => {
    expect(
      repositoryWebUrl(
        "azure-devops",
        "geeksclub/Relay Platform",
        "web app",
      ),
    ).toBe(
      "https://dev.azure.com/geeksclub/Relay%20Platform/_git/web%20app",
    );
    expect(
      commitWebUrl(
        "azure-devops",
        "geeksclub/Relay Platform",
        "web app",
        "abc123",
      ),
    ).toBe(
      "https://dev.azure.com/geeksclub/Relay%20Platform/_git/web%20app/commit/abc123",
    );
    expect(gitProviderLabel("azure-devops")).toBe("Azure Repos");
  });
});
