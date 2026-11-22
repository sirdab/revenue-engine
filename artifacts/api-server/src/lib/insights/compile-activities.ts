import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import {
  activitiesTable,
  dealsTable,
  organizationsTable,
  usersTable,
} from "@workspace/db";
import {
  isCustomFieldRef,
  countConditions,
  type ExtendedFilterGroup,
  type FilterGroup,
} from "@workspace/deals-filter";
import type { WidgetSpec } from "@workspace/insights-spec";
import { localDate, appTzSql, bucketDate } from "../queries";
import { runPerformanceReport, type PerformanceResult } from "./analytics-db";
import {
  InsightsQueryError,
  assertDateBucket,
  compileGuardedGroup,
  compileEmptinessOps,
  compileEnumOps,
  compileIdRefOps,
  compileTextOps,
  compileDateOps,
  decodeBoardFilters,
  pushDateRange,
  sqlInNumbers,
  sqlInStrings,
  reqStr,
} from "./operators";
import {
  BOARD_STATUSES,
  ROW_CAP,
  compileExtendedGroup,
  compileOrganizationCondition,
  qualificationCondition,
  resolveSortTarget,
  type GlobalFilters,
} from "./compile-deals";
import type { DealsFieldCatalog, InsightsFieldDef } from "./fields";
import { ACTIVITIES_NATIVE_FIELDS, loadDealsFieldCatalog } from "./fields";

// ---------------------------------------------------------------------------
// Activities scope compiler (the `performance` report).
//
// Widget-level filters use the activities vocabulary from ./fields.ts
// (type, done, subject, note, due/done/created dates, owner, organization).
// Activities have no custom-field registry, so `cf:` refs are rejected.
//
// Board (global) filters keep their deal semantics on a mixed dashboard:
// owner and date range apply to the activity itself; pipeline, status,
// qualification and the board's Add-filter group apply to the
// activity's LINKED DEAL via an EXISTS subquery — "won deals" narrows an
// activities widget to activities on won deals, never silently no-ops.
// ---------------------------------------------------------------------------

/** Allow-listed columns, keyed by the Insights field vocabulary. */
const ACTIVITY_COLUMNS: Record<string, AnyColumn> = {
  owner: activitiesTable.ownerId,
  type: activitiesTable.type,
  done: activitiesTable.done,
  subject: activitiesTable.subject,
  note: activitiesTable.note,
  dueDate: activitiesTable.dueDate,
  doneAt: activitiesTable.markedAsDoneTime,
  createdAt: activitiesTable.addTime,
};

const ACTIVITY_TYPES = new Set([
  "call",
  "meeting",
  "email",
  "task",
  "deadline",
  "whatsapp",
]);
const ACTIVITIES_NATIVE_BY_KEY = new Map(
  ACTIVITIES_NATIVE_FIELDS.map((f) => [f.key, f]),
);

// spec.dateBasis values the activities report can serve. dueDate is reachable
// through ordinary filters/grouping; it is not a spec basis (yet).
const ACTIVITY_DATE_BASIS_COLUMNS: Record<string, SQL> = {
  createdAt: localDate(activitiesTable.addTime),
  activityDoneAt: localDate(activitiesTable.markedAsDoneTime),
};

/** App-time-zone ::date expression per date field. due_date is already a
 *  plain date column; the timestamps need the timezone conversion. */
function activityDateExpr(key: string, col: AnyColumn): SQL {
  return key === "dueDate" ? sql`${col}` : localDate(col);
}

function compileActivityCondition(
  def: InsightsFieldDef,
  operator: string,
  value: unknown,
): SQL {
  const col = ACTIVITY_COLUMNS[def.key];
  if (!col) throw new InsightsQueryError(`Unknown filter field: ${def.key}`);

  const emptiness = compileEmptinessOps(col, operator, def.type === "text");
  if (emptiness) return emptiness;

  switch (def.type) {
    case "user":
      return compileIdRefOps(col, operator, value, def.key);
    case "enum":
      return compileEnumOps(col, operator, value, ACTIVITY_TYPES, "activity type");
    case "boolean": {
      // The DSL admits real booleans; the URL round-trip may carry strings.
      const b =
        typeof value === "boolean" ? value : reqStr(value) === "true";
      if (operator === "is") return sql`${col} = ${b}`;
      if (operator === "is_not") return sql`${col} is distinct from ${b}`;
      break;
    }
    case "date":
      return compileDateOps(activityDateExpr(def.key, col), operator, value, def.key);
    default:
      return compileTextOps(sql`${col}`, operator, value, def.key);
  }
  throw new InsightsQueryError(
    `Operator "${operator}" is not supported for "${def.key}"`,
  );
}

