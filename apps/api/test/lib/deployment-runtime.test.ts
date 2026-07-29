import { describe, expect, test } from "vitest";
import { isLoopbackServerHost } from "../../src/lib/loopback-server-host";
import {
  bareWorkDirFromHome,
  resolveWorkloadRuntimeMode,
  supportsKubernetesDeployment,
} from "../../src/lib/deployment-runtime";

describe("deployment target resolution", () => {
  test.each([
    ["127.0.0.1", true],
    ["localhost", true],
    ["LOCALHOST", true],
    ["::1", true],
    ["[::1]", true],
    ["192.168.1.169", false],
    ["server.internal", false],
    [null, false],
  ])("classifies loopback host %j as %s", (host, expected) => {
    expect(isLoopbackServerHost(host)).toBe(expected);
  });
});

describe("workload runtime resolution", () => {
  test("allows a prebuilt-image service stack on Kubernetes", () => {
    expect(supportsKubernetesDeployment(false, true)).toBe(true);
  });

  test("rejects a static single app from Kubernetes", () => {
    expect(supportsKubernetesDeployment(false, false)).toBe(false);
  });

  test("publishes a static single app through the bare file runtime", () => {
    expect(
      resolveWorkloadRuntimeMode({ runtimeMode: "docker", hasServer: false }, false),
    ).toBe("bare");
  });

  test("keeps services on Docker even when the parent project is static", () => {
    expect(
      resolveWorkloadRuntimeMode({ runtimeMode: "bare", hasServer: false }, true),
    ).toBe("docker");
  });

  test("preserves the selected runtime for a server app", () => {
    expect(
      resolveWorkloadRuntimeMode({ runtimeMode: "docker", hasServer: true }, false),
    ).toBe("docker");
  });
});

describe("direct runtime storage", () => {
  test("places runtime releases under the authenticated target user's home", () => {
    expect(bareWorkDirFromHome("/home/openship\n")).toBe(
      "/home/openship/.openship/runtime",
    );
  });

  test("rejects a non-absolute target home", () => {
    expect(() => bareWorkDirFromHome("relative/home")).toThrow(
      "Cannot determine a safe home directory",
    );
  });
});
