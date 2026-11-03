import { and, eq, ne, sql } from "drizzle-orm";
import { pipelinesTable, stagesTable, dealsTable } from "@workspace/db";
import type { Tx } from "./change-events";

// Helpers for admin pipeline/stage management. The Pipedrive sync assigns
// pipeline/stage ids as PIPE_OFFSET + pipedriveId, so admin-created rows must
// live below PIPE_OFFSET to avoid ever colliding with an import.

const PIPE_OFFSET = 100000;

// Distinct advisory-lock keys so concurrent admin creates serialize per table
// (auto-released at txn commit/rollback). Imports use their own id range and
// never contend.
export const PIPELINE_LOCK_KEY = 918_273_401;
export const STAGE_LOCK_KEY = 918_273_402;

export async function lockForCreate(tx: Tx, key: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
}

/** Next free id in the admin range [1, PIPE_OFFSET). Call under the advisory lock. */
export async function nextLocalId(
  tx: Tx,
  table: "pipelines" | "stages",
): Promise<number> {
  const t = table === "pipelines" ? pipelinesTable : stagesTable;
  const res = await tx.execute<{ next: number }>(
    sql`select coalesce(max(id) filter (where id < ${PIPE_OFFSET}), 0) + 1 as next from ${t}`,
  );
  return Number(res.rows[0]?.next ?? 1);
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