export interface CompiledActivityFilter {
  where: SQL | undefined;
  /** Set when a condition references the organization name, which lives on a
   *  joined table (activities.org_id) — the query builder adds the join. */
  needsOrgJoin: boolean;
}

/** Compile an extended group over the activities vocabulary. */
export function compileActivitiesGroup(
  group: ExtendedFilterGroup,
): CompiledActivityFilter {
  let needsOrgJoin = false;
  const where = compileGuardedGroup(group, (cond) => {
    if (isCustomFieldRef(cond.field)) {
      throw new InsightsQueryError(
        `Custom fields are not available for activities: ${cond.field}`,
      );
    }
    // Organization name lives on the joined organizations table; the
    // deals-list compiler already emits the right predicate.
    if (cond.field === "organization") {
      needsOrgJoin = true;
      return compileOrganizationCondition(cond);
    }
    const def = ACTIVITIES_NATIVE_BY_KEY.get(cond.field);
    if (!def || !def.filterable) {
      throw new InsightsQueryError(`Unknown filter field: ${cond.field}`);
    }
    return compileActivityCondition(def, cond.operator, cond.value);
  });
  return { where, needsOrgJoin };
}

// ---------------------------------------------------------------------------
// Board-level (global) filters, activity semantics.
// ---------------------------------------------------------------------------

export interface CompiledActivitiesGlobalFilters {
  conditions: SQL[];
  applied: string[];
}

export function compileActivitiesGlobalFilters(
  global: GlobalFilters | null | undefined,
  spec: WidgetSpec,
  catalog: DealsFieldCatalog,
): CompiledActivitiesGlobalFilters {
  const conditions: SQL[] = [];
  const applied: string[] = [];
  if (!global) return { conditions, applied };

  // Owner filters the activity's own owner, not the linked deal's.
  if (global.ownerIds && global.ownerIds.length > 0) {
    conditions.push(sqlInNumbers(activitiesTable.ownerId, global.ownerIds));
    applied.push(`Owner is any of ${global.ownerIds.join(", ")}`);
  }

  // Everything deal-shaped narrows to activities on matching deals.
  const dealSide: SQL[] = [];
  let dealSideNeedsOrgJoin = false;

  if (global.pipelineIds && global.pipelineIds.length > 0) {
    dealSide.push(sqlInNumbers(dealsTable.pipelineId, global.pipelineIds));
    applied.push(`Deal pipeline is any of ${global.pipelineIds.join(", ")}`);
  }
  if (global.statuses && global.statuses.length > 0) {
    const statuses = global.statuses.filter((s) => BOARD_STATUSES.has(s));
    if (statuses.length > 0) {
      dealSide.push(sqlInStrings(sql`${dealsTable.status}::text`, statuses));
      applied.push(`Deal status is any of ${statuses.join(", ")}`);
    }
  }
  if (global.qualification) {
    dealSide.push(qualificationCondition(catalog, global.qualification));
    applied.push(`Deal qualification is ${global.qualification}`);
  }
  if (global.filters) {
    const group = decodeBoardFilters(global.filters);
    const compiled = compileExtendedGroup(group, catalog);
    if (compiled.where) {
      dealSide.push(compiled.where);
      dealSideNeedsOrgJoin = compiled.needsOrgJoin;
      applied.push(
        `${countConditions(group as FilterGroup)} board condition(s) (via linked deal)`,
      );
    }
  }
  if (dealSide.length > 0) {
    // The organizations join inside the subquery shadows any outer join, so
    // an "organization" board condition binds to the DEAL's org here.
    const orgJoin = dealSideNeedsOrgJoin
      ? sql` left join ${organizationsTable} on ${dealsTable.organizationId} = ${organizationsTable.id}`
      : sql``;
    conditions.push(
      sql`exists (select 1 from ${dealsTable}${orgJoin} where ${dealsTable.id} = ${activitiesTable.dealId} and ${dealsTable.archived} = false and ${dealsTable.status} <> 'deleted' and ${sql.join(dealSide, sql` and `)})`,
    );
  }

  if (global.dateRange && (global.dateRange.from || global.dateRange.to)) {
    const basis = global.dateRange.basis ?? spec.dateBasis ?? "createdAt";
    const expr = ACTIVITY_DATE_BASIS_COLUMNS[basis];
    if (!expr) {
      throw new InsightsQueryError(
        `Date basis "${basis}" is not supported for activities`,
      );
    }
    applied.push(pushDateRange(conditions, expr, global.dateRange, basis));
  }

  return { conditions, applied };
}

