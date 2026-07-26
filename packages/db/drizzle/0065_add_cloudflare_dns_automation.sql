CREATE TABLE "dns_provider_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_set_at" timestamp DEFAULT now() NOT NULL,
	"last_validated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dns_provider_connection" ADD CONSTRAINT "dns_provider_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_provider_connection" ADD CONSTRAINT "dns_provider_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dns_provider_connection_org_provider" ON "dns_provider_connection" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "idx_dns_provider_connection_org" ON "dns_provider_connection" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN "dns_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN "dns_provider" text;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN "dns_provider_zone_id" text;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN "dns_status" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN "dns_last_synced_at" timestamp;
