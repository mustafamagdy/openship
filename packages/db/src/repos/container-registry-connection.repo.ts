import { and, eq } from "drizzle-orm";
import { generateId } from "@repo/core";
import type { Database } from "../client";
import { containerRegistryConnection } from "../schema";

export type ContainerRegistryConnection = typeof containerRegistryConnection.$inferSelect;
export type NewContainerRegistryConnection = typeof containerRegistryConnection.$inferInsert;

export function createContainerRegistryConnectionRepo(db: Database) {
  return {
    async listByOrganization(organizationId: string): Promise<ContainerRegistryConnection[]> {
      return db.query.containerRegistryConnection.findMany({
        where: eq(containerRegistryConnection.organizationId, organizationId),
        orderBy: (row, { desc, asc }) => [desc(row.isDefault), asc(row.name)],
      });
    },

    async findDefault(organizationId: string): Promise<ContainerRegistryConnection | undefined> {
      return db.query.containerRegistryConnection.findFirst({
        where: and(
          eq(containerRegistryConnection.organizationId, organizationId),
          eq(containerRegistryConnection.isDefault, true),
        ),
      });
    },

    async findById(
      organizationId: string,
      id: string,
    ): Promise<ContainerRegistryConnection | undefined> {
      return db.query.containerRegistryConnection.findFirst({
        where: and(
          eq(containerRegistryConnection.organizationId, organizationId),
          eq(containerRegistryConnection.id, id),
        ),
      });
    },

    async upsertDefault(
      data: Omit<NewContainerRegistryConnection, "id" | "createdAt" | "updatedAt">,
    ): Promise<ContainerRegistryConnection> {
      return db.transaction(async (tx) => {
        await tx
          .update(containerRegistryConnection)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(containerRegistryConnection.organizationId, data.organizationId));
        const existing = await tx.query.containerRegistryConnection.findFirst({
          where: and(
            eq(containerRegistryConnection.organizationId, data.organizationId),
            eq(containerRegistryConnection.name, data.name),
          ),
        });
        if (existing) {
          const [row] = await tx
            .update(containerRegistryConnection)
            .set({ ...data, isDefault: true, tokenSetAt: new Date(), lastValidatedAt: new Date(), updatedAt: new Date() })
            .where(eq(containerRegistryConnection.id, existing.id))
            .returning();
          return row;
        }
        const [row] = await tx
          .insert(containerRegistryConnection)
          .values({ id: generateId("reg"), ...data, isDefault: true })
          .returning();
        return row;
      });
    },

    async remove(organizationId: string, id: string): Promise<void> {
      await db
        .delete(containerRegistryConnection)
        .where(
          and(
            eq(containerRegistryConnection.organizationId, organizationId),
            eq(containerRegistryConnection.id, id),
          ),
        );
    },
  };
}
