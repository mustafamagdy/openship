import { describe, expect, test } from "vitest";
import { localNginxOptions } from "../../src/lib/certbot-state";

describe("localNginxOptions", () => {
  test("uses writable per-user ACME state for bare self-hosting", () => {
    expect(localNginxOptions({}, "/home/openship")).toEqual({
      certbotStateDir: "/home/openship/.openship/edge/certbot",
    });
  });

  test("keeps the explicit Certbot state override", () => {
    expect(
      localNginxOptions(
        { OPENSHIP_CERTBOT_STATE_DIR: " /srv/openship/acme " },
        "/home/openship",
      ),
    ).toEqual({ certbotStateDir: "/srv/openship/acme" });
  });

  test("anchors the default below OPENSHIP_DATA_DIR", () => {
    expect(
      localNginxOptions({ OPENSHIP_DATA_DIR: "/srv/openship" }, "/home/openship"),
    ).toEqual({ certbotStateDir: "/srv/openship/edge/certbot" });
  });

  test("retains the persistent /etc/letsencrypt volume in Docker edge mode", () => {
    expect(
      localNginxOptions({ OPENSHIP_EDGE_MODE: "docker" }, "/home/openship"),
    ).toBeUndefined();
  });
});
