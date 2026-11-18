import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personsTable } from "./persons";
import { organizationsTable } from "./organizations";
import { dealsTable } from "./deals";
import { tenantIdColumn, tenantPolicy } from "./tenants";

export const notesTable = pgTable("notes", {
  id: serial("id").primaryKey(),
  tenantId: tenantIdColumn(),
  content: text("content").notNull(),
  dealId: integer("deal_id").references(() => dealsTable.id),
  personId: integer("person_id").references(() => personsTable.id),
  orgId: integer("org_id").references(() => organizationsTable.id),
  userId: integer("user_id").references(() => usersTable.id),
  pinnedToDealFlag: boolean("pinned_to_deal_flag").notNull().default(false),
  pinnedToPersonFlag: boolean("pinned_to_person_flag").notNull().default(false),
  pinnedToOrganizationFlag: boolean("pinned_to_organization_flag")
    .notNull()
    .default(false),
  activeFlag: boolean("active_flag").notNull().default(true),
  draft: boolean("draft").notNull().default(false),
  addTime: timestamp("add_time", { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  leadId: integer("lead_id"),
  pinnedToLeadFlag: boolean("pinned_to_lead_flag").notNull().default(false),
}, (table) => [
    tenantPolicy(),
  // Detail views list notes by their owning entity; without these the table
  // (~18k rows) was full-scanned on every deal/contact/org open.
  index("notes_deal_idx").on(table.dealId),
  index("notes_person_idx").on(table.personId),
  index("notes_org_idx").on(table.orgId),
]);

export const insertNoteSchema = createInsertSchema(notesTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notesTable.$inferSelect;
