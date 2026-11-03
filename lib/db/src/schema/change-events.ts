import {
  pgTable,
  bigserial,
  bigint,
  integer,
  text,
  jsonb,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// The kinds of entity whose history we track. Deals are the primary use today;
// the others exist so the log is generic and reusable.
export const changeEntityTypeEnum = pgEnum("change_entity_type", [
  "deal",
  "person",
  "organization",
  "activity",
  "pipeline",
  "stage",
  "note",
  "label",
  // CS accounts (entity_id = the Sirdab platform org id): stage and account
  // manager changes are audited here.
  "account",
  // Partners (entity_id = the Sirdab platform org id): partner-manager and
  // archive changes are audited here.
  "partner",
  // CS account activities (entity_id = account_activities.id): reschedules and
  // other edits are audited here.
  "account_activity",
  // WhatsApp sessions (entity_id = wa_sessions.id): any signed-in user can
  // unpair the support number, so pairing and unpairing are audited here so it
  // stays traceable who disconnected it.
  "whatsapp_session",
]);

// Where a change originated. Used to distinguish human edits from imports and
// system automation in the timeline and in analytics.
export const changeSourceEnum = pgEnum("change_source", [
  "ui",
  "import",
  "api",
  "automation",
]);

// A snapshot of a single field value at the moment of a change. We store BOTH a
// raw id and a human label so renamed/deleted stages, owners, etc. still render
// correctly in historical timelines.
export interface ChangeValueSnapshot {
  id?: number | string | null;
  label?: string | null;
}

// Append-only audit log. Rows are NEVER updated or deleted: the entity tables
// hold current state, this log holds the full history. `changed_by` has no
// cascade so deleting a user can never erase who made a change.
export const changeEventsTable = pgTable(
  "change_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityType: changeEntityTypeEnum("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    fieldKey: text("field_key").notNull(),
    oldValue: jsonb("old_value").$type<ChangeValueSnapshot | null>(),
    newValue: jsonb("new_value").$type<ChangeValueSnapshot | null>(),
    changedBy: integer("changed_by").references(() => usersTable.id),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: changeSourceEnum("source").notNull().default("ui"),
  },
  (table) => [
    // Primary access path: a single entity's history in chronological order.
    index("change_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.changedAt,
    ),
    // Partial index to make funnel / stage-movement queries cheap.
    index("change_events_stage_idx")
      .on(table.entityId, table.changedAt)
      .where(sql`${table.fieldKey} = 'stage_id'`),
    // Idempotency guard for import backfill: re-running an import cannot create
    // duplicate events for the same entity/field/timestamp.
    uniqueIndex("change_events_dedupe_idx").on(
      table.entityType,
      table.entityId,
      table.fieldKey,
      table.changedAt,
    ),
  ],
);

export const insertChangeEventSchema = createInsertSchema(changeEventsTable).omit(
  {
    id: true,
  },
);
export type InsertChangeEvent = z.infer<typeof insertChangeEventSchema>;
export type ChangeEvent = typeof changeEventsTable.$inferSelect;
