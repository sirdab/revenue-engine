import {
  FILTER_FIELD_MAP,
  isFilterGroup,
  type FilterCondition,
  type FilterFieldName,
  type FilterGroup,
} from "./index";

// ---------------------------------------------------------------------------
// In-memory condition evaluator — the runtime counterpart to the SQL compiler.
//
// `compileDealFilters` (artifacts/api-server/src/lib/queries.ts) answers "filter
// a LIST" by emitting SQL bound to the deals table. Auto-assignment needs the
// dual question — "does THIS deal match?" — so this walks the SAME FilterGroup
// DSL in memory. It MUST agree with `compileCondition` field-by-field; any drift
// means a rule matches in the builder's mental model but not at runtime.
//
// Parity notes (the SQL is authoritative):
//   - text `contains` => ilike  => case-INSENSITIVE substring
//   - text `is`       => `=`     => case-SENSITIVE exact match
//   - `is_not`        => `is distinct from` => NULL-safe (null field is distinct
//                        from any concrete value, so is_not matches it)
//   - `is` / `gt` / `lt` / `between` => plain comparison; a NULL field never
//                        matches (SQL `NULL <op> x` is NULL => row excluded)
//   - date fields compared as `(ts AT TIME ZONE 'Asia/Riyadh')::date` vs the
//     value's date portion (`v::date`)
//   - empty group imposes no constraint (compileGroup returns undefined => all
//     rows match), so an empty/vacuous group evaluates to true
//
// The evaluator is PURE (no DB): the caller resolves FK/joined values (e.g. the
// organization NAME) into normalized `DealFacts` once, so this reads plain
// scalars exactly as the SQL columns hold them.
// ---------------------------------------------------------------------------

/**
 * The normalized per-deal values the evaluator reads, one per filter field.
 * The caller (the assignment engine) builds this from a loaded deal plus any
 * resolved joins (organization name). Absent/unknown values are `null`.
 */
export interface DealFacts {
  title: string | null;
  organizationName: string | null;
  value: number | null;
  pipelineId: number | null;
  stageId: number | null;
  ownerId: number | null;
  createdDate: Date | null;
  wonTime: Date | null;
  status: string | null;
  utmKeyword: string | null;
  lostReason: string | null;
}

type FieldKind = "text" | "number" | "id" | "status" | "date";

// Field -> (storage kind, fact accessor). Mirrors FILTER_COLUMNS in queries.ts:
// stage/owner are numeric ids; createdDate/wonTime are dates; the rest are text
// except value (number) and status.
//
// Deliberately PARTIAL: only rule-capable fields (RULE_FILTER_FIELDS) appear.
// `listOnly` filter fields exist solely for the deals-list SQL compiler — they
// read joined/computed columns DealFacts doesn't carry — so evaluating one
// throws, which the rule services' write-time dry-run turns into a 400.
const FIELD_META: Partial<
  Record<
    FilterFieldName,
    { kind: FieldKind; get: (f: DealFacts) => string | number | Date | null }
  >
> = {
  title: { kind: "text", get: (f) => f.title },
  organization: { kind: "text", get: (f) => f.organizationName },
  value: { kind: "number", get: (f) => f.value },
  pipeline: { kind: "id", get: (f) => f.pipelineId },
  stage: { kind: "id", get: (f) => f.stageId },
  owner: { kind: "id", get: (f) => f.ownerId },
  createdDate: { kind: "date", get: (f) => f.createdDate },
  wonTime: { kind: "date", get: (f) => f.wonTime },
  status: { kind: "status", get: (f) => f.status },
  utmKeyword: { kind: "text", get: (f) => f.utmKeyword },
  lostReason: { kind: "text", get: (f) => f.lostReason },
};

const DEAL_STATUSES = ["open", "won", "lost", "deleted"];

// Value coercions mirroring queries.ts's req* helpers. The condition is assumed
// pre-validated by filterGroupSchema at the API layer; these coercions keep the
// evaluator's number/date handling identical to the SQL compiler's.
class EvaluateError extends Error {}

function reqStr(v: unknown): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  throw new EvaluateError("Expected a text value");
}
function reqNum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new EvaluateError("Expected a numeric value");
  return n;
}
/** Validate a date value and reduce it to its YYYY-MM-DD portion (`v::date`). */
function reqDateOnly(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new EvaluateError("Expected a date value");
  }
  if (Number.isNaN(new Date(v).getTime())) {
    throw new EvaluateError("Invalid date value");
  }
  // Take the literal date portion — matches Postgres `::date` on a date-only or
  // local-timestamp string WITHOUT shifting by timezone (the value is not tz
  // converted; only the deal's timestamp fact is, in Asia/Riyadh below).
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : v.slice(0, 10);
}
function reqPair(v: unknown): [unknown, unknown] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new EvaluateError("Expected a two-value range");
  }
  return [v[0], v[1]];
}
function reqStatus(v: unknown): string {
  if (typeof v === "string" && DEAL_STATUSES.includes(v)) return v;
  throw new EvaluateError("Invalid status value");
}

