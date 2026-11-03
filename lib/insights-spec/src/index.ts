import { z } from "zod";
import {
  extendedFilterGroupSchema,
  type ExtendedFilterGroup,
  EMPTY_EXTENDED_FILTER,
} from "@workspace/deals-filter";

// ---------------------------------------------------------------------------
// Widget-query spec for the Insights tab.
//
// A widget is pure config: this spec plus a viz descriptor. The server owns
// compilation — one compiler per scope maps allow-listed field names to real
// columns via Drizzle SQL. Field names in `measure`/`viewBy`/
// `segmentBy`/`sort` are validated against the per-scope allow-list at compile
// time and never interpolated from client input. Graph-level `filters` reuse
// the shared deals-filter DSL (extended form: native fields + `cf:<key>`
// registry fields); the board's global filters are intersected server-side —
// board ∩ widget narrows, never widens.
//
// `version` is stored with the widget; migrate-on-read keeps old JSONB alive.
// ---------------------------------------------------------------------------

export const WIDGET_SPEC_VERSION = 1;

export const INSIGHTS_SCOPES = [
  "deals",
  "activities",
  "organizations",
] as const;
export type InsightsScope = (typeof INSIGHTS_SCOPES)[number];

export const REPORT_TYPES = [
  "performance",
  "conversionFunnel",
  "conversionWinLoss",
  "duration",
  "progress",
  "timeToFirstActivity",
  "table",
  "pivot",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const MEASURE_AGGS = [
  "count",
  "sum",
  "avg",
  "median",
  "p25",
  "p75",
  "min",
  "max",
] as const;
export type MeasureAgg = (typeof MEASURE_AGGS)[number];

export const DATE_BUCKETS = ["day", "week", "month", "quarter"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const DATE_BASES = [
  "createdAt",
  "closedAt",
  "wonAt",
  "lostAt",
  "enteredStageAt",
  "activityDoneAt",
] as const;
export type DateBasis = (typeof DATE_BASES)[number];

// Field names are allow-list keys, not SQL: native column keys or `cf:<key>`
// registry refs. The compiler rejects anything outside the scope's list.
const fieldName = z.string().min(1).max(140);

export const measureSchema = z.object({
  field: fieldName,
  agg: z.enum(MEASURE_AGGS),
});
export type Measure = z.infer<typeof measureSchema>;

export const viewBySchema = z.object({
  field: fieldName,
  dateBucket: z.enum(DATE_BUCKETS).optional(),
});
export type ViewBy = z.infer<typeof viewBySchema>;

export const segmentBySchema = z.object({ field: fieldName });
export type SegmentBy = z.infer<typeof segmentBySchema>;

export const gaugeBandsSchema = z.object({
  red: z.number(),
  yellow: z.number(),
  green: z.number(),
});
export type GaugeBands = z.infer<typeof gaugeBandsSchema>;

export const agingOptionsSchema = z.object({
  metric: z.enum(["inStage", "inPipeline", "both"]),
  thresholdDays: z.number().int().positive(),
  // Per-stage overrides, keyed by stage id (stringified — JSON object keys).
  perStage: z.record(z.string(), z.number().int().positive()).optional(),
});
export type AgingOptions = z.infer<typeof agingOptionsSchema>;

export const widgetOptionsSchema = z.object({
  goal: z.number().optional(),
  gaugeBands: gaugeBandsSchema.optional(),
  aging: agingOptionsSchema.optional(),
  hoursSplit: z.enum(["businessHours", "afterHours", "both"]).optional(),
  weighting: z.enum(["stageProbability"]).optional(),
  topN: z.number().int().positive().max(100).optional(),
});
export type WidgetOptions = z.infer<typeof widgetOptionsSchema>;

export const sortSchema = z.object({
  field: fieldName,
  direction: z.enum(["asc", "desc"]),
});
export type SpecSort = z.infer<typeof sortSchema>;

export const widgetSpecSchema = z.object({
  version: z.literal(WIDGET_SPEC_VERSION),
  scope: z.enum(INSIGHTS_SCOPES),
  reportType: z.enum(REPORT_TYPES),
  measure: measureSchema,
  viewBy: viewBySchema.optional(),
  segmentBy: segmentBySchema.optional(),
  // Graph-level filters. Always present (may be empty); board-level filters
  // are supplied separately at query time and intersected by the server.
  filters: extendedFilterGroupSchema,
  dateBasis: z.enum(DATE_BASES).optional(),
  options: widgetOptionsSchema.optional(),
  limit: z.number().int().positive().max(1000).optional(),
  sort: sortSchema.optional(),
});
export type WidgetSpec = z.infer<typeof widgetSpecSchema>;

export const EMPTY_SPEC_FILTERS: ExtendedFilterGroup = EMPTY_EXTENDED_FILTER;

/**
 * Parse a stored JSONB spec, upgrading old versions in memory (never in
 * bulk in the DB). v1 is the only version so far, so this is the seam where
 * future migrations slot in.
 */
export function migrateSpec(raw: unknown): WidgetSpec {
  return widgetSpecSchema.parse(raw);
}

// Visualization descriptor — presentation only, orthogonal to the query spec.
export const VIZ_TYPES = [
  "bar",
  "horizontalBar",
  "line",
  "area",
  "pie",
  "funnel",
  "waterfall",
  "gauge",
  "singleNumber",
  "table",
  "pivot",
] as const;
export type VizType = (typeof VIZ_TYPES)[number];

export const widgetVizSchema = z.object({
  type: z.enum(VIZ_TYPES),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type WidgetViz = z.infer<typeof widgetVizSchema>;
