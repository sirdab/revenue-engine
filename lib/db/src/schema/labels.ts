import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Label registry — the admin-curated taxonomy behind the label chips.
//
// Label VALUES stay denormalized as text[] on each entity (deals.labels,
// persons.labels, organizations.labels) so reads never join; this table is the
// control plane that gives each distinct label an identity: a canonical
// spelling, a color, and an order. Registry mutations (rename / delete) are
// responsible for rewriting the denormalized arrays so the two never drift.
// Labels created ad-hoc from a picker simply appear in the arrays; the admin
// page surfaces them as "unregistered" until an admin adopts them here.

// Plain text + CHECK rather than a pg enum (same pattern as
// deal_field.field_type): the entity column participates in an expression
// index, and enum columns break deploy tools that assume text operator
// classes on indexed columns.
export const LABEL_ENTITIES = ["deal", "person", "organization"] as const;
export type LabelEntity = (typeof LABEL_ENTITIES)[number];

// Named palette tokens; the client maps these to its theme. Stored as names
// (not hex) so a design refresh never requires a data migration.
export const LABEL_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const labelsTable = pgTable(
  "labels",
  {
    id: serial("id").primaryKey(),
    entity: text("entity").$type<LabelEntity>().notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("teal"),
    orderIndex: integer("order_index").notNull().default(0),
    addTime: timestamp("add_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One spelling per entity, case-insensitively ("Hot" and "hot" are one label).
    uniqueIndex("labels_entity_name_uq").on(
      table.entity,
      sql`lower(${table.name})`,
    ),
    check(
      "labels_entity_chk",
      sql`${table.entity} in ('deal','person','organization')`,
    ),
  ],
);

export const insertLabelSchema = createInsertSchema(labelsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertLabel = z.infer<typeof insertLabelSchema>;
export type Label = typeof labelsTable.$inferSelect;
