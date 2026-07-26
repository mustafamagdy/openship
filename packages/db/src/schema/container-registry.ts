import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { user } from "./auth";

/** Organization-scoped OCI registry used for build artifact distribution. */
export const containerRegistryConnection = pgTable(
  "container_registry_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectedByUserId: text("connected_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("generic"),
    registryHost: text("registry_host").notNull(),
    namespace: text("namespace").notNull(),
    username: text("username").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    isDefault: boolean("is_default").notNull().default(true),
    tokenSetAt: timestamp("token_set_at").notNull().defaultNow(),
    lastValidatedAt: timestamp("last_validated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_container_registry_org_name").on(t.organizationId, t.name),
    uniqueIndex("uq_container_registry_default")
      .on(t.organizationId)
      .where(sql`${t.isDefault} = true`),
    index("idx_container_registry_org").on(t.organizationId),
  ],
);
