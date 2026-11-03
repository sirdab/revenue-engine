import type { ExtendedFilterGroup } from "@workspace/deals-filter";
import type { WidgetSpec, WidgetViz } from "@workspace/insights-spec";

// ---------------------------------------------------------------------------
// Starter dashboard content (P1: examples, not limits) — seeded server-side
// in ONE transaction (POST /insights/dashboards/starter) so a mid-seed
// failure can never strand a half-built board. Leads with a KPI row — a
// briefing, then the detail.
// ---------------------------------------------------------------------------

function spec(partial: Partial<WidgetSpec>): WidgetSpec {
  return {
    version: 1,
    scope: "deals",
    reportType: "performance",
    measure: { field: "id", agg: "count" },
    filters: { combinator: "and", conditions: [] },
    ...partial,
  };
}

const OPEN_ONLY: ExtendedFilterGroup = {
  combinator: "and",
  conditions: [{ field: "status", operator: "is", value: "open" }],
};
const WON_ONLY: ExtendedFilterGroup = {
  combinator: "and",
  conditions: [{ field: "status", operator: "is", value: "won" }],
};
const LOST_ONLY: ExtendedFilterGroup = {
  combinator: "and",
  conditions: [{ field: "status", operator: "is", value: "lost" }],
};

export interface StarterWidget {
  name: string;
  spec: WidgetSpec;
  viz: WidgetViz;
  w: number;
  h: number;
}

export const STARTER_DASHBOARD_NAME = "Overview";

export const STARTER_WIDGETS: StarterWidget[] = [
  {
    name: "Open pipeline value",
    spec: spec({ measure: { field: "value", agg: "sum" }, filters: OPEN_ONLY }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Active deals",
    spec: spec({ filters: OPEN_ONLY }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Won value",
    spec: spec({
      measure: { field: "value", agg: "sum" },
      filters: WON_ONLY,
      dateBasis: "wonAt",
    }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Avg deal value",
    spec: spec({ measure: { field: "value", agg: "avg" } }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Pipeline funnel: stage conversion",
    spec: spec({ reportType: "conversionFunnel" }),
    viz: { type: "funnel" },
    w: 8,
    h: 3,
  },
  {
    name: "Value by stage",
    spec: spec({ measure: { field: "value", agg: "sum" }, viewBy: { field: "stage" } }),
    viz: { type: "horizontalBar" },
    w: 4,
    h: 3,
  },
  // Pipeline throughput row, directly under the funnel: what entered (by
  // created date), what leaked (value + count by LOST date), and how much
  // effort went in (activities). Bases matter — a board date range reads as
  // "created in window" vs "lost in window" per tile.
  {
    name: "Total value created",
    spec: spec({ measure: { field: "value", agg: "sum" }, dateBasis: "createdAt" }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Total value lost",
    spec: spec({
      measure: { field: "value", agg: "sum" },
      filters: LOST_ONLY,
      dateBasis: "lostAt",
    }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Lost deals",
    spec: spec({ filters: LOST_ONLY, dateBasis: "lostAt" }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Total activities",
    spec: spec({ scope: "activities" }),
    viz: { type: "singleNumber" },
    w: 3,
    h: 2,
  },
  {
    name: "Deal value by owner",
    spec: spec({ measure: { field: "value", agg: "sum" }, viewBy: { field: "owner" } }),
    viz: { type: "horizontalBar" },
    w: 4,
    h: 3,
  },
  {
    // Why deals die: lost deals ranked by reason. lostAt basis so a board
    // date range means "deals LOST in the window", not created.
    name: "Lost deals by reason",
    spec: spec({
      viewBy: { field: "lostReason" },
      filters: LOST_ONLY,
      dateBasis: "lostAt",
    }),
    viz: { type: "horizontalBar" },
    w: 4,
    h: 3,
  },
  {
    name: "Activities by type",
    spec: spec({ scope: "activities", viewBy: { field: "type" } }),
    viz: { type: "horizontalBar" },
    w: 4,
    h: 3,
  },
  {
    name: "Deals created by month",
    spec: spec({ viewBy: { field: "createdAt", dateBucket: "month" } }),
    viz: { type: "line" },
    w: 12,
    h: 3,
  },
  {
    name: "Won value by month",
    spec: spec({
      measure: { field: "value", agg: "sum" },
      viewBy: { field: "wonAt", dateBucket: "month" },
      filters: WON_ONLY,
    }),
    viz: { type: "area" },
    w: 6,
    h: 3,
  },
  {
    name: "Weekly deals by status",
    spec: spec({
      viewBy: { field: "createdAt", dateBucket: "week" },
      segmentBy: { field: "status" },
    }),
    viz: { type: "bar" },
    w: 6,
    h: 3,
  },
  {
    name: "Activities completed by week",
    spec: spec({
      scope: "activities",
      viewBy: { field: "doneAt", dateBucket: "week" },
      filters: {
        combinator: "and",
        conditions: [{ field: "done", operator: "is" as const, value: true }],
      },
      dateBasis: "activityDoneAt",
    }),
    viz: { type: "bar" },
    w: 12,
    h: 3,
  },
];

/** Pack sized entries row by row onto the 12-column grid — the same shape
 *  the client stores (react-grid-layout style items keyed by widget id). */
export function packLayout(
  entries: { i: string; w: number; h: number }[],
): { i: string; x: number; y: number; w: number; h: number }[] {
  const items: { i: string; x: number; y: number; w: number; h: number }[] = [];
  let x = 0;
  let y = 0;
  for (const e of entries) {
    if (x + e.w > 12) {
      x = 0;
      y += 1;
    }
    items.push({ i: e.i, x, y, w: e.w, h: e.h });
    x += e.w;
  }
  return items;
}
