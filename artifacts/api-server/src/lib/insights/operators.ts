import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import {
  decodeExtendedFilters,
  isFilterGroup,
  maxDepth,
  countConditions,
  type ExtendedFilterGroup,
  type ExtendedFilterNode,
  type FilterGroup,
} from "@workspace/deals-filter";
import { escapeLike } from "../queries";

// ---------------------------------------------------------------------------
// Scope-agnostic filter plumbing shared by every Insights compiler: value
// coercers, per-kind operator emitters, and the guarded group walker. One
// place per kind so the scopes cannot drift. Semantics mirror the deals-list
// compiler (ilike for contains, null-safe `is distinct from`).
// ---------------------------------------------------------------------------

export class InsightsQueryError extends Error {}

export function reqStr(v: unknown): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  throw new InsightsQueryError("Expected a text value");
}

export function reqNum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new InsightsQueryError("Expected a numeric value");
  return n;
}

/** Dates may arrive as strings (raw JSON) or Date instances (the generated
 *  zod schemas coerce date-formatted fields). Normalize to YYYY-MM-DD. */
export function reqDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && !Number.isNaN(new Date(v).getTime())) {
    return v;
  }
  throw new InsightsQueryError("Expected a date value");
}

export function reqPair(v: unknown): [unknown, unknown] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new InsightsQueryError("Expected a two-value range");
  }
  return [v[0], v[1]];
}

const DATE_BUCKETS = new Set(["day", "week", "month", "quarter"]);

/** Reject an unknown dateBucket up front — shared by every scope's
 *  dimension resolver so the accepted set can't drift. */
export function assertDateBucket(bucket: string | undefined): void {
  if (bucket !== undefined && !DATE_BUCKETS.has(bucket)) {
    throw new InsightsQueryError(`Unsupported date bucket: ${bucket}`);
  }
}

/** is_empty / is_not_empty, with text columns also treating '' as empty.
 *  Returns null when `op` is neither, so callers fall through to typed ops. */
export function compileEmptinessOps(
  col: AnyColumn | SQL,
  op: string,
  isText: boolean,
): SQL | null {
  if (op === "is_empty") {
    return isText
      ? sql`(${col} is null or ${col} = '')`
      : sql`${col} is null`;
  }
  if (op === "is_not_empty") {
    return isText
      ? sql`(${col} is not null and ${col} <> '')`
      : sql`${col} is not null`;
  }
  return null;
}

/** Numeric id references (owner/pipeline/stage): equality only. */
export function compileIdRefOps(
  col: AnyColumn | SQL,
  op: string,
  v: unknown,
  field: string,
): SQL {
  if (op === "is") return sql`${col} = ${reqNum(v)}`;
  if (op === "is_not") return sql`${col} is distinct from ${reqNum(v)}`;
  throw new InsightsQueryError(`Operator "${op}" is not supported for "${field}"`);
}

/** Closed string enums (deal status, activity type): the value must belong
 *  to the allowed set, and the pg enum column is compared as ::text. */
export function compileEnumOps(
  col: AnyColumn | SQL,
  op: string,
  v: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): SQL {
  const s = reqStr(v);
  if (!allowed.has(s)) throw new InsightsQueryError(`Invalid ${field} value`);
  if (op === "is") return sql`${col}::text = ${s}`;
  if (op === "is_not") return sql`${col}::text is distinct from ${s}`;
  throw new InsightsQueryError(`Operator "${op}" is not supported for "${field}"`);
}

export function compileTextOps(expr: SQL, op: string, v: unknown, field: string): SQL {
  // escapeLike keeps "100%"/"_" literal — same hardening as the deals-list
  // compiler, so contains means the same thing on both surfaces.
  if (op === "contains") return sql`${expr} ilike ${`%${escapeLike(reqStr(v))}%`}`;
  // NULL-inclusive, like is_not: a missing value "does not contain" anything.
  if (op === "not_contains") {
    return sql`(${expr} is null or ${expr} not ilike ${`%${escapeLike(reqStr(v))}%`})`;
  }
  if (op === "is") return sql`${expr} = ${reqStr(v)}`;
  if (op === "is_not") return sql`${expr} is distinct from ${reqStr(v)}`;
  throw new InsightsQueryError(`Operator "${op}" is not supported for "${field}"`);
}

