import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Teams — an ownership grouping layer above the individual owner. Follows the
// labels/lost-reasons registry shape (id/name/active/order_index + add/update
// timestamps). Membership is one primary team per user (users.team_id).

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  tenantId: tenantIdColumn(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
  addTime: timestamp("add_time", { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, () => [tenantPolicy()]);

export const insertTeamSchema = createInsertSchema(teamsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;
