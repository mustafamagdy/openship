DROP INDEX IF EXISTS "uq_webhook_delivery_github_delivery";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_webhook_delivery_source_delivery" ON "webhook_delivery" USING btree ("source","delivery_id") WHERE "webhook_delivery"."delivery_id" IS NOT NULL;
