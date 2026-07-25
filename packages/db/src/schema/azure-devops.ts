import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { user } from "./auth";

/**
 * An Azure DevOps organization connected to an Openship organization.
 *
 * Azure Repos credentials are deliberately stored at the provider-account
 * boundary rather than copied onto projects. Projects identify the connection
 * through `gitOwner = "<azure-organization>/<azure-project>"`; the PAT is
 * resolved and decrypted only for Azure DevOps API calls and git clones.
 */
export const azureDevopsConnection = pgTable(
  "azure_devops_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectedByUserId: text("connected_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Azure DevOps organization slug, e.g. "geeksclub". */
    azureOrganization: text("azure_organization").notNull(),
    /** Canonical base URL, e.g. "https://dev.azure.com/geeksclub". */
    organizationUrl: text("organization_url").notNull(),
    /** Encrypted with the instance encryption helper; never returned by APIs. */
    patEncrypted: text("pat_encrypted").notNull(),
    patSetAt: timestamp("pat_set_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_azure_devops_connection_org_account").on(
      t.organizationId,
      t.azureOrganization,
    ),
    index("idx_azure_devops_connection_org").on(t.organizationId),
  ],
);
