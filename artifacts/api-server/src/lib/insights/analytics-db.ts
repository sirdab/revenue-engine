import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../logger";

// Analytics queries must not be able to pin a pool connection indefinitely;
// the timeout is scoped to the transaction, so it never affects other traffic.
// Every insights report runs through here — one place owns the ceiling.
const STATEMENT_TIMEOUT_MS = 15_000;

// Bounded concurrency: the statement timeout stops a *runaway* query, but
// nothing else stops N concurrent legitimate scans from pinning the whole pg
// pool and starving transactional CRM traffic. Analytics gets a fixed slice
// of the pool; excess queries wait in line, and a line that grows past
// MAX_QUEUE fails fast (503 at the route) instead of stacking up until every
// client has long timed out.
const MAX_CONCURRENT = 5;
const MAX_QUEUE = 200;

/** Queue overflow — the route layer maps this to 503, not 400/500. */
export class AnalyticsBusyError extends Error {
  constructor() {
    super("Analytics is busy, please retry in a moment");
  }
}

let active = 0;
const waiters: (() => void)[] = [];

// Early-warning threshold: queueing is normal under a board load burst, but a
// standing queue this deep means analytics is saturated — log it before users
// start seeing 503s.
const QUEUE_WARN_DEPTH = 25;
let lastQueueWarnAt = 0;

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  if (waiters.length >= MAX_QUEUE) throw new AnalyticsBusyError();
  if (waiters.length >= QUEUE_WARN_DEPTH && Date.now() - lastQueueWarnAt > 30_000) {
    lastQueueWarnAt = Date.now();
    logger.warn(
      { analyticsQueue: { active, waiting: waiters.length } },
      "insights analytics queue is deep",
    );
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function releaseSlot(): void {
  active--;
  waiters.shift()?.();
}

/** Run one insights SQL statement inside a timeout-scoped transaction,
 *  through the analytics concurrency gate. */
export async function runAnalyticsQuery<Row extends Record<string, unknown>>(
  query: SQL,
): Promise<Row[]> {
  await acquireSlot();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`),
      );
      return tx.execute(query);
    });
    return result.rows as Row[];
  } finally {
    releaseSlot();
  }
}

// Shared performance-report result shape + row pivot, so every scope returns
// the exact same contract to the client.

export interface PerformanceRow {
  x?: unknown;
  x_label?: unknown;
  segment?: unknown;
  segment_label?: unknown;
  value: unknown;
}

export interface PerformanceResult {
  xKey: string;
  series: { key: string; label?: string; data: Record<string, unknown>[] }[];
  meta: {
    scope: string;
    appliedFilters: { board: string[]; widget: string[] };
    totalRows: number;
    rowCap?: number;
    /** Compute time (ISO) — lets cached responses stay honest about age. */
    freshness?: string;
  };
}

// ---------------------------------------------------------------------------
// Shared performance-report assembly. Both Postgres scopes (deals,
// activities) produce the same SELECT shape — measure × viewBy (× segmentBy)
// with aliased x/segment columns — so ONE place owns the select/group/order/
// limit assembly and the result envelope, and the scopes cannot drift.
// ---------------------------------------------------------------------------

export interface PerformanceDimension {
  expr: SQL;
  /** Human label for id dimensions (owner/stage/pipeline), via a join. */
  labelExpr?: SQL;
}

export interface PerformanceReportSpec {
  scope: string;
  /** The FROM table, e.g. sql`${dealsTable}`. */
  from: SQL;
  /** LEFT JOIN clauses, already rendered (may be empty). */
  joins: SQL[];
  /** WHERE conditions, AND-ed (may be empty). */
  conditions: SQL[];
  viewDim?: PerformanceDimension;
  segDim?: PerformanceDimension;
  measure: SQL;
  /** Validated upstream by resolveSortTarget — alias/direction are literals. */
  sortTarget?: { alias: "x" | "value"; direction: "asc" | "desc" };
  cap: number;
  appliedFilters: { board: string[]; widget: string[] };
}

/** Assemble and run a performance report; returns the shared API contract. */
export async function runPerformanceReport(
  report: PerformanceReportSpec,
): Promise<PerformanceResult> {
  const { viewDim, segDim, measure, sortTarget, cap } = report;

  const selectParts: SQL[] = [];
  const groupParts: SQL[] = [];
  if (viewDim) {
    selectParts.push(sql`${viewDim.expr} as x`);
    groupParts.push(sql`x`);
    if (viewDim.labelExpr) selectParts.push(sql`min(${viewDim.labelExpr}) as x_label`);
  }
  if (segDim) {
    selectParts.push(sql`${segDim.expr} as segment`);
    groupParts.push(sql`segment`);
    if (segDim.labelExpr) {
      selectParts.push(sql`min(${segDim.labelExpr}) as segment_label`);
    }
  }
  selectParts.push(sql`${measure} as value`);

  let query = sql`select ${sql.join(selectParts, sql`, `)} from ${report.from}`;
  for (const join of report.joins) {
    query = sql`${query} ${join}`;
  }
  if (report.conditions.length > 0) {
    query = sql`${query} where ${sql.join(report.conditions, sql` and `)}`;
  }
  if (groupParts.length > 0) {
    // Alias and direction are validated literals (never client strings), so
    // sql.raw is safe. Group parts stay as tiebreakers for a stable order.
    const orderParts = sortTarget
      ? [sql`${sql.raw(sortTarget.alias)} ${sql.raw(sortTarget.direction)}`, ...groupParts]
      : groupParts;
    query = sql`${query} group by ${sql.join(groupParts, sql`, `)} order by ${sql.join(orderParts, sql`, `)}`;
  }
  query = sql`${query} limit ${cap}`;

  const typed = await runAnalyticsQuery<PerformanceRow & Record<string, unknown>>(query);

  return {
    xKey: "x",
    series: rowsToSeries(typed, segDim !== undefined),
    meta: {
      scope: report.scope,
      appliedFilters: report.appliedFilters,
      totalRows: typed.length,
      ...(typed.length >= cap ? { rowCap: cap } : {}),
    },
  };
}

/** Pivot flat aggregate rows into the per-series shape the API returns. */
export function rowsToSeries(
  rows: PerformanceRow[],
  segmented: boolean,
): PerformanceResult["series"] {
  const point = (row: PerformanceRow) => ({
    x: row.x ?? null,
    xLabel: row.x_label ?? undefined,
    y: row.value == null ? null : Number(row.value),
  });
  if (!segmented) return [{ key: "value", data: rows.map(point) }];

  const bySegment = new Map<
    string,
    { label?: string; data: Record<string, unknown>[] }
  >();
  for (const row of rows) {
    const key = row.segment == null ? "(empty)" : String(row.segment);
    const entry = bySegment.get(key) ?? {
      label: row.segment_label == null ? undefined : String(row.segment_label),
      data: [],
    };
    entry.data.push(point(row));
    bySegment.set(key, entry);
  }
  return [...bySegment.entries()].map(([key, entry]) => ({
    key,
    label: entry.label,
    data: entry.data,
  }));
}
