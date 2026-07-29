import { describe, expect, it } from "vitest";

import { shouldRunControl } from "../../src/lib/setup-state";

describe("shouldRunControl", () => {
  it("recognizes a completed Compose install without a host service", () => {
    expect(
      shouldRunControl({
        serviceInstalled: false,
        installMethod: "compose",
        setupInProgress: false,
      }),
    ).toBe(true);
  });

  it("recognizes a completed bare service install", () => {
    expect(
      shouldRunControl({
        serviceInstalled: true,
        installMethod: "bare",
        setupInProgress: false,
      }),
    ).toBe(true);
  });

  it("resumes interrupted setup regardless of install method", () => {
    expect(
      shouldRunControl({
        serviceInstalled: false,
        installMethod: "compose",
        setupInProgress: true,
      }),
    ).toBe(false);
  });
});
