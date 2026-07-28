import { afterEach, describe, expect, it, vi } from "vitest";
import { validateRegistryCredentials } from "./registry-auth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("container registry credential validation", () => {
  it("completes a standard OCI Bearer challenge before saving GHCR", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:mustafamagdy/app:pull,push"',
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ token: "registry-bearer-token" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      validateRegistryCredentials(
        "ghcr.io",
        "mustafamagdy",
        "github-token",
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenUrl = fetchMock.mock.calls[1]![0] as URL;
    expect(tokenUrl.toString()).toContain("service=ghcr.io");
    expect(tokenUrl.toString()).toContain(
      "scope=repository%3Amustafamagdy%2Fapp%3Apull%2Cpush",
    );
    expect(fetchMock.mock.calls[2]![1]?.headers).toMatchObject({
      Authorization: "Bearer registry-bearer-token",
    });
  });
});
