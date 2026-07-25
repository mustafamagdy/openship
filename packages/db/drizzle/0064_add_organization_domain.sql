CREATE TABLE "organization_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organization_domain_name" ON "organization_domain" USING btree ("domain");
--> statement-breakpoint
CREATE INDEX "idx_organization_domain_org" ON "organization_domain" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organization_domain_default" ON "organization_domain" USING btree ("organization_id") WHERE "organization_domain"."is_default" = true;
