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
import { teamsTable } from "./teams";
import { usersTable } from "./users";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Auto-assignment rules — the routing engine that sets a deal's owner
// automatically (Pipedrive "Automatic Assignment" parity). Each rule matches on
// assignment conditions (the shared deals-filter DSL) and routes to a team
// and/or a specific assignee; a team target with no fixed assignee distributes
// by round-robin across the team's active members.
//
// Rules are grouped by trigger event and evaluated in priority order (lower =
// first); the first matching rule wins per event. Conditions live in a typed
// jsonb column (validated at the API layer via filterGroupSchema), the same
// pattern as deal_field.config — the shape can evolve without a migration.

// Plain text + CHECK rather than a pg enum (same pattern as
// deal_field.field_type / labels.entity): keeps the column a plain text type
// that deploy tools handle without enum operator-class surprises.
export const ASSIGNMENT_TRIGGER_EVENTS = ["deal_added", "deal_updated"] as const;
export type AssignmentTriggerEvent = (typeof ASSIGNMENT_TRIGGER_EVENTS)[number];

export const assignmentRulesTable = pgTable(
  "assignment_rules",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    name: text("name").notNull(),
    triggerEvent: text("trigger_event")
      .$type<AssignmentTriggerEvent>()
      .notNull(),
    // The FilterGroup DSL; validated by filterGroupSchema at the API layer.
    conditions: jsonb("conditions")
      .$type<FilterGroup>()
      .notNull()
      .default(EMPTY_FILTER),
    // Expected-present but nullable; ON DELETE SET NULL so deleting a team (or
    // user) blanks the reference instead of cascade-dropping the rule or
    // blocking the delete with an FK violation. A rule left with no team simply
    // resolves to no owner and falls through in the engine.
    targetTeamId: integer("target_team_id").references(() => teamsTable.id, {
      onDelete: "set null",
    }),
    // null = round-robin across the target team's active members.
    targetAssigneeId: integer("target_assignee_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // "Deal updated" rules only: when true, this rule may REASSIGN a deal
    // that already has an owner (e.g. a handover between teams on a stage
    // move). Default false preserves the original never-overwrite behavior.
    // Reassignment still only happens on a real pipeline/stage change and
    // never when the client set the owner in the same request.
    takeoverOwned: boolean("takeover_owned").notNull().default(false),
    // Round-robin cursor for a team target with no fixed assignee: the last
    // member this rule assigned to. The next pick is the next active member
    // after this one (cyclically) — NOT whoever currently looks "least
    // loaded" by open-deal count, which a rule with takeoverOwned can starve:
    // a member whose deals keep getting reassigned away downstream never
    // accumulates load, so a live least-loaded computation would keep
    // re-picking them forever instead of rotating past them. ON DELETE SET
    // NULL so removing the last-picked user just resets the cursor to the
    // start of the rotation.
    lastAssignedUserId: integer("last_assigned_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Ordering within a trigger event; lower is evaluated first.
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
    // Rules are loaded/ordered per trigger event by priority.
    index("assignment_rules_event_priority_idx").on(
      table.triggerEvent,
      table.priority,
    ),
    check(
      "assignment_rules_trigger_event_chk",
      sql`${table.triggerEvent} in ('deal_added','deal_updated')`,
    ),
  ],
);

export const insertAssignmentRuleSchema = createInsertSchema(
  assignmentRulesTable,
).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertAssignmentRule = z.infer<typeof insertAssignmentRuleSchema>;
export type AssignmentRule = typeof assignmentRulesTable.$inferSelect;
