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
import { personsTable } from "./persons";
import { organizationsTable } from "./organizations";
import { dealsTable } from "./deals";

// Pipedrive Files (attachments) — metadata + download URL. The file binaries
// stay in Pipedrive; we keep the link and the relationships.
export const filesTable = pgTable("files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name"),
  fileType: text("file_type"),
  downloadUrl: text("download_url"),
  description: text("description"),
  dealId: integer("deal_id").references(() => dealsTable.id),
  personId: integer("person_id").references(() => personsTable.id),
  orgId: integer("org_id").references(() => organizationsTable.id),
  leadId: integer("lead_id"),
  userId: integer("user_id").references(() => usersTable.id),
  addTime: timestamp("add_time", { withTimezone: true }),
  updateTime: timestamp("update_time", { withTimezone: true }),
  pipedriveId: integer("pipedrive_id").unique(),
  pipedriveData: jsonb("pipedrive_data"),
}, (table) => [
  // The sync scans files by their owning entity (FK); without these the table
  // (~40k rows) was full-scanned every run.
  index("files_deal_idx").on(table.dealId),
  index("files_person_idx").on(table.personId),
  index("files_org_idx").on(table.orgId),
  index("files_user_idx").on(table.userId),
]);

export const insertFileSchema = createInsertSchema(filesTable).omit({
  id: true,
});
export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof filesTable.$inferSelect;