// ---------------------------------------------------------------------------
// The `performance` report: count × viewBy (× segmentBy), the app time zone
// bucketing — same result contract as the deals report.
// ---------------------------------------------------------------------------

interface Dimension {
  expr: SQL;
  labelExpr?: SQL;
  needsOwnerJoin?: boolean;
}

const ACTIVITY_DATE_FIELD_KEYS = new Set(["dueDate", "doneAt", "createdAt"]);

function resolveActivityDimension(
  fieldKey: string,
  dateBucket: string | undefined,
): Dimension {
  assertDateBucket(dateBucket);
  if (isCustomFieldRef(fieldKey)) {
    throw new InsightsQueryError(
      `Custom fields are not available for activities: ${fieldKey}`,
    );
  }
  const def = ACTIVITIES_NATIVE_BY_KEY.get(fieldKey);
  const col = ACTIVITY_COLUMNS[fieldKey];
  if (!def || !def.groupable || !col) {
    throw new InsightsQueryError(`Unknown grouping field: ${fieldKey}`);
  }

  if (ACTIVITY_DATE_FIELD_KEYS.has(fieldKey)) {
    const bucket = dateBucket ?? "month";
    const base =
      fieldKey === "dueDate"
        ? sql`${col}`
        : sql`${col} AT TIME ZONE ${appTzSql()}`;
    return { expr: bucketDate(bucket, base) };
  }
  if (dateBucket) {
    throw new InsightsQueryError(
      `Field "${fieldKey}" is not a date; dateBucket does not apply`,
    );
  }
  if (fieldKey === "owner") {
    return {
      expr: sql`${activitiesTable.ownerId}`,
      labelExpr: sql`${usersTable.name}`,
      needsOwnerJoin: true,
    };
  }
  if (fieldKey === "type") {
    return { expr: sql`${col}::text` };
  }
  if (fieldKey === "done") {
    return {
      expr: sql`${col}`,
      labelExpr: sql`case when ${col} then 'Done' else 'To do' end`,
    };
  }
  return { expr: sql`${col}` };
}

export async function runActivitiesPerformance(
  spec: WidgetSpec,
  global: GlobalFilters | null | undefined,
): Promise<PerformanceResult> {
  // Validate the cheap, DB-free parts first so a bad spec fails fast.
  if (spec.measure.agg !== "count") {
    throw new InsightsQueryError(
      `Aggregation "${spec.measure.agg}" is not available for activities: use count`,
    );
  }
  if (spec.dateBasis && !ACTIVITY_DATE_BASIS_COLUMNS[spec.dateBasis]) {
    throw new InsightsQueryError(
      `Date basis "${spec.dateBasis}" is not supported for activities`,
    );
  }
  const sortTarget = resolveSortTarget(spec);

  // Drafts are private to their creator everywhere else in the app
  // (routes/activities.ts, search, the assistant), so a report must never
  // count them, group by their subject or let a note filter probe their text.
  const conditions: SQL[] = [sql`${activitiesTable.draft} = false`];
  const widgetApplied: string[] = [];
  const widgetFilter = compileActivitiesGroup(spec.filters);
  if (widgetFilter.where) {
    conditions.push(widgetFilter.where);
    widgetApplied.push(
      `${countConditions(spec.filters as FilterGroup)} widget condition(s)`,
    );
  }

  // The catalog only serves board deal-side filters (qualification / the
  // board Add-filter group); it is cached, so the load is effectively free.
  const catalog = await loadDealsFieldCatalog();
  const board = compileActivitiesGlobalFilters(global, spec, catalog);
  conditions.push(...board.conditions);

  const viewDim = spec.viewBy
    ? resolveActivityDimension(spec.viewBy.field, spec.viewBy.dateBucket)
    : undefined;
  const segDim = spec.segmentBy
    ? resolveActivityDimension(spec.segmentBy.field, undefined)
    : undefined;

  const joinClauses: SQL[] = [];
  if (viewDim?.needsOwnerJoin || segDim?.needsOwnerJoin) {
    joinClauses.push(sql`left join ${usersTable} on ${activitiesTable.ownerId} = ${usersTable.id}`);
  }
  if (widgetFilter.needsOrgJoin) {
    joinClauses.push(sql`left join ${organizationsTable} on ${activitiesTable.orgId} = ${organizationsTable.id}`);
  }

  return runPerformanceReport({
    scope: "activities",
    from: sql`${activitiesTable}`,
    joins: joinClauses,
    conditions,
    viewDim,
    segDim,
    measure: sql`count(*)`,
    sortTarget,
    cap: Math.min(spec.limit ?? ROW_CAP, ROW_CAP),
    appliedFilters: { board: board.applied, widget: widgetApplied },
  });
}
