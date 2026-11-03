import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Key/value watermarks for background sync jobs (e.g. the Pipedrive incremental
// poll stores `pipedrive_last_sync` here). Created/managed outside the app, but
// declared in the schema so drizzle-kit push recognises it and never drops it.
export const syncStateTable = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: timestamp("value", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SyncState = typeof syncStateTable.$inferSelect;
