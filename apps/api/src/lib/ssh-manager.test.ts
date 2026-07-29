import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandExecutor } from "@repo/adapters";
import { SshConnectionManager } from "./ssh-manager";

afterEach(() => {
  vi.useRealTimers();
});

describe("SshConnectionManager.withExecutor", () => {
  it("keeps the cached connection alive for the full callback and restarts idle expiry after", async () => {
    vi.useFakeTimers();
    const dispose = vi.fn();
    const executor = { dispose } as unknown as CommandExecutor;
    const manager = new SshConnectionManager({ idleTimeoutMs: 1_000 });
    const internals = manager as unknown as {
      servers: Map<
        string,
        {
          executor: CommandExecutor;
          idleTimer: ReturnType<typeof setTimeout> | null;
        }
      >;
    };
    internals.servers.set("server-1", { executor, idleTimer: null });

    let finish!: () => void;
    const callbackFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation = manager.withExecutor("server-1", async () => {
      await callbackFinished;
      return "complete";
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(dispose).not.toHaveBeenCalled();

    finish();
    await expect(operation).resolves.toBe("complete");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
