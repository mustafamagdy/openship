import { homedir } from "node:os";
import { join } from "node:path";
import type { PlatformConfig } from "@repo/adapters";

/**
 * Certbot cannot use its root-owned default state directories when the
 * self-hosted API runs as an unprivileged service user. Bare/local installs
 * therefore keep ACME state beside the rest of OpenShip's user-owned data.
 *
 * The containerized edge intentionally retains `/etc/letsencrypt`: that path is
 * a dedicated persistent volume and the edge container runs Certbot itself.
 */
export function localNginxOptions(
  processEnv: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): PlatformConfig["nginx"] {
  const configured = processEnv.OPENSHIP_CERTBOT_STATE_DIR?.trim();
  if (configured) return { certbotStateDir: configured };

  if (processEnv.OPENSHIP_EDGE_MODE?.trim().toLowerCase() === "docker") {
    return undefined;
  }

  const dataDir = processEnv.OPENSHIP_DATA_DIR?.trim() || join(home, ".openship");
  return { certbotStateDir: join(dataDir, "edge", "certbot") };
}
