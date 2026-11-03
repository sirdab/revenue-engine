import { addDays, format, isValid, parseISO } from "date-fns";
import { BUCKET_STEP, isDateBucket, isoDay } from "./insights-dates";
import {
  decodeExtendedFilters,
  encodeFilters,
  groupReferencesField,
  type ExtendedFilterGroup,
  type ExtendedFilterNode,
  type FilterFieldName,
  type FilterGroup,
  type FilterNode,
} from "@workspace/deals-filter";
import type {
  InsightsGlobalFilters,
  InsightsWidgetSpec,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Drill-through: a click on a chart mark becomes a /deals list URL showing
// exactly the records behind that mark (widget filters ∩ board filters ∩ the
// clicked dimension). The deals list validates against the BASE filter DSL
// (11 native fields), so insights-only vocabulary (cf:<key>, lostAt, UTM
// source, …) cannot carry over — those conditions are dropped and reported,
// and a click whose OWN dimension can't be expressed doesn't drill at all
// (a link that lies about what was clicked is worse than no link).
// ---------------------------------------------------------------------------

/** Insights field key → base deals-filter DSL field. Anything absent here is
 *  not expressible in the deals list URL. Base names map to themselves so
 *  filters written in either vocabulary survive. */
const BASE_FIELD: Record<string, FilterFieldName> = {
  owner: "owner",
  pipeline: "pipeline",
  stage: "stage",
  status: "status",
  value: "value",
  title: "title",
  organization: "organization",
  utmKeyword: "utmKeyword",
  lostReason: "lostReason",
  createdAt: "createdDate",
  wonAt: "wonTime",
  createdDate: "createdDate",
  wonTime: "wonTime",
};

const ID_FIELDS = new Set<FilterFieldName>(["owner", "pipeline", "stage"]);
const DATE_FIELDS = new Set<FilterFieldName>(["createdDate", "wonTime"]);

export interface DrillDimension {
  /** Insights field key (spec.viewBy / spec.segmentBy vocabulary). */
  field: string;
  /** RAW x/segment value from the query result: id, ISO date, text, or null. */
  value: unknown;
  dateBucket?: string;
}

export interface DrillClick {
  x?: DrillDimension;
  segment?: DrillDimension;
}

export interface DrillResult {
  url: string;
  /** Insights field keys of conditions that could not carry over. */
  dropped: string[];
}

/** Whether clicks on this widget can drill at all: deals performance report
 *  whose click dimensions are expressible in the base DSL. */
export function canDrillSpec(spec: InsightsWidgetSpec): boolean {
  if (spec.scope !== "deals" || spec.reportType !== "performance") return false;
  if (spec.viewBy && !BASE_FIELD[spec.viewBy.field]) return false;
  if (spec.segmentBy && !BASE_FIELD[spec.segmentBy.field]) return false;
  return true;
}

function isGroupNode(node: ExtendedFilterNode): node is ExtendedFilterGroup {
  return (node as ExtendedFilterGroup).combinator !== undefined;
}

function conditionFields(group: ExtendedFilterGroup): string[] {
  const out: string[] = [];
  for (const node of group.conditions) {
    if (isGroupNode(node)) out.push(...conditionFields(node));
    else out.push(node.field);
  }
  return out;
}

/** Map an extended filter tree onto the base DSL. Unmappable conditions are
 *  dropped from AND groups (the result widens to a superset — safe); an OR
 *  group with any unmappable branch is dropped whole, because losing one
 *  branch would silently narrow what the user asked for. */
function mapNode(node: ExtendedFilterNode): {
  node: FilterNode | null;
  dropped: string[];
} {
  if (isGroupNode(node)) {
    const results = node.conditions.map(mapNode);
    const dropped = results.flatMap((r) => r.dropped);
    if (node.combinator === "or" && dropped.length > 0) {
      return { node: null, dropped: [...new Set(conditionFields(node))] };
    }
    const kept = results
      .map((r) => r.node)
      .filter((n): n is FilterNode => n !== null);
    return {
      node:
        kept.length > 0 ? { combinator: node.combinator, conditions: kept } : null,
      dropped,
    };
  }
  const mapped = BASE_FIELD[node.field];
  if (!mapped) return { node: null, dropped: [node.field] };
  return {
    node: { field: mapped, operator: node.operator, value: node.value },
    dropped: [],
  };
}

/** One clicked dimension → a base condition, or null when inexpressible. */
function dimensionCondition(dim: DrillDimension): FilterNode | null {
  const mapped = BASE_FIELD[dim.field];
  if (!mapped) return null;
  if (dim.value == null || dim.value === "(empty)") {
    return { field: mapped, operator: "is_empty" };
  }
  if (DATE_FIELDS.has(mapped)) {
    const day = isoDay(dim.value);
    const start = day ? parseISO(day) : null;
    if (!start || !isValid(start)) return null;
    const bucket = isDateBucket(dim.dateBucket) ? dim.dateBucket : "month";
    const end = addDays(BUCKET_STEP[bucket](start), -1);
    return {
      field: mapped,
      operator: "between",
      value: [format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd")],
    };
  }
  if (ID_FIELDS.has(mapped)) {
    const n = Number(dim.value);
    if (!Number.isFinite(n)) return null;
    return { field: mapped, operator: "is", value: n };
  }
  return { field: mapped, operator: "is", value: String(dim.value) };
}

function orGroup(
  field: FilterFieldName,
  values: (string | number)[],
): FilterNode {
  if (values.length === 1) return { field, operator: "is", value: values[0] };
  return {
    combinator: "or",
    conditions: values.map((v) => ({ field, operator: "is", value: v })),
  };
}

export function buildDealsDrillUrl(
  spec: InsightsWidgetSpec,
  global: InsightsGlobalFilters | undefined,
  click: DrillClick,
): DrillResult | null {
  if (spec.scope !== "deals" || spec.reportType !== "performance") return null;

  const conditions: FilterNode[] = [];
  const dropped: string[] = [];

  // The clicked dimensions must map exactly — otherwise the drill would show
  // a superset while claiming to show the clicked mark.
  for (const dim of [click.x, click.segment]) {
    if (!dim) continue;
    const cond = dimensionCondition(dim);
    if (!cond) return null;
    conditions.push(cond);
  }

  // Widget-level filters.
  const widgetFilters = spec.filters as unknown as ExtendedFilterGroup;
  if (widgetFilters?.conditions?.length) {
    const mapped = mapNode(widgetFilters);
    if (mapped.node) conditions.push(mapped.node);
    dropped.push(...mapped.dropped);
  }

  // Board-level quick filters + Add-filter group.
  if (global?.ownerIds?.length) conditions.push(orGroup("owner", global.ownerIds));
  if (global?.pipelineIds?.length)
    conditions.push(orGroup("pipeline", global.pipelineIds));
  if (global?.statuses?.length) conditions.push(orGroup("status", global.statuses));
  if (global?.filters) {
    try {
      const mapped = mapNode(decodeExtendedFilters(global.filters));
      if (mapped.node) conditions.push(mapped.node);
      dropped.push(...mapped.dropped);
    } catch {
      // Malformed board filter: nothing to carry; the widget query itself
      // would have failed loudly before any drill.
    }
  }
  if (global?.dateRange && (global.dateRange.from || global.dateRange.to)) {
    const basis = global.dateRange.basis ?? spec.dateBasis ?? "createdAt";
    const mapped = BASE_FIELD[basis];
    const from = isoDay(global.dateRange.from);
    const to = isoDay(global.dateRange.to);
    if (mapped && DATE_FIELDS.has(mapped)) {
      if (from && to) {
        conditions.push({ field: mapped, operator: "between", value: [from, to] });
      } else if (from) {
        // The base DSL's date gt/lt are strict; >= from ≡ > (from − 1 day)
        // because comparisons run on ::date.
        conditions.push({
          field: mapped,
          operator: "gt",
          value: format(addDays(parseISO(from), -1), "yyyy-MM-dd"),
        });
      } else if (to) {
        conditions.push({
          field: mapped,
          operator: "lt",
          value: format(addDays(parseISO(to), 1), "yyyy-MM-dd"),
        });
      }
    } else {
      dropped.push(basis);
    }
  }

  // Parity with the insights universe (open+won+lost): the deals list
  // defaults to open-only unless the filter tree references status.
  const root: FilterGroup = { combinator: "and", conditions };
  if (!groupReferencesField(root, "status")) {
    conditions.push(orGroup("status", ["open", "won", "lost"]));
  }

  return {
    url: `/deals?view=list&filters=${encodeFilters(root)}`,
    dropped: [...new Set(dropped)],
  };
}
