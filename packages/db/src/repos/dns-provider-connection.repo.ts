import { and, eq } from "drizzle-orm";
import { generateId } from "@repo/core";
import type { Database } from "../client";
import { dnsProviderConnection } from "../schema";

export type DnsProviderConnection = typeof dnsProviderConnection.$inferSelect;
export type NewDnsProviderConnection = typeof dnsProviderConnection.$inferInsert;

/** Persistence only. Encryption and provider validation remain API concerns. */
export function createDnsProviderConnectionRepo(db: Database) {
  return {
    async find(
      organizationId: string,
      provider: string,
    ): Promise<DnsProviderConnection | undefined> {
      return db.query.dnsProviderConnection.findFirst({
        where: and(
          eq(dnsProviderConnection.organizationId, organizationId),
          eq(dnsProviderConnection.provider, provider),
        ),
      });
    },

    async upsert(
      data: Omit<NewDnsProviderConnection, "id" | "createdAt" | "updatedAt">,
    ): Promise<DnsProviderConnection> {
      const [row] = await db
        .insert(dnsProviderConnection)
        .values({ id: generateId("dns"), ...data })
        .onConflictDoUpdate({
          target: [
            dnsProviderConnection.organizationId,
            dnsProviderConnection.provider,
          ],
          set: {
            connectedByUserId: data.connectedByUserId,
            tokenEncrypted: data.tokenEncrypted,
            tokenSetAt: new Date(),
            lastValidatedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    },

    async remove(organizationId: string, provider: string): Promise<void> {
      await db
        .delete(dnsProviderConnection)
        .where(
          and(
            eq(dnsProviderConnection.organizationId, organizationId),
            eq(dnsProviderConnection.provider, provider),
          ),
        );
    },
  };
}
