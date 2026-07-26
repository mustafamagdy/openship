import { describe, expect, it, vi } from "vitest";
import { DockerRuntime } from "../src/runtime/docker";

function remoteRuntime() {
  const files = new Map<string, string>();
  const executor = {
    exec: vi.fn(async (command: string) =>
      command.includes("docker push")
        ? `latest: digest: sha256:${"a".repeat(64)} size: 1234`
        : "",
    ),
    streamExec: vi.fn(),
    writeFile: vi.fn(async (path: string, content: string) => void files.set(path, content)),
    readFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
    transferIn: vi.fn(),
  };
  const runtime = Object.create(DockerRuntime.prototype) as DockerRuntime;
  Object.defineProperty(runtime, "connectionOptions", { value: { executor } });
  return { runtime, executor, files };
}

describe("Docker registry distribution", () => {
  it("pushes with an ephemeral Docker config and returns an immutable digest", async () => {
    const { runtime, executor, files } = remoteRuntime();
    const result = await runtime.publishImage(
      "openship/shop:build_1",
      "ghcr.io/acme/openship-shop:dep_1",
      { username: "acme", password: "top-secret-token", serveraddress: "ghcr.io" },
    );

    expect(result).toEqual({
      imageRef: `ghcr.io/acme/openship-shop@sha256:${"a".repeat(64)}`,
      imageDigest: `sha256:${"a".repeat(64)}`,
    });
    expect(executor.exec.mock.calls.flat().join(" ")).not.toContain("top-secret-token");
    expect([...files.values()].join(" ")).not.toContain("top-secret-token");
    expect([...files.values()].join(" ")).toContain(
      Buffer.from("acme:top-secret-token").toString("base64"),
    );
    expect(executor.rm).toHaveBeenCalledTimes(1);
  });
});
