import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { notesTable } from "./notes";

// Emoji reactions on posted comments (standalone notes). One row per
// (note, user, emoji) — the unique constraint makes add idempotent
// (`onConflictDoNothing`) and lets a double-click never create a duplicate.
//
// The note FK is ON DELETE CASCADE: reactions have no life of their own, so
// when a comment is deleted the DB reaps its reactions for free (unlike
// crm_files, whose blobs need app-side cleanup — see crm-files.ts). The user
// FK is bare NO ACTION like the rest of the CRM.
//
// `emoji` stores a unicode character validated server-side against a curated
// constant set; the column must never hold arbitrary client text.
export const noteReactionsTable = pgTable(
  "note_reactions",
  {
    id: serial("id").primaryKey(),
    noteId: integer("note_id")
      .notNull()
      .references(() => notesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    emoji: text("emoji").notNull(),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Reactions are fetched batched per deal, keyed by note.
    index("note_reactions_note_idx").on(table.noteId),
    unique("note_reactions_note_user_emoji_uq").on(
      table.noteId,
      table.userId,
      table.emoji,
    ),
  ],
);

export const insertNoteReactionSchema = createInsertSchema(
  noteReactionsTable,
).omit({
  id: true,
  addTime: true,
});
export type InsertNoteReaction = z.infer<typeof insertNoteReactionSchema>;
export type NoteReaction = typeof noteReactionsTable.$inferSelect;
