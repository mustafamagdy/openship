import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, dumpPgliteDataDir } from "./client";

describe("online PGlite instance backup", () => {
  it("creates a non-empty gzip from the active database", async () => {
    await db.execute(sql`select 1`);

    const backup = await dumpPgliteDataDir();
    const bytes = new Uint8Array(await backup.arrayBuffer());

    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1f, 0x8b]);
  });
});
