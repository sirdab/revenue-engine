import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { EMPTY_FILTER, type FilterGroup } from "@workspace/deals-filter";
import { activityTypeEnum } from "./activities";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Deal automations — "when X happens → do Y" (Pipedrive workflow-automation
// parity, small edition). Each automation matches a trigger event, filters with
// the shared deals-filter DSL, and executes one action. Unlike assignment rules
// (first match wins — a deal has one owner), ALL matching automations run, in
// priority order. The engine (api-server src/lib/automations.ts) runs inline in
// the deal-write transaction; chaining is capped at one level there.

// Plain text + CHECK rather than a pg enum (same pattern as
// assignment_rules.trigger_event): keeps the column a plain text type that
// deploy tools handle without enum operator-class surprises.
export const AUTOMATION_TRIGGER_EVENTS = [
  "deal_added",
  "deal_updated",
] as const;
export type AutomationTriggerEvent = (typeof AUTOMATION_TRIGGER_EVENTS)[number];

export const AUTOMATION_ACTION_TYPES = [
  "create_activity",
  "create_deal",
  "call_webhook",
  "send_slack_message",
  // Posts an in-app notification to the rule's SUBSCRIBERS (see
  // schema/notification-subscriptions.ts). Unlike every other action, this one
  // has no effect until someone subscribes — a rule with no subscribers is
  // inert by design, which is what makes it safe for an admin to author one
  // without notifying the whole team.
  "post_notification",
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

// Who receives a created activity.
export type AutomationAssignee =
  | { kind: "deal_owner" }
  | { kind: "user"; userId: number };

// Who owns a created deal. "auto" inserts ownerless and lets the deal_added
// assignment rules decide, exactly like a normal ownerless deal creation.
export type AutomationDealOwner = AutomationAssignee | { kind: "auto" };

export interface CreateActivityConfig {
  subject: string;
  activityType: (typeof activityTypeEnum.enumValues)[number];
  /** Days after the trigger the activity is due; 0 = same day. */
  dueInDays: number;
  assignee: AutomationAssignee;
}

export interface CreateDealConfig {
  pipelineId: number;
  /** null = first live stage of the pipeline (by orderIndex, id). */
  stageId: number | null;
  /** null/empty = copy the source deal's title; "{title}" interpolates it. */
  titleTemplate: string | null;
  owner: AutomationDealOwner;
}

export interface CallWebhookConfig {
  /** Outbound target; https:// only (validated at the API layer). */
  url: string;
  method: "POST" | "PUT";
  /** When true, the full deal row is included in the JSON payload. */
  includeDeal: boolean;
  /**
   * Header name to send the configured integration webhook secret under
   * (e.g. "X-Webhook-Secret"). null = send no auth header.
   */
  secretHeaderName: string | null;
}

// Where a Slack message goes. `channel` posts to a public/private channel
// (bot token required for arbitrary channels; the webhook's fixed channel is
// used when channel is blank + only a webhook is configured). `deal_owner`
// DMs the triggering deal's owner; `user` DMs a specific CRM user — both
// resolve the person's Slack id from their email at send time (bot token).
export type SlackDestination =
  | { kind: "channel"; channel: string }
  | { kind: "deal_owner" }
  | { kind: "user"; userId: number };

export interface SendSlackMessageConfig {
  destination: SlackDestination;
  /**
   * The message body. Supports {{deal.*}} placeholders interpolated at run
   * time (e.g. "🎉 {{deal.title}} won — {{deal.value}} {{deal.currency}}").
   */
  message: string;
}

// Which of a subscriber's own tuning knobs a notification rule exposes. Kept as
// a closed list rather than free-form jsonb keys so the API layer can validate a
// subscriber's `params` against the rule that owns them, and so the settings UI
// knows what control to render. `days` is the only knob today; it is the one two
// people immediately disagree about ("remind me 30 days out" vs "14").
export const NOTIFICATION_PARAM_KEYS = ["days"] as const;
export type NotificationParamKey = (typeof NOTIFICATION_PARAM_KEYS)[number];

export interface PostNotificationConfig {
  /**
   * The notification body. Supports the same {{deal.*}}
   * placeholders as the Slack action, interpolated at run time.
   */
  message: string;
  /**
   * Knobs a subscriber may override on their own copy. Empty/absent = the rule
   * is not tunable and every subscriber gets it identically.
   */
  tunable?: NotificationParamKey[];
  // In-app is the only channel. Email/Slack for a rule fire would have to be
  // collected and fired AFTER commit (notify() is network-bound and must never
  // hold a deal write open — see AutomationCtx's existing collectors), which
  // means threading a third collector through every call site. Deliberately
  // deferred: nothing asked for it, and the Slack action already covers the
  // "tell a channel" case.
}

export type AutomationActionConfig =
  | CreateActivityConfig
  | CreateDealConfig
  | CallWebhookConfig
  | SendSlackMessageConfig
  | PostNotificationConfig;

export const automationsTable = pgTable(
  "automations",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    name: text("name").notNull(),
    triggerEvent: text("trigger_event")
      .$type<AutomationTriggerEvent>()
      .notNull(),
    // The FilterGroup DSL; validated by filterGroupSchema at the API layer.
    conditions: jsonb("conditions")
      .$type<FilterGroup>()
      .notNull()
      .default(EMPTY_FILTER),
    actionType: text("action_type").$type<AutomationActionType>().notNull(),
    // Discriminated by action_type; strictly validated by the service at write
    // time and re-checked by the engine at run time (jsonb carries no FKs) —
    // the same typed-jsonb pattern as assignment_rules.conditions.
    actionConfig: jsonb("action_config")
      .$type<AutomationActionConfig>()
      .notNull(),
    // Execution order within a trigger event; lower runs first.
    priority: integer("priority").notNull().default(0),
    active: boolean("active").notNull().default(true),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    tenantPolicy(),
    // Automations are loaded/ordered per trigger event by priority.
    index("automations_event_priority_idx").on(
      table.triggerEvent,
      table.priority,
    ),
    check(
      "automations_trigger_event_chk",
      sql`${table.triggerEvent} in ('deal_added','deal_updated')`,
    ),
    check(
      "automations_action_type_chk",
      sql`${table.actionType} in ('create_activity','create_deal','call_webhook','send_slack_message','post_notification')`,
    ),
  ],
);

export const insertAutomationSchema = createInsertSchema(
  automationsTable,
).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertAutomation = z.infer<typeof insertAutomationSchema>;
export type Automation = typeof automationsTable.$inferSelect;
