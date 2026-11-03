import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// In-app notifications. One row per recipient — a note mentioning three users
// produces three rows.
//
// Three writers:
//   • @mentions in notes/activity notes (lib/mentions.ts)
//   • the post_notification automation action, to a rule's SUBSCRIBERS only
//     (lib/notification-subscriptions.ts)
//   • notify()'s in-app channel (lib/notifications.ts) — every other event
//     (reminders, overdue, assignment) that reaches a human goes through here
//
// Only the automation action inserts inside a transaction (the caller's
// deal-write transaction), so its rows commit atomically with the change that
// fired the rule. Mentions is a plain non-transactional insert, and notify()
// runs outside any transaction, fire-and-forget.
//
// Read by the topbar bell AND the home Notifications card, which share one
// query so both surfaces always agree.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    // Recipient.
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    // Who triggered it (the note author for mentions).
    actorId: integer("actor_id").references(() => usersTable.id),
    type: text("type").notNull(), // "mention" | "automation"
    message: text("message").notNull(),
    // Where to navigate on click: "deal" | "person" | "organization".
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    noteId: integer("note_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * When the recipient explicitly cleared it with the X.
     *
     * SEPARATE FROM readAt on purpose. "Read" is passive — opening the bell
     * fades every row — whereas a long-lived notification has to survive
     * that: it must stay on the card until the person says they are done with
     * it. Dismissed rows are excluded from both surfaces and from the unread
     * count; read ones are only styled differently.
     */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    tenantPolicy(),
    // The bell reads "my notifications, unread first, newest first" on every
    // poll — keep that off a table scan.
    index("notifications_user_idx").on(table.userId, table.readAt),
  ],
);

export const insertNotificationSchema = createInsertSchema(
  notificationsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
