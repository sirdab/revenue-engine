import {
  pgTable,
  pgPolicy,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// A tenant is one customer workspace. Every tenant-scoped table carries a
// `tenant_id` and a row-level-security policy, so isolation is enforced by
// Postgres rather than by remembering a WHERE clause in every query.
//
// How a connection is bound to a tenant (see lib/db/src/tenant-context.ts):
//   • `app.tenant_id`  — set per request on a dedicated pooled connection.
//     Reads and writes only see/accept rows of that tenant, and inserts that
//     omit tenant_id take it from this setting via the column default.
//   • `app.bypass_rls` — set only by `runAsSystem()` for the few code paths
//     that legitimately precede or span tenants: login, sign-up, password
//     reset, and background scanners enumerating tenants.
//
// The policies are FORCEd (migration 0001) so they apply to the table owner
// too; otherwise the app role, which usually owns the tables, would bypass
// them silently.
export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;

/** The tenant bound to the current connection, or NULL when none is. */
export const CURRENT_TENANT_SQL = sql`(nullif(current_setting('app.tenant_id', true), ''))::integer`;

/**
 * The `tenant_id` column every tenant-scoped table declares. Defaults to the
 * connection's tenant, so application inserts never have to pass it.
 */
export const tenantIdColumn = () =>
  integer("tenant_id")
    .notNull()
    .default(CURRENT_TENANT_SQL)
    .references(() => tenantsTable.id, { onDelete: "cascade" });

/** The row-level-security policy every tenant-scoped table declares. */
export const tenantPolicy = () =>
  pgPolicy("tenant_isolation", {
    as: "permissive",
    for: "all",
    using: sql`tenant_id = ${CURRENT_TENANT_SQL} OR current_setting('app.bypass_rls', true) = 'on'`,
    withCheck: sql`tenant_id = ${CURRENT_TENANT_SQL} OR current_setting('app.bypass_rls', true) = 'on'`,
  });
