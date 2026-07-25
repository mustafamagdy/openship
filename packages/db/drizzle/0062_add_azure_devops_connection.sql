CREATE TABLE "azure_devops_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"azure_organization" text NOT NULL,
	"organization_url" text NOT NULL,
	"pat_encrypted" text NOT NULL,
	"pat_set_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "azure_devops_connection" ADD CONSTRAINT "azure_devops_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "azure_devops_connection" ADD CONSTRAINT "azure_devops_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_azure_devops_connection_org_account" ON "azure_devops_connection" USING btree ("organization_id","azure_organization");
--> statement-breakpoint
CREATE INDEX "idx_azure_devops_connection_org" ON "azure_devops_connection" USING btree ("organization_id");