// The deal's timestamp truncated to a Riyadh-local calendar date. en-CA yields
// an ISO "YYYY-MM-DD" string, which compares chronologically as a string.
const riyadhDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function riyadhDate(d: Date): string {
  return riyadhDateFmt.format(d);
}

/**
 * `a IS DISTINCT FROM b` — NULL-safe inequality. `b` is always a concrete
 * (non-null) value here, so a null field is always "distinct".
 */
function isDistinctFrom(a: string | number | null, b: string | number): boolean {
  if (a === null) return true;
  return a !== b;
}

function evalCondition(c: FilterCondition, facts: DealFacts): boolean {
  const def = FILTER_FIELD_MAP[c.field];
  const meta = FIELD_META[c.field];
  if (!def) throw new EvaluateError(`Unknown field: ${c.field}`);
  if (!meta) {
    throw new EvaluateError(
      `Field "${c.field}" is only available in deals-list filters, not rules`,
    );
  }
  if (!def.operators.includes(c.operator)) {
    throw new EvaluateError(
      `Operator "${c.operator}" is not allowed for field "${c.field}"`,
    );
  }
  const { kind } = meta;
  const raw = meta.get(facts);
  const op = c.operator;

  // Presence checks ignore the value. Text also treats "" as empty (mirrors the
  // SQL `col = ''` branch); other kinds only test NULL.
  if (op === "is_empty") {
    return kind === "text" ? raw === null || raw === "" : raw === null;
  }
  if (op === "is_not_empty") {
    return kind === "text" ? raw !== null && raw !== "" : raw !== null;
  }

  const v = c.value;
  switch (kind) {
    case "text": {
      const s = raw as string | null;
      if (op === "contains") {
        return (
          s !== null && s.toLowerCase().includes(reqStr(v).toLowerCase())
        );
      }
      // NULL-inclusive (SQL parity: `col is null or col not ilike`).
      if (op === "not_contains") {
        return (
          s === null || !s.toLowerCase().includes(reqStr(v).toLowerCase())
        );
      }
      if (op === "is") return s !== null && s === reqStr(v);
      if (op === "is_not") return isDistinctFrom(s, reqStr(v));
      break;
    }
    case "number": {
      const n = raw as number | null;
      if (op === "is") return n !== null && n === reqNum(v);
      if (op === "is_not") return isDistinctFrom(n, reqNum(v));
      if (op === "gt") return n !== null && n > reqNum(v);
      if (op === "lt") return n !== null && n < reqNum(v);
      if (op === "between") {
        const [a, b] = reqPair(v);
        return n !== null && n >= reqNum(a) && n <= reqNum(b);
      }
      break;
    }
    case "id": {
      const n = raw as number | null;
      if (op === "is") return n !== null && n === reqNum(v);
      if (op === "is_not") return isDistinctFrom(n, reqNum(v));
      break;
    }
    case "status": {
      const s = raw as string | null;
      if (op === "is") return s !== null && s === reqStatus(v);
      if (op === "is_not") return isDistinctFrom(s, reqStatus(v));
      break;
    }
    case "date": {
      const d = raw as Date | null;
      const local = d === null ? null : riyadhDate(d);
      if (op === "is") return local !== null && local === reqDateOnly(v);
      if (op === "is_not") return isDistinctFrom(local, reqDateOnly(v));
      if (op === "gt") return local !== null && local > reqDateOnly(v);
      if (op === "lt") return local !== null && local < reqDateOnly(v);
      if (op === "between") {
        const [a, b] = reqPair(v);
        return (
          local !== null &&
          local >= reqDateOnly(a) &&
          local <= reqDateOnly(b)
        );
      }
      break;
    }
  }
  throw new EvaluateError(
    `Operator "${op}" is not supported for field "${c.field}"`,
  );
}

// Mirrors compileGroup: collect the truth of each node; a nested group with no
// evaluable conditions contributes nothing (undefined). A group with zero parts
// imposes no constraint (undefined => treated as "matches").
function evalGroup(group: FilterGroup, facts: DealFacts): boolean | undefined {
  const parts: boolean[] = [];
  for (const node of group.conditions) {
    if (isFilterGroup(node)) {
      const nested = evalGroup(node, facts);
      if (nested !== undefined) parts.push(nested);
    } else {
      parts.push(evalCondition(node, facts));
    }
  }
  if (parts.length === 0) return undefined;
  return group.combinator === "or" ? parts.some(Boolean) : parts.every(Boolean);
}

/**
 * Does `facts` satisfy `group`? Assumes `group` was validated by
 * `filterGroupSchema` upstream. An empty (or vacuous) group matches everything,
 * consistent with the SQL compiler dropping an empty filter.
 */
export function evaluate(group: FilterGroup, facts: DealFacts): boolean {
  const result = evalGroup(group, facts);
  return result === undefined ? true : result;
}
