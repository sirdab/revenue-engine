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

// In-app notifications. One row per recipient — a note mentioning three users
// produces three rows.
//
// Five writers:
//   • @mentions in notes/activity notes (lib/mentions.ts)
//   • the post_notification automation action, to a rule's SUBSCRIBERS only
//     (lib/notification-subscriptions.ts)
//   • the quote-expiry scanner (lib/quote-expiry-scanner.ts)
//   • the invoice-period scanner (lib/invoice-period-scanner.ts), which also
//     UPDATES the row it wrote on every later scan while its window is open —
//     the only writer that touches an existing notification (see dismissedAt)
//   • notify()'s in-app channel (lib/notifications.ts) — every other event
//     (reminders, overdue, assignment) that reaches a human goes through here
//
// Only the middle three (notification-subscriptions, quote-expiry,
// invoice-period) insert inside a transaction alongside a
// notification_rule_fires claim row, for exactly-once delivery. Mentions is a
// plain non-transactional insert with no claim row, and notify() runs outside
// any transaction, fire-and-forget.
//
// Read by the topbar bell AND the home Notifications card, which share one
// query so both surfaces always agree.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    // Recipient.
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    // Who triggered it (the note author for mentions).
    actorId: integer("actor_id").references(() => usersTable.id),
    type: text("type").notNull(), // "mention" | "automation"
    message: text("message").notNull(),
    // Where to navigate on click: "deal" | "person" | "organization" |
    // "account". "account" and "organization" are DIFFERENT id spaces — an
    // account id is a Sirdab platform org id (routed /accounts/:orgId), an
    // organization id is a local CRM organizations.id (/organization/:id).
    // Conflating them deep-links to an unrelated org with the same number.
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    noteId: integer("note_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * When the recipient explicitly cleared it with the X.
     *
     * SEPARATE FROM readAt on purpose. "Read" is passive — opening the bell
     * fades every row — whereas a time-based notification has to survive that:
     * "an invoice period ends in 30 days" is true for thirty days and must stay
     * on the card until the person says they are done with it. Dismissed rows
     * are excluded from both surfaces and from the unread count; read ones are
     * only styled differently.
     *
     * It is also the stop signal for the sticky refresh — see
     * api-server lib/sticky-notification.ts.
     */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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
