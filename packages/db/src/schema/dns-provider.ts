import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { user } from "./auth";

/**
 * Organization-scoped DNS provider credentials.
 *
 * Tokens are encrypted by the API before they reach this table and are never
 * returned to clients. Keeping the connection at organization scope lets every
 * registered domain share one least-privilege provider token.
 */
export const dnsProviderConnection = pgTable(
  "dns_provider_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectedByUserId: text("connected_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    tokenSetAt: timestamp("token_set_at").notNull().defaultNow(),
    lastValidatedAt: timestamp("last_validated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_dns_provider_connection_org_provider").on(
      t.organizationId,
      t.provider,
    ),
    index("idx_dns_provider_connection_org").on(t.organizationId),
  ],
);
