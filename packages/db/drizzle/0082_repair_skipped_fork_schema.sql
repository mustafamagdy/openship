-- Repair migrations introduced by the fork whose journal timestamps predate
-- migrations already applied on an existing self-hosted database. Drizzle's
-- migrator advances from the last applied timestamp, so these additive
-- statements must be replayed from a new, monotonic migration.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "forward_git_to_server" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "gh_device_token_encrypted" text;
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "gh_device_token_set_at" timestamp;
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "gh_device_token_method" text;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "volumes" jsonb;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "object_storage" jsonb;
