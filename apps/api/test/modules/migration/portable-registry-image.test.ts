import { describe, expect, it } from "vitest";
import { isPortableRegistryImage } from "../../../src/modules/migration/migration-preflight";

describe("portable registry image detection", () => {
  it("accepts explicit registry hosts and rejects local build tags", () => {
    expect(
      isPortableRegistryImage(`ghcr.io/acme/shop@sha256:${"a".repeat(64)}`),
    ).toBe(true);
    expect(isPortableRegistryImage("registry.example.com:5000/acme/shop:dep_1")).toBe(true);
    expect(isPortableRegistryImage("openship/shop:bld_1")).toBe(false);
    expect(isPortableRegistryImage("shop:latest")).toBe(false);
  });
});
