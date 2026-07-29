import { describe, expect, test } from "vitest";
import type { CommandExecutor } from "../types";
import {
  OPENRESTY_DEFAULT_PATHS,
  buildReloadCommand,
  deployLuaScripts,
  ensureOpenRestyConfig,
} from "./openresty-lua";

describe("OpenResty managed-edge integration", () => {
  test("accepts the sites include from a companion conf file", async () => {
    const calls: string[] = [];
    const executor = {
      mkdir: async () => {},
      writeFile: async () => {},
      exists: async () => true,
      exec: async (command: string) => {
        calls.push(command);
        if (command.startsWith("grep -RqsF")) return "";
        return "";
      },
    } as unknown as CommandExecutor;

    await ensureOpenRestyConfig(executor, OPENRESTY_DEFAULT_PATHS);

    expect(calls.some((command) => command.startsWith("grep -RqsF"))).toBe(true);
    expect(calls.some((command) => command.includes("sed -i"))).toBe(false);
  });

  test("prefers the restricted systemd reload before direct process signalling", () => {
    const command = buildReloadCommand(OPENRESTY_DEFAULT_PATHS);
    expect(command).toContain("systemctl reload openresty.service");
    expect(command.indexOf("systemctl reload openresty.service")).toBeLessThan(
      command.indexOf(`${OPENRESTY_DEFAULT_PATHS.bin} -t`),
    );
  });

  test("finds Lua directives in companion conf files before attempting a root config edit", async () => {
    const calls: string[] = [];
    const executor = {
      mkdir: async () => {},
      writeFile: async () => {},
      exists: async () => true,
      exec: async (command: string) => {
        calls.push(command);
        return "";
      },
    } as unknown as CommandExecutor;

    await deployLuaScripts(executor, OPENRESTY_DEFAULT_PATHS);

    const directiveChecks = calls.filter((command) =>
      command.includes("lua_shared_dict") || command.includes("lua_package_path"),
    );
    expect(directiveChecks).toHaveLength(5);
    expect(
      directiveChecks.every((command) =>
        command.startsWith("grep -RqsF --include='*.conf'"),
      ),
    ).toBe(true);
  });
});
