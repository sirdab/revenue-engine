import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Portal-managed application settings (key/value). Distinct from `sync_state`,
// whose `value` column is a timestamp — this holds string settings edited from
// the admin Settings UI, e.g. the inbound-webhook shared secret used by n8n.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
