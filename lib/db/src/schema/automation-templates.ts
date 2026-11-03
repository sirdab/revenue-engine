import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import type { FilterGroup } from "@workspace/deals-filter";
import type {
  AutomationActionConfig,
  AutomationActionType,
  AutomationTriggerEvent,
} from "./automations";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Saved automation templates — a shared, org-wide gallery. Anyone can save an
// automation's current setup as a reusable starting point; every Rev Engine
// user then sees it in the "New automation" gallery and can start from it in
// one click. The built-in starter templates live in the frontend (bilingual,
// non-deletable); this table holds only the user-saved ones.
//
// It mirrors the automations table's typed-jsonb shape (conditions +
// action_config) so a template prefills the wizard with no translation.

export const automationTemplatesTable = pgTable("automation_templates", {
  id: serial("id").primaryKey(),
  tenantId: tenantIdColumn(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // A single emoji shown on the gallery card; null renders a neutral default.
  emoji: text("emoji"),
  triggerEvent: text("trigger_event")
    .$type<AutomationTriggerEvent>()
    .notNull(),
  conditions: jsonb("conditions").$type<FilterGroup>().notNull(),
  actionType: text("action_type").$type<AutomationActionType>().notNull(),
  actionConfig: jsonb("action_config")
    .$type<AutomationActionConfig>()
    .notNull(),
  // Who saved it (for a "saved by" line); set null if that user is deleted,
  // so a template outlives its author.
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  addTime: timestamp("add_time", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
}, () => [tenantPolicy()]);

export type AutomationTemplate = typeof automationTemplatesTable.$inferSelect;
