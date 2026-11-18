import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// Per-tenant application settings (key/value) edited from the admin Settings
// UI, e.g. the inbound-webhook shared secret used by n8n.
export const appSettingsTable = pgTable("app_settings", {
  tenantId: tenantIdColumn(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.key] }),
  tenantPolicy(),
]);

export type AppSetting = typeof appSettingsTable.$inferSelect;
