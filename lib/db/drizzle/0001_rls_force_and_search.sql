-- Tenant isolation, part two (part one is the policies in 0000).
--
-- 1. FORCE row-level security. Without it the table OWNER bypasses every
--    policy, and the app role usually owns the tables it migrates — so the
--    policies would silently do nothing. NOTE: superusers and roles with
--    BYPASSRLS ignore RLS even when forced; the app must connect as an
--    ordinary role (see lib/db/MIGRATIONS.md).
-- 2. One tenant_id index per tenant-scoped table: every query is filtered on
--    it by the policy.
-- 3. pg_trgm search indexes for global search (ILIKE '%term%'). The phone
--    expression must stay byte-for-byte identical to phoneNsnSql() in
--    artifacts/api-server/src/lib/queries.ts.
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "persons" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "note_reactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "change_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_field_option" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_field" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lost_reasons" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assignment_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "insights_dashboards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "insights_dashboard_widgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_tenant_idx" ON "users" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipelines_tenant_idx" ON "pipelines" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stages_tenant_idx" ON "stages" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_tenant_idx" ON "organizations" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_tenant_idx" ON "persons" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_tenant_idx" ON "deals" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_tenant_idx" ON "activities" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_tenant_idx" ON "notes" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_reactions_tenant_idx" ON "note_reactions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_subscriptions_tenant_idx" ON "notification_subscriptions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_files_tenant_idx" ON "crm_files" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_views_tenant_idx" ON "deal_views" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_preferences_tenant_idx" ON "user_preferences" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_events_tenant_idx" ON "change_events" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_field_option_tenant_idx" ON "deal_field_option" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_field_tenant_idx" ON "deal_field" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "labels_tenant_idx" ON "labels" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lost_reasons_tenant_idx" ON "lost_reasons" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_tenant_idx" ON "teams" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_rules_tenant_idx" ON "assignment_rules" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_tenant_idx" ON "automations" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_templates_tenant_idx" ON "automation_templates" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_settings_tenant_idx" ON "app_settings" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insights_dashboards_tenant_idx" ON "insights_dashboards" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insights_dashboard_widgets_tenant_idx" ON "insights_dashboard_widgets" USING btree ("tenant_id");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_name_trgm" ON "persons" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_email_trgm" ON "persons" USING gin ("email" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_phone_nsn_trgm" ON "persons" USING gin ((ltrim(regexp_replace(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), '^(00)?966', ''), '0')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_name_trgm" ON "organizations" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_address_trgm" ON "organizations" USING gin ("address" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_title_trgm" ON "deals" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_comments_trgm" ON "deals" USING gin ("comments" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_utm_keyword_trgm" ON "deals" USING gin ("utm_keyword" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_subject_trgm" ON "activities" USING gin ("subject" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_note_trgm" ON "activities" USING gin ("note" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_content_trgm" ON "notes" USING gin ("content" gin_trgm_ops);
