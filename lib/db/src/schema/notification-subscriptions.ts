import {
  pgTable,
  serial,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { automationsTable } from "./automations";

// Per-user subscriptions to a notification automation.
//
// WHY THIS TABLE EXISTS: `automations` rows are workspace-global and carry no
// recipient. Configuring a recipient on the action itself gives two wrong
// shapes — naming one user makes the rule fire on every record in the workspace
// and dump all of it on that person, and naming "the owner" makes the rule
// team-wide with no opt-out. A subscription row is the thing that makes a rule
// personal: the admin owns the rule's shape, each user owns whether it applies
// to them.
//
// The subscribed row is an AUTOMATION, not an `automation_templates` row.
// Templates are wizard prefills — they have no `active` flag, no priority, and
// the engine never loads them, so subscribing to one would fire nothing.
//
// Subscriptions FOLLOW the automation: if an admin edits the rule, subscribers
// get the new behavior. Snapshotting the shape at subscribe time was the
// alternative and it strands subscribers on stale rules with no way to see it.

export const notificationSubscriptionsTable = pgTable(
  "notification_subscriptions",
  {
    id: serial("id").primaryKey(),
    // The subscriber and the recipient — always the same person. Never taken
    // from a request body; the routes read it off the session.
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Cascade: deleting the rule leaves nothing to subscribe to, and admins
    // delete rules through an existing endpoint that must not start failing on
    // a foreign-key violation.
    automationId: integer("automation_id")
      .notNull()
      .references(() => automationsTable.id, { onDelete: "cascade" }),
    // Off without losing the row (and the user's tuning below).
    active: boolean("active").notNull().default(true),
    // Per-user tuning of a shared rule — one person wants 30 days, another 14.
    // Shape is declared by the automation's action config and validated at the
    // API layer; jsonb carries no constraints of its own, so the engine
    // re-checks at run time (the same typed-jsonb pattern as
    // automations.action_config).
    params: jsonb("params").$type<Record<string, unknown>>(),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One subscription per person per rule. Subscribing twice is a no-op
    // upsert at the API layer rather than a 500 out of this index.
    uniqueIndex("notification_subscriptions_user_automation_idx").on(
      table.userId,
      table.automationId,
    ),
    // The engine's read is "who is subscribed to THIS automation" on every
    // matching write, so keep that off a table scan.
    index("notification_subscriptions_automation_idx").on(
      table.automationId,
      table.active,
    ),
  ],
);

export const insertNotificationSubscriptionSchema = createInsertSchema(
  notificationSubscriptionsTable,
).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertNotificationSubscription = z.infer<
  typeof insertNotificationSubscriptionSchema
>;
export type NotificationSubscription =
  typeof notificationSubscriptionsTable.$inferSelect;
