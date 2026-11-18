import {
  pgTable,
  integer,
  serial,
  text,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pipelinesTable } from "./pipelines";
import { tenantIdColumn, tenantPolicy } from "./tenants";

export const stagesTable = pgTable(
  "stages",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantIdColumn(),
    name: text("name").notNull(),
    pipelineId: integer("pipeline_id")
      .notNull()
      .references(() => pipelinesTable.id),
    orderIndex: integer("order_index").notNull().default(0),
    // Win probability for this stage (0-100); used to weight forecast value.
    // Defaults to 100 so forecast equals raw value until probabilities are set.
    probability: integer("probability").notNull().default(100),
    // Idle threshold in days before an open deal in this stage is "rotting".
    // Null means deals in this stage never rot.
    rottingDays: integer("rotting_days"),
    // Soft-hide without deleting; excluded from pickers, board, and funnel.
    archived: boolean("archived").notNull().default(false),
    // Deal field keys (native columns or custom-field keys from the deal_field
    // registry) that should be filled when a deal is in this stage.
    requiredFields: text("required_fields")
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (table) => [
    tenantPolicy(),index("stages_pipeline_idx").on(table.pipelineId)],
);

export const insertStageSchema = createInsertSchema(stagesTable);
export type InsertStage = z.infer<typeof insertStageSchema>;
export type Stage = typeof stagesTable.$inferSelect;
