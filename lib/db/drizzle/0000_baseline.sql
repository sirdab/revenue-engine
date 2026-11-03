CREATE TYPE "public"."deal_status" AS ENUM('open', 'won', 'lost', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('call', 'meeting', 'email', 'task', 'deadline', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."change_entity_type" AS ENUM('deal', 'person', 'organization', 'activity', 'pipeline', 'stage', 'note', 'label', 'account', 'partner', 'account_activity', 'whatsapp_session');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('ui', 'import', 'api', 'automation');--> statement-breakpoint
CREATE TYPE "public"."deal_field_storage" AS ENUM('custom', 'data', 'column');--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"role_id" integer,
	"is_admin" boolean DEFAULT false NOT NULL,
	"active_flag" boolean DEFAULT true NOT NULL,
	"default_currency" text DEFAULT 'SAR' NOT NULL,
	"timezone_name" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"team_id" integer,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" text,
	"user_agent" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"won_required_fields" text[] DEFAULT '{}' NOT NULL,
	"admin_only_reassign" boolean DEFAULT false NOT NULL,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "pipelines_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pipeline_id" integer NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"probability" integer DEFAULT 100 NOT NULL,
	"rotting_days" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"required_fields" text[] DEFAULT '{}' NOT NULL,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "stages_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"address" text,
	"owner_id" integer,
	"labels" text[],
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "organizations_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"job_title" text,
	"organization_id" integer,
	"owner_id" integer,
	"labels" text[],
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "persons_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"status" "deal_status" DEFAULT 'open' NOT NULL,
	"owner_id" integer,
	"creator_user_id" integer,
	"person_id" integer,
	"organization_id" integer,
	"pipeline_id" integer NOT NULL,
	"stage_id" integer NOT NULL,
	"visible_to" text,
	"lost_reason" text,
	"lost_reason_note" text,
	"archived" boolean DEFAULT false NOT NULL,
	"archive_time" timestamp with time zone,
	"comments" text,
	"expected_close_date" date,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_keyword" text,
	"ad_name" text,
	"gclid" text,
	"fbclid" text,
	"labels" text[],
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_change_time" timestamp with time zone,
	"won_time" timestamp with time zone,
	"lost_time" timestamp with time zone,
	"close_time" timestamp with time zone,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	"custom_fields" jsonb,
	"external_id" text,
	"merged_into_deal_id" integer,
	CONSTRAINT "deals_pipedrive_id_unique" UNIQUE("pipedrive_id"),
	CONSTRAINT "deals_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "deals_merged_implies_archived_chk" CHECK ("deals"."merged_into_deal_id" is null or "deals"."archived" = true)
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"type" "activity_type" DEFAULT 'task' NOT NULL,
	"note" text,
	"done" boolean DEFAULT false NOT NULL,
	"busy" boolean DEFAULT false NOT NULL,
	"due_date" date,
	"due_time" text,
	"duration" text,
	"marked_as_done_time" timestamp with time zone,
	"outcome" text,
	"deal_id" integer,
	"person_id" integer,
	"org_id" integer,
	"owner_id" integer,
	"creator_user_id" integer,
	"draft" boolean DEFAULT false NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" integer,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "activities_pipedrive_id_unique" UNIQUE("pipedrive_id"),
	CONSTRAINT "activities_outcome_chk" CHECK ("activities"."outcome" in ('successful','no_reply'))
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"deal_id" integer,
	"person_id" integer,
	"org_id" integer,
	"user_id" integer,
	"pinned_to_deal_flag" boolean DEFAULT false NOT NULL,
	"pinned_to_person_flag" boolean DEFAULT false NOT NULL,
	"pinned_to_organization_flag" boolean DEFAULT false NOT NULL,
	"active_flag" boolean DEFAULT true NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	"lead_id" integer,
	"pinned_to_lead_flag" boolean DEFAULT false NOT NULL,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "notes_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "note_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"emoji" text NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_reactions_note_user_emoji_uq" UNIQUE("note_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "link_previews" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"status" text NOT NULL,
	"title" text,
	"description" text,
	"image_url" text,
	"site_name" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_previews_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"actor_id" integer,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"note_id" integer,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"automation_id" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"params" jsonb,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"value" double precision,
	"currency" text,
	"owner_id" integer,
	"person_id" integer,
	"organization_id" integer,
	"source_name" text,
	"labels" text,
	"expected_close_date" date,
	"archive_time" timestamp with time zone,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	"pipedrive_id" text,
	"pipedrive_data" jsonb,
	CONSTRAINT "leads_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text,
	"file_type" text,
	"download_url" text,
	"description" text,
	"deal_id" integer,
	"person_id" integer,
	"org_id" integer,
	"lead_id" integer,
	"user_id" integer,
	"add_time" timestamp with time zone,
	"update_time" timestamp with time zone,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	CONSTRAINT "files_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "crm_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"category" text NOT NULL,
	"deal_id" integer NOT NULL,
	"note_id" integer,
	"uploaded_by" integer,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reset_epoch" integer DEFAULT 0 NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" "change_entity_type" NOT NULL,
	"entity_id" bigint NOT NULL,
	"field_key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "change_source" DEFAULT 'ui' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_field_option" (
	"id" serial PRIMARY KEY NOT NULL,
	"field_id" integer NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_field" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"storage" "deal_field_storage" DEFAULT 'custom' NOT NULL,
	"source_key" text,
	"editable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_field_type_chk" CHECK ("deal_field"."field_type" in ('varchar','text','double','monetary','date','daterange','boolean','enum','set'))
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_entity_chk" CHECK ("labels"."entity" in ('deal','person','organization'))
);
--> statement-breakpoint
CREATE TABLE "lost_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"pipedrive_id" integer,
	"pipedrive_data" jsonb,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_pipedrive_id_unique" UNIQUE("pipedrive_id")
);
--> statement-breakpoint
CREATE TABLE "assignment_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"conditions" jsonb DEFAULT '{"combinator":"and","conditions":[]}'::jsonb NOT NULL,
	"target_team_id" integer,
	"target_assignee_id" integer,
	"takeover_owned" boolean DEFAULT false NOT NULL,
	"last_assigned_user_id" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_rules_trigger_event_chk" CHECK ("assignment_rules"."trigger_event" in ('deal_added','deal_updated'))
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"conditions" jsonb DEFAULT '{"combinator":"and","conditions":[]}'::jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_trigger_event_chk" CHECK ("automations"."trigger_event" in ('deal_added','deal_updated')),
	CONSTRAINT "automations_action_type_chk" CHECK ("automations"."action_type" in ('create_activity','create_deal','call_webhook','send_slack_message','post_notification'))
);
--> statement-breakpoint
CREATE TABLE "automation_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"emoji" text,
	"trigger_event" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb NOT NULL,
	"created_by" integer,
	"add_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights_dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"section" text,
	"owner_id" integer NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"shared_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"global_filters" jsonb,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"default_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights_dashboard_widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer,
	"owner_id" integer NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"viz" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_files" ADD CONSTRAINT "crm_files_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_files" ADD CONSTRAINT "crm_files_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_files" ADD CONSTRAINT "crm_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_views" ADD CONSTRAINT "deal_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_field_option" ADD CONSTRAINT "deal_field_option_field_id_deal_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."deal_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_field" ADD CONSTRAINT "deal_field_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_target_team_id_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_target_assignee_id_users_id_fk" FOREIGN KEY ("target_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_last_assigned_user_id_users_id_fk" FOREIGN KEY ("last_assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights_dashboards" ADD CONSTRAINT "insights_dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights_dashboard_widgets" ADD CONSTRAINT "insights_dashboard_widgets_dashboard_id_insights_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."insights_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights_dashboard_widgets" ADD CONSTRAINT "insights_dashboard_widgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prt_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prt_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_single_default_idx" ON "pipelines" USING btree ("is_default") WHERE "pipelines"."is_default";--> statement-breakpoint
CREATE INDEX "stages_pipeline_idx" ON "stages" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "organizations_update_idx" ON "organizations" USING btree ("update_time");--> statement-breakpoint
CREATE INDEX "persons_org_idx" ON "persons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "persons_owner_idx" ON "persons" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "persons_update_idx" ON "persons" USING btree ("update_time");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_pipeline_idx" ON "deals" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deals_owner_idx" ON "deals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deals_org_idx" ON "deals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deals_person_idx" ON "deals" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "deals_add_time_idx" ON "deals" USING btree ("add_time");--> statement-breakpoint
CREATE INDEX "deals_update_idx" ON "deals" USING btree ("update_time");--> statement-breakpoint
CREATE INDEX "deals_won_time_idx" ON "deals" USING btree ("won_time");--> statement-breakpoint
CREATE INDEX "deals_value_idx" ON "deals" USING btree ("value");--> statement-breakpoint
CREATE INDEX "deals_expected_close_idx" ON "deals" USING btree ("expected_close_date");--> statement-breakpoint
CREATE INDEX "activities_deal_add_time_idx" ON "activities" USING btree ("deal_id","add_time");--> statement-breakpoint
CREATE INDEX "activities_person_idx" ON "activities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "activities_org_idx" ON "activities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "activities_owner_idx" ON "activities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "activities_due_idx" ON "activities" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "activities_deal_due_done_idx" ON "activities" USING btree ("deal_id","due_date","done");--> statement-breakpoint
CREATE INDEX "notes_deal_idx" ON "notes" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "notes_person_idx" ON "notes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "notes_org_idx" ON "notes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "note_reactions_note_idx" ON "note_reactions" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscriptions_user_automation_idx" ON "notification_subscriptions" USING btree ("user_id","automation_id");--> statement-breakpoint
CREATE INDEX "notification_subscriptions_automation_idx" ON "notification_subscriptions" USING btree ("automation_id","active");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leads_person_idx" ON "leads" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "files_deal_idx" ON "files" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "files_person_idx" ON "files" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "files_user_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crm_files_deal_idx" ON "crm_files" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "crm_files_note_idx" ON "crm_files" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "deal_views_user_idx" ON "deal_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "change_events_entity_idx" ON "change_events" USING btree ("entity_type","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "change_events_stage_idx" ON "change_events" USING btree ("entity_id","changed_at") WHERE "change_events"."field_key" = 'stage_id';--> statement-breakpoint
CREATE UNIQUE INDEX "change_events_dedupe_idx" ON "change_events" USING btree ("entity_type","entity_id","field_key","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_field_option_uq" ON "deal_field_option" USING btree ("field_id","value");--> statement-breakpoint
CREATE INDEX "deal_field_option_field_idx" ON "deal_field_option" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_field_key_uq" ON "deal_field" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_field_storage_source_uq" ON "deal_field" USING btree ("storage","source_key") WHERE "deal_field"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "deal_field_active_idx" ON "deal_field" USING btree ("active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_entity_name_uq" ON "labels" USING btree ("entity",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "lost_reasons_name_uq" ON "lost_reasons" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "assignment_rules_event_priority_idx" ON "assignment_rules" USING btree ("trigger_event","priority");--> statement-breakpoint
CREATE INDEX "automations_event_priority_idx" ON "automations" USING btree ("trigger_event","priority");--> statement-breakpoint
CREATE INDEX "insights_dashboards_owner_idx" ON "insights_dashboards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "insights_dashboards_default_idx" ON "insights_dashboards" USING btree ("owner_id","default_key");--> statement-breakpoint
CREATE INDEX "insights_dashboards_shared_gin" ON "insights_dashboards" USING gin ("shared_user_ids");--> statement-breakpoint
CREATE INDEX "insights_widgets_dashboard_idx" ON "insights_dashboard_widgets" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "insights_widgets_owner_idx" ON "insights_dashboard_widgets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_idx" ON "rate_limit_counters" USING btree ("window_start");