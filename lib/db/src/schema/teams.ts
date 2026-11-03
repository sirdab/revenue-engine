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

// Teams — an ownership grouping layer above the individual owner.
//
// Hybrid registry: it follows the labels/lost-reasons registry shape
// (id/name/active/order_index + add/update timestamps) AND carries the synced-
// entity columns pipedrive_id/pipedrive_data like users, so a team can be
// admin-created OR imported from Pipedrive. Native teams simply leave
// pipedrive_id null (Postgres allows many nulls under a unique index), so synced
// and native teams coexist.
//
// Deliberately NO lower(name) unique index (a divergence from the other
// registries): the Pipedrive import upserts ON CONFLICT (pipedrive_id), and a
// separate name-uniqueness constraint would abort the batch whenever an imported
// team name collides with a manually-created one — violating "sync must not
// fail". Duplicate display names are tolerable for an ownership grouping.
//
// Membership is one primary team per user (users.team_id). Pipedrive allows a
// user in multiple teams; the full raw membership is preserved in pipedrive_data
// so nothing is lost and a many-to-many join can be introduced later.

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
  pipedriveId: integer("pipedrive_id").unique(),
  pipedriveData: jsonb("pipedrive_data"),
  addTime: timestamp("add_time", { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTeamSchema = createInsertSchema(teamsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;
