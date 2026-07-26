import { describe, expect, test } from "bun:test";

import { sanitizeCliPackageManifest } from "./sanitize-cli-package";

describe("sanitizeCliPackageManifest", () => {
  test("removes workspace dependencies and prepack without changing registry dependencies", () => {
    const manifest = {
      dependencies: {
        "@repo/adapters": "workspace:*",
        commander: "^14.0.3",
      },
      optionalDependencies: {
        "@repo/optional": "workspace:^",
        open: "^10.2.0",
      },
      peerDependencies: {
        "@repo/peer": "workspace:~",
      },
      devDependencies: {
        "@repo/dev": "workspace:1.0.0",
        typescript: "^5.9.3",
      },
      scripts: {
        build: "tsup",
        prepack: "cp ../../README.md README.md",
      },
    };

    expect(sanitizeCliPackageManifest(manifest)).toEqual({
      dependencies: {
        commander: "^14.0.3",
      },
      optionalDependencies: {
        open: "^10.2.0",
      },
      peerDependencies: {},
      devDependencies: {
        typescript: "^5.9.3",
      },
      scripts: {
        build: "tsup",
      },
    });
  });
});
