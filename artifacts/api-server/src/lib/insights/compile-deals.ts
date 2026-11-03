import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import {
  dealsTable,
  usersTable,
  stagesTable,
  pipelinesTable,
  organizationsTable,
} from "@workspace/db";
import {
  isCustomFieldRef,
  countConditions,
  type FilterCondition,
  type ExtendedFilterGroup,
  type FilterGroup,
} from "@workspace/deals-filter";
import type { WidgetSpec } from "@workspace/insights-spec";
import { compileCondition, localDate, APP_TZ_SQL, DealFilterError } from "../queries";
import { runPerformanceReport, type PerformanceResult } from "./analytics-db";
import {
  InsightsQueryError,
  assertDateBucket,
  compileGuardedGroup,
  compileEmptinessOps,
  compileEnumOps,
  compileIdRefOps,
  compileTextOps,
  compileNumberOps,
  compileDateOps,
  decodeBoardFilters,
  pushDateRange,
  sqlInNumbers,
  sqlInStrings,
  reqStr,
} from "./operators";
import type { DealsFieldCatalog, InsightsFieldDef } from "./fields";
import { DEALS_NATIVE_FIELDS, loadDealsFieldCatalog } from "./fields";

export { InsightsQueryError, type PerformanceResult };

// ---------------------------------------------------------------------------
// Deals scope compiler (Phase 0: the `performance` report).
//
// Field keys come from the allow-list in ./fields.ts; graph + board filters
// compose by intersection (both are AND-ed into WHERE — narrowing only).
// Custom-field (`cf:<key>`) conditions resolve through the deal_field
// registry: the JSONB key is embedded as an escaped literal (matching the
// filterable expression indexes), values are always bound parameters.
//
// Filter conditions accept BOTH vocabularies: the Insights field keys that
// /insights/fields advertises (createdAt, utmSource, value, …) and the
// 11 base deals-filter DSL names (createdDate, wonTime, …) so filters encoded
// by the existing deals page remain valid. Aliases map between the two.
// ---------------------------------------------------------------------------

/** Allow-listed columns, keyed by the Insights field vocabulary. */
const DEAL_COLUMNS: Record<string, AnyColumn> = {
  owner: dealsTable.ownerId,
  pipeline: dealsTable.pipelineId,
  stage: dealsTable.stageId,
  status: dealsTable.status,
  lostReason: dealsTable.lostReason,
  value: dealsTable.value,
  createdAt: dealsTable.addTime,
  wonAt: dealsTable.wonTime,
  lostAt: dealsTable.lostTime,
  closedAt: dealsTable.closeTime,
  utmSource: dealsTable.utmSource,
  utmMedium: dealsTable.utmMedium,
  utmCampaign: dealsTable.utmCampaign,
  utmKeyword: dealsTable.utmKeyword,
  adName: dealsTable.adName,
  title: dealsTable.title,
};

/** Base-DSL name → Insights key, so deals-page-encoded filters keep working. */
const BASE_DSL_ALIASES: Record<string, string> = {
  createdDate: "createdAt",
  wonTime: "wonAt",
};

// spec.dateBasis values the deals `performance` report can serve today.
// enteredStageAt needs change_events (funnel work); activityDoneAt belongs
// to another scope. Rejected early with a clear message
// instead of failing only when a board date filter happens to be active.
const DATE_BASIS_COLUMNS: Record<string, AnyColumn> = {
  createdAt: dealsTable.addTime,
  closedAt: dealsTable.closeTime,
  wonAt: dealsTable.wonTime,
  lostAt: dealsTable.lostTime,
};

const DEALS_NATIVE_BY_KEY = new Map(DEALS_NATIVE_FIELDS.map((f) => [f.key, f]));

const DATE_FIELD_KEYS = new Set(["createdAt", "wonAt", "lostAt", "closedAt"]);

/** JSONB accessor for a registry custom field. The key is registry-owned
 *  (never raw client input); embedding it as an escaped literal lets btree
 *  expression indexes over (custom_fields ->> '<key>') match — today only
 *  `qualification` has one (deals_cf_qualification_idx); other keys scan. */
