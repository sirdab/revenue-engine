import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { dealsTable } from "./deals";
import { notesTable } from "./notes";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// CRM file attachments (contracts, proposals, …) for deals.
// Metadata only — the binary lives in S3-compatible object storage
// (Cloudflare R2 in production), keyed by this row's id. Not the dormant
// Pipedrive `files` table — that one is link-only sync metadata with no
// binary.
//
// Attach target is a deal (dealId), optionally a comment attachment on that
// deal (dealId + noteId). Both the deal and note FKs are bare (NO ACTION) like
// notes/activities — a hard deal/note delete must never silently destroy
// attachment metadata before the app-side path in api-server has cleaned up
// the matching R2 blobs; the seed script wipes crm_files first.
// Comment attachments keep dealId set so deal-scoped queries
// and change-event conventions still apply; the deal Documents card filters
// out rows with note_id set.
//
// `category` is plain text validated by a zod enum in the API layer
// (api-server/src/lib/crm-files.ts) so the set can grow without a migration.
// `mime_type` is the server-canonical type from the upload allowlist; the
// client's declared MIME is never stored.

export const crmFilesTable = pgTable(
  "crm_files",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    category: text("category").notNull(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => dealsTable.id),
    // Set only for comment attachments (always alongside dealId). Bare FK — the
    // app-level note-delete path deletes the R2 blobs before the row goes.
    noteId: integer("note_id").references(() => notesTable.id),
    uploadedBy: integer("uploaded_by").references(() => usersTable.id),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    tenantPolicy(),
    index("crm_files_deal_idx").on(table.dealId),
    index("crm_files_note_idx").on(table.noteId),
  ],
);

export const insertCrmFileSchema = createInsertSchema(crmFilesTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertCrmFile = z.infer<typeof insertCrmFileSchema>;
export type CrmFile = typeof crmFilesTable.$inferSelect;
