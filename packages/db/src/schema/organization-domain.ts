import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./organization";

/**
 * A base domain registered once for an organization and then reused by project
 * routes as <subdomain>.<domain>. This is deliberately separate from `domain`,
 * whose rows are concrete project/service hostnames.
 */
export const organizationDomain = pgTable(
  "organization_domain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    verificationToken: text("verification_token").notNull(),
    status: text("status").notNull().default("pending"),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at"),
    isDefault: boolean("is_default").notNull().default(false),
    dnsManaged: boolean("dns_managed").notNull().default(false),
    dnsProvider: text("dns_provider"),
    dnsProviderZoneId: text("dns_provider_zone_id"),
    dnsStatus: text("dns_status").notNull().default("manual"),
    dnsLastSyncedAt: timestamp("dns_last_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_organization_domain_name").on(t.domain),
    index("idx_organization_domain_org").on(t.organizationId),
    uniqueIndex("uq_organization_domain_default")
      .on(t.organizationId)
      .where(sql`${t.isDefault} = true`),
  ],
);
