ALTER TABLE "tenants" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "week_start" smallint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_currency" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone_country_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_locale" text;