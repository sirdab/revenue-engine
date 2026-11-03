import { and, eq, ne, sql } from "drizzle-orm";
import { pipelinesTable, stagesTable, dealsTable } from "@workspace/db";
import type { Tx } from "./change-events";

// Helpers for admin pipeline/stage management. Ids are serial; the advisory
// lock only serializes the order_index / first-pipeline-is-default reads that
// precede an insert.

// Distinct advisory-lock keys so concurrent admin creates serialize per table
// (auto-released at txn commit/rollback).
export const PIPELINE_LOCK_KEY = 918_273_401;
export const STAGE_LOCK_KEY = 918_273_402;

export async function lockForCreate(tx: Tx, key: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
}

export async function pipelineActiveDealCount(
  tx: Tx,
  pipelineId: number,
): Promise<number> {
  const [row] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(dealsTable)
    .where(
      and(eq(dealsTable.pipelineId, pipelineId), ne(dealsTable.status, "deleted")),
    );
  return row?.c ?? 0;
}

export async function stageActiveDealCount(
  tx: Tx,
  stageId: number,
): Promise<number> {
  const [row] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(dealsTable)
    .where(and(eq(dealsTable.stageId, stageId), ne(dealsTable.status, "deleted")));
  return row?.c ?? 0;
}

// Typed error so routes can map to the right HTTP status.
export class PipelineAdminError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
