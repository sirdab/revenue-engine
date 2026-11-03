import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personsTable } from "./persons";
import { organizationsTable } from "./organizations";

// Pipedrive Leads (pre-deals). The Pipedrive lead id is a UUID, hence text.
export const leadsTable = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull().default(""),
    value: doublePrecision("value"),
    currency: text("currency"),
    ownerId: integer("owner_id").references(() => usersTable.id),
    personId: integer("person_id").references(() => personsTable.id),
    organizationId: integer("organization_id").references(
      () => organizationsTable.id,
    ),
    sourceName: text("source_name"),
    labels: text("labels"),
    expectedCloseDate: date("expected_close_date", { mode: "string" }),
    archiveTime: timestamp("archive_time", { withTimezone: true }),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    pipedriveId: text("pipedrive_id").unique(),
    pipedriveData: jsonb("pipedrive_data"),
  },
  (table) => [
    index("leads_org_idx").on(table.organizationId),
    index("leads_person_idx").on(table.personId),
  ],
);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
