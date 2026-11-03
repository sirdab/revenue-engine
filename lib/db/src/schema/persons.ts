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
import { organizationsTable } from "./organizations";

export const personsTable = pgTable("persons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  // Free text, optional: who this contact is at their company ("Operations
  // Manager", "CFO"), so a POC is more than a name and a number.
  jobTitle: text("job_title"),
  organizationId: integer("organization_id").references(
    () => organizationsTable.id,
  ),
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
  index("persons_org_idx").on(table.organizationId),
  index("persons_owner_idx").on(table.ownerId),
  index("persons_update_idx").on(table.updateTime),
]);

export const insertPersonSchema = createInsertSchema(personsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof personsTable.$inferSelect;
