import { describe, expect, it } from "vitest";

import { resolveStaticRuntimeDirectory } from "../../../src/modules/deployments/build-config";

describe("resolveStaticRuntimeDirectory", () => {
  it("serves a no-build static project from its configured root directory", () => {
    expect(resolveStaticRuntimeDirectory("dist", ".")).toBe("dist");
  });

  it("resolves build output relative to the configured project root", () => {
    expect(resolveStaticRuntimeDirectory("apps/web", "build")).toBe(
      "apps/web/build",
    );
  });

  it("preserves root-level output", () => {
    expect(resolveStaticRuntimeDirectory("", ".")).toBe(".");
    expect(resolveStaticRuntimeDirectory("", "public")).toBe("public");
  });
});
