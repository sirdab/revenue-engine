import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { tenantIdColumn, tenantPolicy } from "./tenants";

// The control plane for deal fields. A single registry describes every field
// shown on a deal and — critically — WHERE its value lives, so the same UI can
// surface brand-new user fields and "decode" keys already sitting in
// deals.custom_fields without moving the data.

// Where a field's value is stored:
//   custom — user-created, lives in deals.custom_fields keyed by `key` (hash slug)
//   data   — discovered Pipedrive-decoded key, also in deals.custom_fields keyed
//            by its human name (`source_key`); sync-owned
//   column — a native deals column (e.g. labels), keyed by `source_key`
export const dealFieldStorageEnum = pgEnum("deal_field_storage", [
  "custom",
  "data",
  "column",
]);

// The field types we support. Matches the renderer's editors. `field_type` is
// immutable after creation (enforced in the service layer).
export const DEAL_FIELD_TYPES = [
  "varchar",
  "text",
  "double",
  "monetary",
  "date",
  "daterange",
  "boolean",
  "enum",
  "set",
] as const;
export type DealFieldType = (typeof DEAL_FIELD_TYPES)[number];

// Per-field behaviour flags (all optional; default {}). Kept in jsonb so new
// flags don't need a migration.
export interface DealFieldConfig {
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  searchable?: boolean;
  detailVisible?: boolean;
  group?: string;
  description?: string;
  /** Pipelines this field belongs to. Absent or empty = every pipeline. A
   *  field outside a deal's pipeline is hidden on that deal while empty (a
   *  filled value still shows, so moving a deal between pipelines never
   *  hides data). */
  pipelineIds?: number[];
}

export const dealFieldsTable = pgTable(
  "deal_field",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    // Immutable public slug / API key. For `custom` fields this is also the
    // custom_fields json key; for `data`/`column` see `source_key`.
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    storage: dealFieldStorageEnum("storage").notNull().default("custom"),
    // The json key (custom/data) or column name (column) the value lives at.
    sourceKey: text("source_key"),
    editable: boolean("editable").notNull().default(true),
    active: boolean("active").notNull().default(true),
    // true = discovered/built-in (not user-created); discovered fields land
    // inactive so an admin reviews/labels them before they show on deals.
    system: boolean("system").notNull().default(false),
    config: jsonb("config").$type<DealFieldConfig>().notNull().default({}),
    orderIndex: integer("order_index").notNull().default(0),
    createdBy: integer("created_by").references(() => usersTable.id),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    tenantPolicy(),
    uniqueIndex("deal_field_key_uq").on(table.tenantId, table.key),
    // A value lives at exactly one place.
    uniqueIndex("deal_field_storage_source_uq")
      .on(table.tenantId, table.storage, table.sourceKey)
      .where(sql`${table.sourceKey} is not null`),
    index("deal_field_active_idx").on(table.active, table.orderIndex),
    check(
      "deal_field_type_chk",
      sql`${table.fieldType} in ('varchar','text','double','monetary','date','daterange','boolean','enum','set')`,
    ),
  ],
);

// enum/set options. `value` is the decoded LABEL (custom_fields stores labels,
// not option ids). Soft-deleted (active=false) but never hard-removed so an
// existing deal value never dangles.
export const dealFieldOptionsTable = pgTable(
  "deal_field_option",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    fieldId: integer("field_id")
      .notNull()
      .references(() => dealFieldsTable.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    label: text("label").notNull(),
    color: text("color"),
    orderIndex: integer("order_index").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    tenantPolicy(),
    uniqueIndex("deal_field_option_uq").on(table.fieldId, table.value),
    index("deal_field_option_field_idx").on(table.fieldId),
  ],
);

export const insertDealFieldSchema = createInsertSchema(dealFieldsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertDealField = z.infer<typeof insertDealFieldSchema>;
export type DealField = typeof dealFieldsTable.$inferSelect;

export const insertDealFieldOptionSchema = createInsertSchema(
  dealFieldOptionsTable,
).omit({ id: true });
export type InsertDealFieldOption = z.infer<typeof insertDealFieldOptionSchema>;
export type DealFieldOption = typeof dealFieldOptionsTable.$inferSelect;
