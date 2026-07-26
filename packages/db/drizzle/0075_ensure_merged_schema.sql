-- Compatibility bridge for databases that previously ran the fork's original
-- 0062 migration before upstream's different 0062 migration was merged.
-- New databases already have this table from 0062; every statement is
-- intentionally idempotent.
CREATE TABLE IF NOT EXISTS "incoming_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_mode" text DEFAULT 'token' NOT NULL,
	"token_encrypted" text,
	"hmac_secret_encrypted" text,
	"created_by" text,
	"last_fired_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incoming_webhook_organization_id_organization_id_fk') THEN
		ALTER TABLE "incoming_webhook" ADD CONSTRAINT "incoming_webhook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incoming_webhook_project_id_project_id_fk') THEN
		ALTER TABLE "incoming_webhook" ADD CONSTRAINT "incoming_webhook_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_incoming_webhook_project" ON "incoming_webhook" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_incoming_webhook_org" ON "incoming_webhook" USING btree ("organization_id");
