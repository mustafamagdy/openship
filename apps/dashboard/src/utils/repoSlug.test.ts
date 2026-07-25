import { describe, expect, it } from "vitest";
import { decodeSlug, encodeRepoSlug } from "./repoSlug";

describe("Azure Repos repository slugs", () => {
  it("preserves an organization/project owner namespace", () => {
    const slug = encodeRepoSlug("geeksclub/relay", "web-app");
    expect(decodeSlug(slug)).toEqual({
      kind: "repo",
      owner: "geeksclub/relay",
      repo: "web-app",
    });
  });

  it("keeps the legacy GitHub slug format compatible", () => {
    const slug = encodeRepoSlug("oblien", "openship");
    expect(decodeSlug(slug)).toEqual({
      kind: "repo",
      owner: "oblien",
      repo: "openship",
    });
  });
});
