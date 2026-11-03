import {
  pgTable,
  integer,
  serial,
  text,
  jsonb,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantIdColumn, tenantPolicy } from "./tenants";

export const pipelinesTable = pgTable(
  "pipelines",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    name: text("name").notNull(),
    // Exactly one pipeline is the default (used for new deals / board / funnel).
    isDefault: boolean("is_default").notNull().default(false),
    // Soft-hide without deleting; excluded from pickers + the board.
    archived: boolean("archived").notNull().default(false),
    orderIndex: integer("order_index").notNull().default(0),
    // Deal field keys (from the deal_field registry) that must be filled
    // before a deal in this pipeline can be marked as won.
    wonRequiredFields: text("won_required_fields")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Only an admin may change a deal's owner while it sits in (or is moved
    // into or out of) this pipeline. Everywhere else any user may reassign. Moving a deal between pipelines
    // stays open to everyone, and assignment rules still assign.
    adminOnlyReassign: boolean("admin_only_reassign").notNull().default(false),
  },
  (table) => [
    tenantPolicy(),
    // At most one default pipeline (partial unique on the true value).
    uniqueIndex("pipelines_single_default_idx")
      .on(table.tenantId, table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);

export const insertPipelineSchema = createInsertSchema(pipelinesTable);
export type InsertPipeline = z.infer<typeof insertPipelineSchema>;
export type Pipeline = typeof pipelinesTable.$inferSelect;
