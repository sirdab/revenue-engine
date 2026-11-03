import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  address: text("address"),
  ownerId: integer("owner_id").references(() => usersTable.id),
  // Denormalized label names; curated by the label registry (schema/labels.ts).
  labels: text("labels").array(),
  addTime: timestamp("add_time", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  pipedriveId: integer("pipedrive_id").unique(),
  pipedriveData: jsonb("pipedrive_data"),
}, (table) => [
  index("organizations_owner_idx").on(table.ownerId),
  index("organizations_update_idx").on(table.updateTime),
]);

export const insertOrganizationSchema = createInsertSchema(
  organizationsTable,
).omit({ id: true, addTime: true, updateTime: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;
