import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";
import { tenantIdColumn, tenantPolicy } from "./tenants";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  tenantId: tenantIdColumn(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  roleId: integer("role_id"),
  isAdmin: boolean("is_admin").notNull().default(false),
  activeFlag: boolean("active_flag").notNull().default(true),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  timezoneName: text("timezone_name").notNull().default("UTC"),
  created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  teamId: integer("team_id").references(() => teamsTable.id),
}, () => [tenantPolicy()]);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  created: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