function customExpr(def: InsightsFieldDef): SQL {
  const key = (def.customKey ?? "").replace(/'/g, "''");
  return sql`(${dealsTable.customFields} ->> ${sql.raw(`'${key}'`)})`;
}

export function compileCustomCondition(
  def: InsightsFieldDef,
  operator: string,
  value: unknown,
): SQL {
  const raw = customExpr(def);
  if (operator === "is_empty") return sql`(${raw} is null or ${raw} = '')`;
  if (operator === "is_not_empty") return sql`(${raw} is not null and ${raw} <> '')`;

  switch (def.type) {
    case "double":
    case "monetary": {
      const num = sql`(${raw})::double precision`;
      return compileNumberOps(num, operator, value, def.key);
    }
    case "date": {
      const d = sql`(${raw})::date`;
      return compileDateOps(d, operator, value, def.key);
    }
    case "boolean": {
      // The DSL admits real booleans; JSONB stores them as "true"/"false".
      const s = typeof value === "boolean" ? String(value) : reqStr(value);
      if (operator === "is") return sql`${raw} = ${s}`;
      if (operator === "is_not") return sql`${raw} is distinct from ${s}`;
      break;
    }
    default: {
      // varchar/text/enum/set — text semantics (set values store labels).
      return compileTextOps(raw, operator, value, def.key);
    }
  }
  throw new InsightsQueryError(
    `Operator "${operator}" is not supported for custom field "${def.key}"`,
  );
}

const DEAL_STATUSES = new Set(["open", "won", "lost", "deleted"]);

/** Compile a condition on an Insights native field (type-driven). */
function compileNativeCondition(
  def: InsightsFieldDef,
  operator: string,
  value: unknown,
): SQL {
  const col = DEAL_COLUMNS[def.key];
  if (!col) throw new InsightsQueryError(`Unknown filter field: ${def.key}`);

  const emptiness = compileEmptinessOps(col, operator, def.type === "text");
  if (emptiness) return emptiness;

  switch (def.type) {
    case "user":
    case "pipeline":
    case "stage":
      return compileIdRefOps(col, operator, value, def.key);
    case "status":
      return compileEnumOps(col, operator, value, DEAL_STATUSES, "status");
    case "double":
    case "monetary":
      return compileNumberOps(sql`${col}`, operator, value, def.key);
    case "date":
      return compileDateOps(localDate(col), operator, value, def.key);
    default:
      return compileTextOps(sql`${col}`, operator, value, def.key);
  }
}

interface CompileCtx {
  catalog: DealsFieldCatalog;
  /** Set when a condition references the organization name, which lives on a
   *  joined table — the query builder must add the join. */
  needsOrgJoin: boolean;
}

export interface CompiledFilter {
  where: SQL | undefined;
  needsOrgJoin: boolean;
}

/** Compile an extended (cf:-aware) group over both filter vocabularies. */
export function compileExtendedGroup(
  group: ExtendedFilterGroup,
  catalog: DealsFieldCatalog,
): CompiledFilter {
  const ctx: CompileCtx = { catalog, needsOrgJoin: false };
  const where = compileGuardedGroup(group, (cond) => compileOneCondition(cond, ctx));
  return { where, needsOrgJoin: ctx.needsOrgJoin };
}

/** Organization name lives on the joined organizations table; delegate to
 *  the deals-list compiler (the caller flags the join). Shared with the
 *  activities scope, whose org join hangs off activities.org_id instead. */
export function compileOrganizationCondition(cond: {
  field: string;
  operator: string;
  value?: unknown;
}): SQL {
  try {
    return compileCondition(cond as FilterCondition);
  } catch (err) {
    if (err instanceof DealFilterError) throw new InsightsQueryError(err.message);
    throw err;
  }
}

function compileOneCondition(
  cond: { field: string; operator: string; value?: unknown },
  ctx: CompileCtx,
): SQL {
  if (isCustomFieldRef(cond.field)) {
    const def = ctx.catalog.customByRef.get(cond.field);
    if (!def || !def.filterable) {
      throw new InsightsQueryError(`Unknown custom field: ${cond.field}`);
    }
    return compileCustomCondition(def, cond.operator, cond.value);
  }

  if (cond.field === "organization") {
    ctx.needsOrgJoin = true;
    return compileOrganizationCondition(cond);
  }

  const key = BASE_DSL_ALIASES[cond.field] ?? cond.field;
  const def = DEALS_NATIVE_BY_KEY.get(key);
  if (!def || !def.filterable) {
    throw new InsightsQueryError(`Unknown filter field: ${cond.field}`);
  }
  return compileNativeCondition(def, cond.operator, cond.value);
}

// ---------------------------------------------------------------------------
// Board-level (global) filters — quick filters + the Add-filter condition
// group. Composed with the widget's own filters by AND (intersection).
// ---------------------------------------------------------------------------

export interface GlobalFilters {
  dateRange?: {
    preset?: string;
    from?: string | Date;
    to?: string | Date;
    basis?: string;
  } | null;
  ownerIds?: number[];
  pipelineIds?: number[];
  statuses?: string[];
  qualification?: string;
  /** base64url-encoded extended filter group (the board's Add-filter). */
  filters?: string | null;
}

export const BOARD_STATUSES = new Set(["open", "won", "lost"]);

export interface CompiledGlobalFilters {
  conditions: SQL[];
  applied: string[];
  needsOrgJoin: boolean;
}

/** The qualification quick-chip resolves through the custom-field registry.
 *  Failing loudly beats the silent-drop failure mode: a filter the user set
 *  must never be ignored. Shared with the activities scope (deal-side). */
export function qualificationCondition(
  catalog: DealsFieldCatalog,
  value: string,
): SQL {
  const def = catalog.customByRef.get("cf:qualification");
  if (!def) {
    throw new InsightsQueryError(
      'Qualification filter is unavailable: no active "qualification" deal field',
    );
  }
  return compileCustomCondition(def, "is", value);
}

export function compileGlobalFilters(
  global: GlobalFilters | null | undefined,
  spec: WidgetSpec,
  catalog: DealsFieldCatalog,
): CompiledGlobalFilters {
  const conditions: SQL[] = [];
  const applied: string[] = [];
  let needsOrgJoin = false;
  if (!global) return { conditions, applied, needsOrgJoin };

  if (global.ownerIds && global.ownerIds.length > 0) {
    conditions.push(sqlInNumbers(dealsTable.ownerId, global.ownerIds));
    applied.push(`Owner is any of ${global.ownerIds.join(", ")}`);
  }
  if (global.pipelineIds && global.pipelineIds.length > 0) {
    conditions.push(sqlInNumbers(dealsTable.pipelineId, global.pipelineIds));
    applied.push(`Pipeline is any of ${global.pipelineIds.join(", ")}`);
  }
  if (global.statuses && global.statuses.length > 0) {
    const statuses = global.statuses.filter((s) => BOARD_STATUSES.has(s));
    if (statuses.length > 0) {
      conditions.push(sqlInStrings(sql`${dealsTable.status}::text`, statuses));
      applied.push(`Status is any of ${statuses.join(", ")}`);
    }
  }
  if (global.qualification) {
    conditions.push(qualificationCondition(catalog, global.qualification));
    applied.push(`Qualification is ${global.qualification}`);
  }
  if (global.filters) {
    const group = decodeBoardFilters(global.filters);
    const compiled = compileExtendedGroup(group, catalog);
    if (compiled.where) {
      conditions.push(compiled.where);
      needsOrgJoin = needsOrgJoin || compiled.needsOrgJoin;
      applied.push(
        `${countConditions(group as FilterGroup)} board condition(s)`,
      );
    }
  }
  if (global.dateRange && (global.dateRange.from || global.dateRange.to)) {
    const basis = global.dateRange.basis ?? spec.dateBasis ?? "createdAt";
    const col = DATE_BASIS_COLUMNS[basis];
    if (!col) {
      throw new InsightsQueryError(
        `Date basis "${basis}" is not supported for deals yet`,
      );
    }
    applied.push(pushDateRange(conditions, localDate(col), global.dateRange, basis));
  }
  return { conditions, applied, needsOrgJoin };
}

// ---------------------------------------------------------------------------
// The `performance` report: measure × viewBy (× segmentBy) with date
// bucketing in the app time zone.
// ---------------------------------------------------------------------------

interface Dimension {
  expr: SQL;
  labelExpr?: SQL;
  join?: "owner" | "stage" | "pipeline";
}

function resolveDimension(
  fieldKey: string,
  dateBucket: string | undefined,
  catalog: DealsFieldCatalog,
): Dimension {
  assertDateBucket(dateBucket);

  if (isCustomFieldRef(fieldKey)) {
    const def = catalog.customByRef.get(fieldKey);
    if (!def || !def.groupable) {
      throw new InsightsQueryError(`Unknown grouping field: ${fieldKey}`);
    }
    if (def.type === "date") {
      const bucket = dateBucket ?? "month";
      return {
        expr: sql`date_trunc(${bucket}, (${customExpr(def)})::date)::date`,
      };
    }
    if (dateBucket) {
      throw new InsightsQueryError(
        `Field "${fieldKey}" is not a date; dateBucket does not apply`,
      );
    }
    return { expr: customExpr(def) };
  }

  const key = BASE_DSL_ALIASES[fieldKey] ?? fieldKey;
  const col = DEAL_COLUMNS[key];
  if (!col) throw new InsightsQueryError(`Unknown grouping field: ${fieldKey}`);

  if (DATE_FIELD_KEYS.has(key)) {
    const bucket = dateBucket ?? "month";
    return {
      expr: sql`date_trunc(${bucket}, ${col} AT TIME ZONE ${APP_TZ_SQL})::date`,
    };
  }
  if (dateBucket) {
    throw new InsightsQueryError(
      `Field "${fieldKey}" is not a date; dateBucket does not apply`,
    );
  }
  if (key === "owner") {
    return { expr: sql`${dealsTable.ownerId}`, labelExpr: sql`${usersTable.name}`, join: "owner" };
  }
  if (key === "stage") {
    return { expr: sql`${dealsTable.stageId}`, labelExpr: sql`${stagesTable.name}`, join: "stage" };
  }
  if (key === "pipeline") {
    return { expr: sql`${dealsTable.pipelineId}`, labelExpr: sql`${pipelinesTable.name}`, join: "pipeline" };
  }
  if (key === "status") {
    return { expr: sql`${col}::text` };
  }
  return { expr: sql`${col}` };
}

const DEALS_MEASURABLE_KEYS = new Set(["value"]);

function resolveMeasure(spec: WidgetSpec, catalog: DealsFieldCatalog): SQL {
  const { field, agg } = spec.measure;
  if (agg === "count") return sql`count(*)`;

  let numExpr: SQL;
  if (isCustomFieldRef(field)) {
    const def = catalog.customByRef.get(field);
    if (!def || !def.measurable) {
      throw new InsightsQueryError(`Field "${field}" is not measurable`);
    }
    numExpr = sql`(${customExpr(def)})::double precision`;
  } else {
    const col = DEAL_COLUMNS[field];
    if (!col || !DEALS_MEASURABLE_KEYS.has(field)) {
      throw new InsightsQueryError(`Field "${field}" is not measurable`);
    }
    numExpr = sql`${col}`;
  }

  switch (agg) {
    case "sum":
      return sql`coalesce(sum(${numExpr}), 0)`;
    case "avg":
      return sql`avg(${numExpr})`;
    case "min":
      return sql`min(${numExpr})`;
    case "max":
      return sql`max(${numExpr})`;
    case "median":
      return sql`percentile_cont(0.5) within group (order by ${numExpr})`;
    case "p25":
      return sql`percentile_cont(0.25) within group (order by ${numExpr})`;
    case "p75":
      return sql`percentile_cont(0.75) within group (order by ${numExpr})`;
    default:
      throw new InsightsQueryError(`Unsupported aggregation: ${agg satisfies never}`);
  }
}

export const ROW_CAP = 5000;

/** Map spec.sort onto the aliases the query emits: sorting by the viewBy
 *  field orders the x dimension, sorting by the measure field orders the
 *  aggregated value. Anything else is rejected — a stored sort must never be
 *  silently ignored. Exported for tests. */
export function resolveSortTarget(
  spec: WidgetSpec,
): { alias: "x" | "value"; direction: "asc" | "desc" } | undefined {
  if (!spec.sort) return undefined;
  const { field, direction } = spec.sort;
  if (spec.viewBy && field === spec.viewBy.field) return { alias: "x", direction };
  if (field === spec.measure.field) return { alias: "value", direction };
  throw new InsightsQueryError(
    `Sort field "${field}" must be the group-by field or the measure field`,
  );
}

export async function runDealsPerformance(
  spec: WidgetSpec,
  global: GlobalFilters | null | undefined,
): Promise<PerformanceResult> {
  if (spec.dateBasis && !DATE_BASIS_COLUMNS[spec.dateBasis]) {
    throw new InsightsQueryError(
      `Date basis "${spec.dateBasis}" is not supported for deals yet`,
    );
  }

  // Validate up front (throws on an unknown field) even though the clause
  // only applies to grouped queries — a single-total row has nothing to sort.
  const sortTarget = resolveSortTarget(spec);

  const catalog = await loadDealsFieldCatalog();

  const conditions: SQL[] = [
    // Mirror the working-view defaults: archived and deleted deals are out.
    sql`${dealsTable.archived} = false`,
    sql`${dealsTable.status} <> 'deleted'`,
  ];

  const widgetApplied: string[] = [];
  const widgetFilter = compileExtendedGroup(spec.filters, catalog);
  if (widgetFilter.where) {
    conditions.push(widgetFilter.where);
    widgetApplied.push(`${countConditions(spec.filters as FilterGroup)} widget condition(s)`);
  }

  const board = compileGlobalFilters(global, spec, catalog);
  conditions.push(...board.conditions);

  const joins = new Set<string>();
  if (widgetFilter.needsOrgJoin || board.needsOrgJoin) joins.add("organization");
  const viewDim = spec.viewBy
    ? resolveDimension(spec.viewBy.field, spec.viewBy.dateBucket, catalog)
    : undefined;
  const segDim = spec.segmentBy
    ? resolveDimension(spec.segmentBy.field, undefined, catalog)
    : undefined;
  if (viewDim?.join) joins.add(viewDim.join);
  if (segDim?.join) joins.add(segDim.join);

  const joinClauses: SQL[] = [];
  if (joins.has("owner")) {
    joinClauses.push(sql`left join ${usersTable} on ${dealsTable.ownerId} = ${usersTable.id}`);
  }
  if (joins.has("stage")) {
    joinClauses.push(sql`left join ${stagesTable} on ${dealsTable.stageId} = ${stagesTable.id}`);
  }
  if (joins.has("pipeline")) {
    joinClauses.push(sql`left join ${pipelinesTable} on ${dealsTable.pipelineId} = ${pipelinesTable.id}`);
  }
  if (joins.has("organization")) {
    joinClauses.push(sql`left join ${organizationsTable} on ${dealsTable.organizationId} = ${organizationsTable.id}`);
  }

  return runPerformanceReport({
    scope: "deals",
    from: sql`${dealsTable}`,
    joins: joinClauses,
    conditions,
    viewDim,
    segDim,
    measure: resolveMeasure(spec, catalog),
    sortTarget,
    cap: Math.min(spec.limit ?? ROW_CAP, ROW_CAP),
    appliedFilters: { board: board.applied, widget: widgetApplied },
  });
}
