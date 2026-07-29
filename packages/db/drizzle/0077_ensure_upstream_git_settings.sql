-- Compatibility bridge for customized databases whose later-numbered fork
-- migrations were already applied before upstream's 0070-0072 migrations were
-- merged into the journal. Drizzle advances by migration timestamp, so those
-- newly inserted historical entries are correctly skipped on such databases.
-- Keep this forward migration additive and idempotent for both upgraded and
-- fresh installations.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "forward_git_to_server" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "gh_device_token_encrypted" text;
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "gh_device_token_set_at" timestamp;
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "gh_device_token_method" text;
