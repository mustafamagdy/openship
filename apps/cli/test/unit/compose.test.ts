import { describe, expect, it, vi } from "vitest";

import { nonInteractiveSudoPrefix } from "../../src/lib/compose";

describe("nonInteractiveSudoPrefix", () => {
  it("does not probe or elevate when already root", () => {
    const probe = vi.fn(() => 1);

    expect(nonInteractiveSudoPrefix(true, probe)).toBe("");
    expect(probe).not.toHaveBeenCalled();
  });

  it("uses explicitly non-interactive sudo when the probe succeeds", () => {
    expect(nonInteractiveSudoPrefix(false, () => 0)).toBe("sudo -n ");
  });

  it("refuses elevation when sudo would prompt or is unavailable", () => {
    expect(nonInteractiveSudoPrefix(false, () => 1)).toBeNull();
    expect(nonInteractiveSudoPrefix(false, () => null)).toBeNull();
  });
});
