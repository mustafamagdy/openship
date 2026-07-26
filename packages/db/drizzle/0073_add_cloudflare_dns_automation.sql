CREATE TABLE IF NOT EXISTS "dns_provider_connection" (
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
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dns_provider_connection_organization_id_organization_id_fk') THEN
		ALTER TABLE "dns_provider_connection" ADD CONSTRAINT "dns_provider_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dns_provider_connection_connected_by_user_id_user_id_fk') THEN
		ALTER TABLE "dns_provider_connection" ADD CONSTRAINT "dns_provider_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dns_provider_connection_org_provider" ON "dns_provider_connection" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dns_provider_connection_org" ON "dns_provider_connection" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN IF NOT EXISTS "dns_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN IF NOT EXISTS "dns_provider" text;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN IF NOT EXISTS "dns_provider_zone_id" text;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN IF NOT EXISTS "dns_status" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD COLUMN IF NOT EXISTS "dns_last_synced_at" timestamp;
