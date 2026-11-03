import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  pgEnum,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personsTable } from "./persons";
import { organizationsTable } from "./organizations";
import { dealsTable } from "./deals";

// How a completed activity went: "successful" (they replied, or the work was
// ticked done) or "no_reply" (a call nobody picked up). Null means no outcome
// was recorded.
export const ACTIVITY_OUTCOMES = ["successful", "no_reply"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const activityTypeEnum = pgEnum("activity_type", [
  "call",
  "meeting",
  "email",
  "task",
  "deadline",
  "whatsapp",
]);

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  type: activityTypeEnum("type").notNull().default("task"),
  note: text("note"),
  done: boolean("done").notNull().default(false),
  busy: boolean("busy").notNull().default(false),
  dueDate: date("due_date", { mode: "string" }),
  dueTime: text("due_time"),
  duration: text("duration"),
  markedAsDoneTime: timestamp("marked_as_done_time", { withTimezone: true }),
  // Only the "No reply" action writes "no_reply", ticking done writes
  // "successful", and null on a done row predates outcomes (not counted).
  outcome: text("outcome").$type<ActivityOutcome>(),
  dealId: integer("deal_id").references(() => dealsTable.id),
  personId: integer("person_id").references(() => personsTable.id),
  orgId: integer("org_id").references(() => organizationsTable.id),
  ownerId: integer("owner_id").references(() => usersTable.id),
  creatorUserId: integer("creator_user_id").references(() => usersTable.id),
  draft: boolean("draft").notNull().default(false),
  addTime: timestamp("add_time", { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  leadId: integer("lead_id"),
  pipedriveId: integer("pipedrive_id").unique(),
  pipedriveData: jsonb("pipedrive_data"),
}, (table) => [
  index("activities_deal_add_time_idx").on(table.dealId, table.addTime),
  index("activities_person_idx").on(table.personId),
  index("activities_org_idx").on(table.orgId),
  index("activities_owner_idx").on(table.ownerId),
  index("activities_due_idx").on(table.dueDate),
  // Speeds the per-deal "next open activity due date" correlated subquery in
  // dealQuery: min(due_date) where deal_id = ? and open/non-draft.
  index("activities_deal_due_done_idx").on(table.dealId, table.dueDate, table.done),
  check(
    "activities_outcome_chk",
    sql`${table.outcome} in ('successful','no_reply')`,
  ),
]);

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