export function compileNumberOps(expr: SQL, op: string, v: unknown, field: string): SQL {
  if (op === "is") return sql`${expr} = ${reqNum(v)}`;
  if (op === "is_not") return sql`${expr} is distinct from ${reqNum(v)}`;
  if (op === "gt") return sql`${expr} > ${reqNum(v)}`;
  if (op === "lt") return sql`${expr} < ${reqNum(v)}`;
  if (op === "between") {
    const [a, b] = reqPair(v);
    return sql`${expr} between ${reqNum(a)} and ${reqNum(b)}`;
  }
  throw new InsightsQueryError(`Operator "${op}" is not supported for "${field}"`);
}

export function compileDateOps(expr: SQL, op: string, v: unknown, field: string): SQL {
  if (op === "is") return sql`${expr} = ${reqDate(v)}::date`;
  if (op === "is_not") return sql`${expr} is distinct from ${reqDate(v)}::date`;
  if (op === "gt") return sql`${expr} > ${reqDate(v)}::date`;
  if (op === "lt") return sql`${expr} < ${reqDate(v)}::date`;
  if (op === "between") {
    const [a, b] = reqPair(v);
    return sql`${expr} between ${reqDate(a)}::date and ${reqDate(b)}::date`;
  }
  throw new InsightsQueryError(`Operator "${op}" is not supported for "${field}"`);
}

/** Walk an extended group with the structural guards applied, delegating
 *  each leaf condition to the scope's own compiler. */
export function compileGuardedGroup(
  group: ExtendedFilterGroup,
  compileOne: (cond: { field: string; operator: string; value?: unknown }) => SQL,
): SQL | undefined {
  if (maxDepth(group as FilterGroup) > 5) {
    throw new InsightsQueryError("Filter nesting is too deep");
  }
  if (countConditions(group as FilterGroup) > 100) {
    throw new InsightsQueryError("Too many filter conditions");
  }
  return walkGroup(group, compileOne);
}

// ---------------------------------------------------------------------------
// Board (global) filter plumbing shared by every scope: validated IN-lists,
// the encoded Add-filter decode, and date-range bounds.
// ---------------------------------------------------------------------------

export function sqlInNumbers(col: AnyColumn | SQL, ids: number[]): SQL {
  const vals = ids.map((n) => reqNum(n));
  return sql`${col} in (${sql.join(vals.map((n) => sql`${n}`), sql`, `)})`;
}

export function sqlInStrings(col: AnyColumn | SQL, values: string[]): SQL {
  const vals = values.map((v) => reqStr(v));
  return sql`${col} in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`;
}

/** Decode the board's base64url Add-filter group, failing as a query error
 *  (400) rather than a 500. */
export function decodeBoardFilters(encoded: string): ExtendedFilterGroup {
  try {
    return decodeExtendedFilters(encoded);
  } catch {
    throw new InsightsQueryError("Invalid board filter encoding");
  }
}

/** Push inclusive from/to bounds on a local-date expression; returns the
 *  human "applied filters" label. */
export function pushDateRange(
  conditions: SQL[],
  expr: SQL,
  range: { from?: string | Date; to?: string | Date },
  basis: string,
): string {
  let from: string | undefined;
  let to: string | undefined;
  if (range.from) {
    from = reqDate(range.from);
    conditions.push(sql`${expr} >= ${from}::date`);
  }
  if (range.to) {
    to = reqDate(range.to);
    conditions.push(sql`${expr} <= ${to}::date`);
  }
  return `Date (${basis}) ${from ?? "…"} → ${to ?? "…"}`;
}

function walkGroup(
  group: ExtendedFilterGroup,
  compileOne: (cond: { field: string; operator: string; value?: unknown }) => SQL,
): SQL | undefined {
  const parts: SQL[] = [];
  for (const node of group.conditions as ExtendedFilterNode[]) {
    if (isFilterGroup(node as never)) {
      const nested = walkGroup(node as ExtendedFilterGroup, compileOne);
      if (nested) parts.push(nested);
      continue;
    }
    parts.push(
      compileOne(node as { field: string; operator: string; value?: unknown }),
    );
  }
  if (parts.length === 0) return undefined;
  const sep = group.combinator === "or" ? sql` or ` : sql` and `;
  return sql`(${sql.join(parts, sep)})`;
}
