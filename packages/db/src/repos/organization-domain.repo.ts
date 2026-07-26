import { and, eq } from "drizzle-orm";
import { generateId } from "@repo/core";
import type { Database } from "../client";
import { organizationDomain } from "../schema";

export type OrganizationDomain = typeof organizationDomain.$inferSelect;
export type NewOrganizationDomain = typeof organizationDomain.$inferInsert;

export function createOrganizationDomainRepo(db: Database) {
  return {
    async listByOrganization(organizationId: string): Promise<OrganizationDomain[]> {
      return db.query.organizationDomain.findMany({
        where: eq(organizationDomain.organizationId, organizationId),
        orderBy: (row, { desc, asc }) => [desc(row.isDefault), asc(row.domain)],
      });
    },

    async findById(organizationId: string, id: string): Promise<OrganizationDomain | undefined> {
      return db.query.organizationDomain.findFirst({
        where: and(
          eq(organizationDomain.organizationId, organizationId),
          eq(organizationDomain.id, id),
        ),
      });
    },

    async findByDomain(domainName: string): Promise<OrganizationDomain | undefined> {
      return db.query.organizationDomain.findFirst({
        where: eq(organizationDomain.domain, domainName.toLowerCase()),
      });
    },

    async findVerifiedParent(
      organizationId: string,
      hostname: string,
    ): Promise<OrganizationDomain | undefined> {
      const normalized = hostname.toLowerCase();
      const rows = await db.query.organizationDomain.findMany({
        where: and(
          eq(organizationDomain.organizationId, organizationId),
          eq(organizationDomain.verified, true),
        ),
      });
      return rows
        .filter((row) => normalized.endsWith(`.${row.domain}`))
        .sort((left, right) => right.domain.length - left.domain.length)[0];
    },

    async create(
      data: Omit<NewOrganizationDomain, "id" | "createdAt" | "updatedAt">,
    ): Promise<OrganizationDomain> {
      const [row] = await db
        .insert(organizationDomain)
        .values({
          id: generateId("odm"),
          ...data,
          domain: data.domain.toLowerCase(),
        })
        .returning();
      return row;
    },

    async markVerified(
      organizationId: string,
      id: string,
    ): Promise<OrganizationDomain | undefined> {
      return db.transaction(async (tx) => {
        const existing = await tx.query.organizationDomain.findFirst({
          where: and(
            eq(organizationDomain.organizationId, organizationId),
            eq(organizationDomain.id, id),
          ),
        });
        if (!existing) return undefined;

        const hasDefault = await tx.query.organizationDomain.findFirst({
          where: and(
            eq(organizationDomain.organizationId, organizationId),
            eq(organizationDomain.isDefault, true),
          ),
        });
        const [row] = await tx
          .update(organizationDomain)
          .set({
            verified: true,
            verifiedAt: new Date(),
            status: "active",
            isDefault: existing.isDefault || !hasDefault,
            updatedAt: new Date(),
          })
          .where(eq(organizationDomain.id, id))
          .returning();
        return row;
      });
    },

    async setDefault(organizationId: string, id: string): Promise<OrganizationDomain | undefined> {
      return db.transaction(async (tx) => {
        const existing = await tx.query.organizationDomain.findFirst({
          where: and(
            eq(organizationDomain.organizationId, organizationId),
            eq(organizationDomain.id, id),
            eq(organizationDomain.verified, true),
          ),
        });
        if (!existing) return undefined;

        await tx
          .update(organizationDomain)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(organizationDomain.organizationId, organizationId));
        const [row] = await tx
          .update(organizationDomain)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(organizationDomain.id, id))
          .returning();
        return row;
      });
    },

    async setDnsState(
      organizationId: string,
      id: string,
      state: {
        dnsManaged: boolean;
        dnsProvider: string | null;
        dnsProviderZoneId: string | null;
        dnsStatus: string;
        dnsLastSyncedAt: Date | null;
      },
    ): Promise<OrganizationDomain | undefined> {
      const [row] = await db
        .update(organizationDomain)
        .set({ ...state, updatedAt: new Date() })
        .where(
          and(
            eq(organizationDomain.organizationId, organizationId),
            eq(organizationDomain.id, id),
          ),
        )
        .returning();
      return row;
    },

    async clearDnsProvider(organizationId: string, provider: string): Promise<void> {
      await db
        .update(organizationDomain)
        .set({
          dnsManaged: false,
          dnsProvider: null,
          dnsProviderZoneId: null,
          dnsStatus: "manual",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationDomain.organizationId, organizationId),
            eq(organizationDomain.dnsProvider, provider),
          ),
        );
    },

    async remove(organizationId: string, id: string): Promise<void> {
      await db
        .delete(organizationDomain)
        .where(
          and(eq(organizationDomain.organizationId, organizationId), eq(organizationDomain.id, id)),
        );
    },
  };
}
