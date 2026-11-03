import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Insights (self-serve analytics) storage. Dashboards are per-user documents:
// default boards are lazy-seeded copies per user (tracked via defaultKey), so
// editing one never affects other users. Widget query specs are versioned
// JSONB (`spec.version`) and migrated on read, never in bulk.

export const insightsDashboardsTable = pgTable(
  "insights_dashboards",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Optional grouping header in the dashboard switcher (e.g. "Reviews").
    section: text("section"),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    isShared: boolean("is_shared").notNull().default(false),
    // User ids with view-only access when isShared is true.
    sharedUserIds: jsonb("shared_user_ids").$type<number[]>().notNull().default([]),
    // Board-level filter state (same encoded shape the URL carries); applied
    // server-side as board ∩ widget, so it narrows but never widens.
    globalFilters: jsonb("global_filters"),
    // react-grid-layout style items: [{ i: widgetId, x, y, w, h }, ...] —
    // library-agnostic contract, keyed by widget id.
    layout: jsonb("layout").notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    // daily | weekly | monthly for seeded defaults; null for user-created
    // boards. Reset-to-default re-seeds the board with this key.
    defaultKey: text("default_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("insights_dashboards_owner_idx").on(table.ownerId),
    index("insights_dashboards_default_idx").on(table.ownerId, table.defaultKey),
    // Every dashboard list runs `shared_user_ids @> [userId]` — GIN serves
    // the jsonb containment probe instead of a full-table scan.
    index("insights_dashboards_shared_gin").using("gin", table.sharedUserIds),
  ],
);

export const insightsWidgetsTable = pgTable(
  "insights_dashboard_widgets",
  {
    id: serial("id").primaryKey(),
    // Null = library-only widget (saved without a dashboard placement).
    dashboardId: integer("dashboard_id").references(
      () => insightsDashboardsTable.id,
      { onDelete: "cascade" },
    ),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Versioned widget query spec (@workspace/insights-spec), validated at the
    // API layer against the generated Zod schema before persisting.
    spec: jsonb("spec").notNull(),
    // { type: "bar" | "line" | ... , options: {...} } — presentation only.
    viz: jsonb("viz").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("insights_widgets_dashboard_idx").on(table.dashboardId),
    index("insights_widgets_owner_idx").on(table.ownerId),
  ],
);

export const insertInsightsDashboardSchema = createInsertSchema(
  insightsDashboardsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInsightsDashboard = z.infer<typeof insertInsightsDashboardSchema>;
export type InsightsDashboard = typeof insightsDashboardsTable.$inferSelect;

export const insertInsightsWidgetSchema = createInsertSchema(
  insightsWidgetsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInsightsWidget = z.infer<typeof insertInsightsWidgetSchema>;
export type InsightsWidget = typeof insightsWidgetsTable.$inferSelect;
