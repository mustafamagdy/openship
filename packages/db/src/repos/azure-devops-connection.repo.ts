import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { azureDevopsConnection } from "../schema";

export type AzureDevopsConnection = typeof azureDevopsConnection.$inferSelect;
export type NewAzureDevopsConnection = typeof azureDevopsConnection.$inferInsert;

/** Persistence for Azure DevOps connections. Encryption remains an API concern. */
export function createAzureDevopsConnectionRepo(db: Database) {
  return {
    async listByOrganization(organizationId: string): Promise<AzureDevopsConnection[]> {
      return db.query.azureDevopsConnection.findMany({
        where: eq(azureDevopsConnection.organizationId, organizationId),
        orderBy: (row, { asc }) => [asc(row.azureOrganization)],
      });
    },

    async findByAzureOrganization(
      organizationId: string,
      azureOrganization: string,
    ): Promise<AzureDevopsConnection | undefined> {
      return db.query.azureDevopsConnection.findFirst({
        where: and(
          eq(azureDevopsConnection.organizationId, organizationId),
          eq(azureDevopsConnection.azureOrganization, azureOrganization.toLowerCase()),
        ),
      });
    },

    async upsert(data: NewAzureDevopsConnection): Promise<AzureDevopsConnection> {
      const [row] = await db
        .insert(azureDevopsConnection)
        .values(data)
        .onConflictDoUpdate({
          target: [
            azureDevopsConnection.organizationId,
            azureDevopsConnection.azureOrganization,
          ],
          set: {
            connectedByUserId: data.connectedByUserId,
            organizationUrl: data.organizationUrl,
            patEncrypted: data.patEncrypted,
            patSetAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    },

    async delete(
      organizationId: string,
      azureOrganization: string,
    ): Promise<void> {
      await db
        .delete(azureDevopsConnection)
        .where(
          and(
            eq(azureDevopsConnection.organizationId, organizationId),
            eq(azureDevopsConnection.azureOrganization, azureOrganization.toLowerCase()),
          ),
        );
    },
  };
}
