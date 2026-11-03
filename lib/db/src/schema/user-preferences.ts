import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Per-user default/working-state preferences (sidebar collapsed, table column
// layout, filter panel state, view modes, deals default view, etc.) as a single
// namespaced JSON document, deep-merged on PATCH. Distinct from `deal_views`,
// which stores named reusable saved views rather than a user's current defaults.
export const userPreferencesTable = pgTable("user_preferences", {
  tenantId: tenantIdColumn(),
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").notNull().default({}),
  // Bumped only by a reset (never by an ordinary PATCH) so a client can tell
  // "the document changed because someone edited a field" (fine, deep-merge
  // handles that) apart from "the document changed because someone reset it
  // out from under me" (not fine — a PATCH computed before the reset must
  // not be allowed to silently resurrect old data on top of the wipe). See
  // updateUserPreferences's resetEpoch check in lib/user-preferences.ts.
  resetEpoch: integer("reset_epoch").notNull().default(0),
  created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  updated: timestamp("updated", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, () => [tenantPolicy()]);

export const insertUserPreferencesSchema = createInsertSchema(
  userPreferencesTable,
).omit({
  created: true,
  updated: true,
});
export type InsertUserPreferences = z.infer<
  typeof insertUserPreferencesSchema
>;
export type UserPreferencesRow = typeof userPreferencesTable.$inferSelect;
