import type { Context } from "hono";
import { dumpPgliteDataDir, getDriver } from "@repo/db";

export async function downloadInstanceBackup(c: Context) {
  if (getDriver() !== "pglite") {
    return c.json(
      {
        error:
          "This endpoint backs up embedded PGlite instances only. Use PostgreSQL-native backups for DATABASE_URL deployments.",
      },
      409,
    );
  }

  const backup = await dumpPgliteDataDir();
  const bytes = await backup.arrayBuffer();
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="openship-pglite-${timestamp}.tar.gz"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
