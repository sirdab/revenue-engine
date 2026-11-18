import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Per-user saved view: a named snapshot of filter + sort + visible columns for
// the Deals workspace. The shape of `definition` is validated at the API layer.
export const dealViewsTable = pgTable(
  "deal_views",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
    updated: timestamp("updated", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    tenantPolicy(),index("deal_views_user_idx").on(table.userId)],
);

export const insertDealViewSchema = createInsertSchema(dealViewsTable).omit({
  id: true,
  created: true,
  updated: true,
});
export type InsertDealView = z.infer<typeof insertDealViewSchema>;
export type DealView = typeof dealViewsTable.$inferSelect;
