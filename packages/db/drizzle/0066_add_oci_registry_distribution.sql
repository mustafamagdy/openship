CREATE TABLE "container_registry_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'generic' NOT NULL,
	"registry_host" text NOT NULL,
	"namespace" text NOT NULL,
	"username" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"token_set_at" timestamp DEFAULT now() NOT NULL,
	"last_validated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "image_digest" text;--> statement-breakpoint
ALTER TABLE "container_registry_connection" ADD CONSTRAINT "container_registry_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_registry_connection" ADD CONSTRAINT "container_registry_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_container_registry_org_name" ON "container_registry_connection" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_container_registry_default" ON "container_registry_connection" USING btree ("organization_id") WHERE "container_registry_connection"."is_default" = true;--> statement-breakpoint
CREATE INDEX "idx_container_registry_org" ON "container_registry_connection" USING btree ("organization_id");