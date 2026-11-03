import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  LabelList,
} from "recharts";
import type {
  InsightsQueryResult,
  InsightsWidgetSpec,
  InsightsWidgetViz,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import type { DrillClick } from "./insights-drill";
import {
  BUCKET_STEP,
  isDateBucket,
  parseDateX,
  type DateBucket,
} from "./insights-dates";
import { useI18n, tStatic } from "@/lib/i18n/i18n";
import { getActiveLocale } from "@/lib/i18n/active-locale";
import { formatNumber as intlNumber, intlDateTag } from "@/lib/i18n/formatting";
import { formatMonthYear } from "@/lib/format";

// ---------------------------------------------------------------------------
// Chart theme — palette validated with the dataviz six-checks script:
//  categorical: worst adjacent CVD ΔE 36.6 (target ≥12) on white
//  funnel ordinal ramp: monotone teal, ΔL ≥ 0.06 steps, light end ≥2:1
// Categorical hues are assigned in FIXED order, never cycled; series beyond
// the 6th fold into "Other". Status series (won/lost/open) use reserved
// semantic colors keyed by entity so filtering never repaints them.
// ---------------------------------------------------------------------------

const CATEGORICAL = [
  "#0d9488", // teal (brand)
  "#4a3aa7", // violet
  "#eda100", // yellow (relief rule: tooltip + labels carry identity)
  "#2a78d6", // blue
  "#e87ba4", // magenta
  "#e34948", // red
];
const MAX_SERIES = CATEGORICAL.length;

const FUNNEL_RAMP = [
  "#6cc3b6",
  "#3fab9c",
  "#189181",
  "#0c7a6a",
  "#086253",
  "#054a3e",
];

// Reserved status colors — state, not identity; keyed, never positional.
const STATUS_COLORS: Record<string, string> = {
  won: "#0ca30c",
  lost: "#d03b3b",
  open: "#2a78d6",
};

const INK = {
  primary: "#0f172a",
  secondary: "#475569",
  muted: "#94a3b8",
  grid: "#eef0f4",
  baseline: "#cbd5e1",
  surface: "#ffffff",
  goal: "#7c3aed",
};

const OTHER_KEY = "__other__";
// Injected series key for the previous-period comparison overlay.
const PREV_KEY = "__prev__";

// Viz types with an actual renderer below ("funnel" has its own early
// branch). Keep in sync when a new chart lands.
const RENDERABLE_VIZ = new Set<string>([
  "bar",
  "horizontalBar",
  "line",
  "area",
  "pie",
  "singleNumber",
  "table",
]);

// Per-widget presentation knobs stored in viz.options (presentation only —
// orthogonal to the query spec, so no server/codegen involvement).
export interface VizOptions {
  /** Direct value labels on marks. Defaults on for bars/pie, off for lines. */
  showValues?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  /** Single-series accent; must be one of the validated categorical hues. */
  color?: string;
  /** Overlay the same measure for the preceding period (time series only;
   *  takes effect when the board has a bounded date range). */
  compare?: boolean;
}

const CATEGORICAL_SET = new Set(CATEGORICAL);

export function readVizOptions(viz: InsightsWidgetViz): VizOptions {
  const raw = (viz.options ?? {}) as Record<string, unknown>;
  return {
    showValues: typeof raw.showValues === "boolean" ? raw.showValues : undefined,
    showLegend: typeof raw.showLegend === "boolean" ? raw.showLegend : undefined,
    showGrid: typeof raw.showGrid === "boolean" ? raw.showGrid : undefined,
    color:
      typeof raw.color === "string" && CATEGORICAL_SET.has(raw.color)
        ? raw.color
        : undefined,
    compare: typeof raw.compare === "boolean" ? raw.compare : undefined,
  };
}

export const ACCENT_CHOICES = CATEGORICAL;

export function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

function formatValue(v: number, monetary: boolean): string {
  return monetary ? tStatic("common.sarAmount", { amount: formatCompact(v) }) : formatCompact(v);
}

function formatExact(v: number, monetary: boolean): string {
  const n = intlNumber(getActiveLocale(), v, { maximumFractionDigits: 1 });
  return monetary ? tStatic("common.sarAmount", { amount: n }) : n;
}

interface Point {
  x: string;
  /** RAW x from the query (id / ISO date / text / null) — the drill-through
   *  identity. Absent on synthesized points (gap fills, "Other" folds),
   *  which therefore don't drill. */
  __x?: unknown;
  [seriesKey: string]: unknown;
}

interface SeriesKey {
  key: string;
  label: string;
}

/** Sort by magnitude and split at `cap`: when folding is needed, `keep`
 *  holds the top cap-1 items and `fold` the tail destined for an "Other"
 *  bucket (never generate a 7th hue / a 25th row / a 7th slice). */
function splitTopN<T>(
  items: T[],
  cap: number,
  valueOf: (item: T) => number,
): { keep: T[]; fold: T[] } {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  if (sorted.length <= cap) return { keep: sorted, fold: [] };
  return { keep: sorted.slice(0, cap - 1), fold: sorted.slice(cap - 1) };
}

/** Pivot the API's per-series rows into recharts' per-x rows; fold series
 *  past the palette ceiling into "Other" (never generate a 7th hue). */
function toChartData(result: InsightsQueryResult): {
  data: Point[];
  seriesKeys: SeriesKey[];
} {
  let series = (result.series ?? []).map((s) => ({
    key: s.key,
    label: s.label ?? (s.key === "value" || s.key === "deals" ? "" : s.key),
    data: s.data as { x?: unknown; xLabel?: unknown; y?: unknown }[],
  }));

  // Sort only when folding: under the cap the server order is kept so the
  // positional hues stay stable as data shifts.
  if (series.length > MAX_SERIES) {
    const { keep, fold } = splitTopN(series, MAX_SERIES, (s) =>
      s.data.reduce((acc, d) => acc + (typeof d.y === "number" ? d.y : 0), 0),
    );
    const otherByX = new Map<string, number>();
    for (const s of fold) {
      for (const d of s.data) {
        const x = xOf(d);
        otherByX.set(x, (otherByX.get(x) ?? 0) + (typeof d.y === "number" ? d.y : 0));
      }
    }
    series = [
      ...keep,
      {
        key: OTHER_KEY,
        label: tStatic("insights.chart.other", { count: fold.length }),
        data: [...otherByX.entries()].map(([x, y]) => ({ x, y })),
      },
    ];
  }

  const byX = new Map<string, Point>();
  for (const s of series) {
    for (const d of s.data) {
      const x = xOf(d);
      const point =
        byX.get(x) ??
        (s.key === OTHER_KEY
          ? { x }
          : { x, __x: (d as { x?: unknown }).x ?? null });
      point[s.key] = typeof d.y === "number" ? d.y : null;
      byX.set(x, point);
    }
  }
  return {
    data: [...byX.values()],
    seriesKeys: series.map(({ key, label }) => ({ key, label: label || key })),
  };
}

function xOf(d: { x?: unknown; xLabel?: unknown }): string {
  if (d.xLabel != null) return String(d.xLabel);
  return d.x != null ? String(d.x) : "(empty)";
}

// ---------------------------------------------------------------------------
// Date-bucket shaping: gap-fill missing buckets and format tick labels per
// bucket, so a quiet month reads as zero instead of silently disappearing.
// ---------------------------------------------------------------------------

// Tick labels in the active language through Intl; a quarter has no Intl
// format, so it is assembled from a message.
function bucketTick(d: Date, bucket: DateBucket): string {
  const tag = intlDateTag(getActiveLocale());
  switch (bucket) {
    case "day":
    case "week":
      return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(d);
    case "month":
      return new Intl.DateTimeFormat(tag, { month: "short", year: "2-digit" }).format(d);
    case "quarter":
      return tStatic("insights.chart.quarterTick", {
        q: Math.floor(d.getMonth() / 3) + 1,
        yy: new Intl.DateTimeFormat(tag, { year: "2-digit" }).format(d),
      });
  }
}

/** Sort by date, fill gaps, and replace ISO keys with human tick labels.
 *  Fills with 0 for additive measures (count/sum); leaves holes for the rest
 *  (an average over nothing is unknown, not zero). */
function shapeDateSeries(
  data: Point[],
  seriesKeys: SeriesKey[],
  bucket: DateBucket,
  additive: boolean,
): Point[] {
  const dated = data
    .map((p) => ({ p, d: parseDateX(p.x) }))
    .filter((e): e is { p: Point; d: Date } => e.d !== null)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  if (dated.length === 0) return data;

  const out: Point[] = [];
  const step = BUCKET_STEP[bucket];
  let cursor = dated[0].d;
  let i = 0;
  // Hard stop keeps a pathological range (bad data) from spinning forever.
  for (let guard = 0; guard < 1000 && i < dated.length; guard++) {
    const next = dated[i];
    if (next.d.getTime() <= cursor.getTime()) {
      out.push({ ...next.p, x: bucketTick(next.d, bucket) });
      cursor = step(next.d);
      i++;
    } else {
      const filler: Point = { x: bucketTick(cursor, bucket) };
      for (const s of seriesKeys) filler[s.key] = additive ? 0 : null;
      out.push(filler);
      cursor = step(cursor);
    }
  }
  return out;
}

/** Categorical shaping: order by magnitude and fold the tail into "Other"
 *  past `cap` rows, so a 40-category bar chart stays readable. */
function shapeCategorical(
  data: Point[],
  seriesKeys: SeriesKey[],
  cap: number,
): Point[] {
  const { keep, fold } = splitTopN(data, cap, (p) =>
    seriesKeys.reduce(
      (acc, s) => acc + (typeof p[s.key] === "number" ? (p[s.key] as number) : 0),
      0,
    ),
  );
  if (fold.length === 0) return keep;
  const other: Point = { x: `Other (${fold.length})` };
  for (const s of seriesKeys) {
    other[s.key] = fold.reduce(
      (acc, p) => acc + (typeof p[s.key] === "number" ? (p[s.key] as number) : 0),
      0,
    );
  }
  return [...keep, other];
}

/** Read viz-shaping hints out of the (loosely typed) stored spec. */
function specHints(spec: InsightsWidgetSpec | undefined): {
  dateBucket?: DateBucket;
  additive: boolean;
  goal?: number;
  topN?: number;
} {
  const bucket = spec?.viewBy?.dateBucket;
  const agg = spec?.measure.agg;
  const options = (spec?.options ?? {}) as { goal?: unknown; topN?: unknown };
  return {
    dateBucket: isDateBucket(bucket) ? bucket : undefined,
    additive: agg === "count" || agg === "sum",
    goal: typeof options.goal === "number" ? options.goal : undefined,
    topN: typeof options.topN === "number" ? options.topN : undefined,
  };
}

/** Color follows the entity: status keys get their reserved colors; anything
 *  else takes the categorical slot for its (stable) series position. */
function seriesColor(key: string, index: number): string {
  if (key === OTHER_KEY) return INK.muted;
  return STATUS_COLORS[key] ?? CATEGORICAL[index % MAX_SERIES];
}

function ChartTooltip({
  active,
  payload,
  label,
  monetary,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  monetary: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md"
      style={{ fontSize: 12 }}
    >
      {label != null && label !== "" && (
        <div className="mb-1 font-medium text-slate-700">{label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-slate-600">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          {p.name && p.name !== "value" && p.name !== "deals" && (
            <span>{p.name}</span>
          )}
          <span className="ms-auto ps-3 font-semibold text-slate-900">
            {typeof p.value === "number" ? formatExact(p.value, monetary) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11, fill: INK.secondary };
const legendFormatter = (value: string): ReactNode => (
  <span style={{ color: INK.secondary, fontSize: 12 }}>{value}</span>
);

function goalLine(goal: number | undefined, axis: "x" | "y") {
  if (goal == null) return null;
  return (
    <ReferenceLine
      {...(axis === "y" ? { y: goal } : { x: goal })}
      stroke={INK.goal}
      strokeDasharray="6 4"
      strokeWidth={1.5}
      ifOverflow="extendDomain"
      label={{
        value: tStatic("insights.chart.goal", { value: formatCompact(goal) }),
        position: axis === "y" ? "insideTopRight" : "insideTopLeft",
        fill: INK.goal,
        fontSize: 10,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Funnel — vertical columns, stages left→right (plain HTML). Bottom-anchored
// bars wear the ordinal teal ramp; stage-to-stage conversion sits in the gap
// between columns; win-rate headline from meta. Columns follow the mark spec:
// ≤24px thick, 4px rounded data-end, square at the baseline, labels in ink.
// ---------------------------------------------------------------------------

function FunnelChart({
  result,
  monetary,
}: {
  result: InsightsQueryResult;
  monetary: boolean;
}) {
  const { t } = useI18n();
  type FunnelDatum = {
    x?: unknown;
    y?: unknown;
    entered?: unknown;
    conversion?: unknown;
  };
  const data = ((result.series?.[0]?.data ?? []) as FunnelDatum[]).map((d) => ({
    stage: String(d.x ?? ""),
    value: typeof d.y === "number" ? d.y : 0,
    entered: typeof d.entered === "number" ? d.entered : 0,
    conversion: typeof d.conversion === "number" ? d.conversion : null,
  }));
  const max = Math.max(1, ...data.map((d) => d.value));
  const headline = result.meta.headline;
  const rampAt = (i: number) =>
    FUNNEL_RAMP[
      Math.min(
        FUNNEL_RAMP.length - 1,
        Math.floor((i / Math.max(1, data.length - 1)) * (FUNNEL_RAMP.length - 1)),
      )
    ];

  return (
    <div className="flex h-full flex-col">
      {headline && typeof headline.value === "number" && Number.isFinite(headline.value) && (
        <div className="mb-1 flex shrink-0 items-baseline justify-end gap-1.5 text-xs text-slate-500">
          {headline.label}
          <span className="text-sm font-semibold text-slate-900">
            {(headline.value * 100).toFixed(1)}%
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-stretch overflow-x-auto pt-1">
        {data.map((d, i) => {
          // Cap below 100% so the value label above the bar never clips.
          const pct = Math.max(2, (d.value / max) * 84);
          const conversion = i > 0 ? data[i - 1].conversion : null;
          return (
            <div key={d.stage} className="contents">
              {i > 0 && (
                <div
                  className="flex w-9 shrink-0 flex-col"
                  title={
                    conversion != null
                      ? t("insights.chart.continueTo", { pct: Math.round(conversion * 100), stage: d.stage })
                      : undefined
                  }
                >
                  <div className="flex min-h-0 flex-1 items-end justify-center pb-1">
                    <span className="whitespace-nowrap text-[10px] font-medium text-slate-400">
                      {conversion != null ? `${Math.round(conversion * 100)}%` : "—"}
                      {" →"}
                    </span>
                  </div>
                  {/* Spacer mirroring the stage-name row so the baseline runs unbroken. */}
                  <div className="mt-1.5 h-8 shrink-0 border-t border-slate-200" />
                </div>
              )}
              <div className="flex min-w-14 flex-1 flex-col">
                <div
                  className="relative min-h-0 flex-1"
                  title={`${d.stage}: ${formatExact(d.value, monetary)}`}
                >
                  <div
                    className="absolute inset-x-0 bottom-0 mx-auto w-6 max-w-full rounded-t"
                    style={{ height: `${pct}%`, background: rampAt(i) }}
                  />
                  <span
                    className="absolute inset-x-0 text-center text-[11px] font-semibold text-slate-700"
                    style={{ bottom: `calc(${pct}% + 3px)` }}
                  >
                    {formatValue(d.value, monetary)}
                  </span>
                </div>
                <div
                  dir="auto"
                  className="mt-1.5 line-clamp-2 h-8 shrink-0 border-t border-slate-200 px-0.5 pt-1 text-center text-[11px] leading-4 text-slate-600"
                  title={d.stage}
                >
                  {d.stage}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tile — the dataviz stat-tile contract: compact value, signed delta vs a
// named period (direction × up-is-good), 12-point sparkline in a de-emphasized
// tint of the accent. The widget title (card header) is the label.
// ---------------------------------------------------------------------------

export interface KpiTrend {
  points: { x: string; y: number | null }[];
  /** Fractional change, latest bucket vs previous (null when undefined). */
  deltaPct: number | null;
  periodLabel: string;
}

function KpiTile({
  total,
  monetary,
  goal,
  trend,
  accent,
  onOpen,
}: {
  total: number;
  monetary: boolean;
  goal?: number;
  trend?: KpiTrend | null;
  accent: string;
  /** Drill-through: open the records behind the number. */
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const progress = goal && goal > 0 ? Math.min(1, total / goal) : null;
  const delta = trend?.deltaPct ?? null;
  // Under half a percent reads as flat — show a neutral badge, not a trend.
  const flat = delta != null && Math.abs(delta) < 0.005;
  const up = delta != null && delta >= 0;
  // The sparkline buckets are months: give the tooltip the month name, and
  // the axis a data key — without one, recharts labels points by array index.
  const spark = (trend?.points ?? []).slice(-12).map((p) => {
    const d = parseDateX(p.x);
    return { x: d ? formatMonthYear(d) : p.x, y: p.y };
  });

  return (
    <div className="flex h-full flex-col justify-center px-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {/* A real button when it drills: keyboard focus + Enter for free. */}
        {onOpen ? (
          <button
            type="button"
            className="cursor-pointer text-4xl font-semibold tracking-tight text-slate-900 underline-offset-4 decoration-slate-300 hover:underline focus-visible:underline"
            title={t("insights.chart.seeDeals")}
            onClick={onOpen}
          >
            {formatValue(total, monetary)}
          </button>
        ) : (
          <span className="text-4xl font-semibold tracking-tight text-slate-900">
            {formatValue(total, monetary)}
          </span>
        )}
        {delta != null && (
          <span
            className={
              flat
                ? "inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500"
                : up
                  ? "inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700"
                  : "inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700"
            }
          >
            {flat ? null : up ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {flat ? "flat" : `${Math.abs(delta * 100).toFixed(1)}%`}
          </span>
        )}
      </div>
      {(Math.abs(total) >= 1000 || (delta != null && trend)) && (
        <div className="mt-0.5 text-xs text-slate-400">
          {Math.abs(total) >= 1000 ? formatExact(total, monetary) : ""}
          {delta != null && trend
            ? `${Math.abs(total) >= 1000 ? " · " : ""}${t("insights.chart.vsPeriod", { period: trend.periodLabel })}`
            : ""}
        </div>
      )}
      {spark.length >= 2 && (
        <div className="mt-2 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="x" hide />
              <Tooltip
                content={<ChartTooltip monetary={monetary} />}
                cursor={{ stroke: INK.baseline }}
              />
              <Area
                type="monotone"
                dataKey="y"
                name="value"
                stroke={accent}
                strokeWidth={2}
                fill={accent}
                fillOpacity={0.12}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 2, stroke: INK.surface }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {progress != null && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress * 100}%`,
                background: progress >= 1 ? STATUS_COLORS.won : INK.goal,
              }}
            />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {t("insights.chart.pctOfGoal", { pct: Math.round((total / (goal as number)) * 100), goal: formatValue(goal as number, monetary) })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar list — ranked categories as proportional inline bars (Tremor pattern).
// Denser and more legible than an axis chart for identity+magnitude; the
// value wears text ink, never the bar color.
// ---------------------------------------------------------------------------

function BarListChart({
  data,
  seriesKey,
  monetary,
  accent,
  onRowClick,
}: {
  data: Point[];
  seriesKey: string;
  monetary: boolean;
  accent: string;
  onRowClick?: (p: Point) => void;
}) {
  const values = data.map((p) =>
    typeof p[seriesKey] === "number" ? (p[seriesKey] as number) : 0,
  );
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 overflow-y-auto py-1">
      {data.map((p, i) => {
        const v = values[i];
        const other = p.x.startsWith("Other (");
        const clickable = onRowClick && "__x" in p;
        return (
          <div
            key={p.x}
            className={cn(
              "flex items-center gap-3",
              clickable && "cursor-pointer rounded-md hover:bg-slate-50",
            )}
            onClick={clickable ? () => onRowClick(p) : undefined}
          >
            <div className="relative h-7 min-w-0 flex-1">
              <div
                className="absolute inset-y-0 start-0 rounded-e"
                style={{
                  width: `${Math.max(1.5, (v / max) * 100)}%`,
                  background: other ? INK.muted : accent,
                  opacity: other ? 0.35 : 0.18,
                }}
              />
              <div
                className="absolute inset-y-0 start-0 w-0.5 rounded-full"
                style={{ background: other ? INK.muted : accent }}
              />
              <span
                dir="auto"
                className="absolute inset-y-0 start-2.5 flex max-w-[85%] items-center truncate text-xs font-medium text-slate-700"
                title={p.x}
              >
                {p.x}
              </span>
            </div>
            <span className="w-16 shrink-0 text-end text-xs font-semibold tabular-nums text-slate-900">
              {formatValue(v, monetary)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result table — the aggregated series as a scrollable data grid. Doubles as
// the "table" viz and as the raw view behind any chart.
// ---------------------------------------------------------------------------

function ResultTable({
  data,
  seriesKeys,
  monetary,
  onRowClick,
}: {
  data: Point[];
  seriesKeys: SeriesKey[];
  monetary: boolean;
  onRowClick?: (p: Point) => void;
}) {
  const { t } = useI18n();
  const showX = data.some((p) => p.x !== "");
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-slate-200 text-start text-slate-500">
            {showX && <th className="py-1.5 pe-3 font-medium"> </th>}
            {seriesKeys.map((s) => (
              <th key={s.key} className="py-1.5 pe-3 text-end font-medium">
                {s.label === "value" || s.label === "deals" ? t("common.value") : s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr
              key={i}
              className={cn(
                "border-b border-slate-100 last:border-0",
                onRowClick && "__x" in p && "cursor-pointer hover:bg-slate-50",
              )}
              onClick={
                onRowClick && "__x" in p ? () => onRowClick(p) : undefined
              }
            >
              {showX && (
                <td dir="auto" className="max-w-56 truncate py-1.5 pe-3 text-slate-700" title={p.x}>
                  {p.x}
                </td>
              )}
              {seriesKeys.map((s) => (
                <td key={s.key} className="py-1.5 pe-3 text-end font-medium text-slate-900 tabular-nums">
                  {typeof p[s.key] === "number"
                    ? formatExact(p[s.key] as number, monetary)
                    : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function WidgetChart({
  result,
  viz,
  monetary = false,
  spec,
  trend,
  onDrill,
  compare,
}: {
  result: InsightsQueryResult;
  viz: InsightsWidgetViz;
  monetary?: boolean;
  spec?: InsightsWidgetSpec;
  /** Companion monthly series for singleNumber tiles (delta + sparkline). */
  trend?: KpiTrend | null;
  /** Drill-through: present when a click on a mark can open the deals list. */
  onDrill?: (click: DrillClick) => void;
  /** Previous-period points (raw ISO x) for the comparison overlay. */
  compare?: { x: string; y: number | null }[] | null;
}) {
  const { t } = useI18n();
  if (viz.type === "funnel") {
    return <FunnelChart result={result} monetary={monetary} />;
  }

  // Enum values without a renderer (waterfall/gauge/pivot) fail visibly
  // instead of falling through to an accidental bar chart.
  if (!RENDERABLE_VIZ.has(viz.type)) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
        {t("insights.chart.unsupported", { type: viz.type })}
      </div>
    );
  }

  const hints = specHints(spec);
  const opts = readVizOptions(viz);
  const accent = opts.color ?? CATEGORICAL[0];
  const pivoted = toChartData(result);
  const seriesKeys = pivoted.seriesKeys;

  let data = pivoted.data;
  if (data.length > 0) {
    if (hints.dateBucket) {
      data = shapeDateSeries(data, seriesKeys, hints.dateBucket, hints.additive);
    } else if (viz.type !== "singleNumber" && data.some((p) => p.x !== "")) {
      // Categorical axes read largest-first; long tails fold into "Other".
      const cap = hints.topN ?? (viz.type === "table" ? Number.MAX_SAFE_INTEGER : 24);
      data = shapeCategorical(data, seriesKeys, Math.max(2, cap));
    }
  }

  // Previous-period overlay: align prev buckets to the current axis by
  // position (bucket 1 ↔ bucket 1), after both went through the same
  // gap-filling, so "this month vs same point last period" reads truthfully.
  let compareActive = false;
  if (
    compare &&
    compare.length > 0 &&
    hints.dateBucket &&
    seriesKeys.length === 1 &&
    (viz.type === "bar" || viz.type === "line" || viz.type === "area")
  ) {
    const prevShaped = shapeDateSeries(
      compare.map((d) => ({ x: d.x, [PREV_KEY]: d.y }) as Point),
      [{ key: PREV_KEY, label: t("insights.chart.previousPeriod") }],
      hints.dateBucket,
      hints.additive,
    );
    if (prevShaped.length > 0) {
      compareActive = true;
      data = data.map((p, i) => {
        const v = prevShaped[i]?.[PREV_KEY];
        return { ...p, [PREV_KEY]: typeof v === "number" ? v : null };
      });
    }
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        {t("insights.chart.noData")}
      </div>
    );
  }

  // A click on a mark → the records behind it. Synthesized points (gap
  // fills, "Other" folds) have no raw identity and don't drill.
  const drill =
    onDrill && spec
      ? (p: Point | undefined, seriesKey?: string) => {
          const click: DrillClick = {};
          if (spec.viewBy) {
            if (!p || !("__x" in p)) return;
            click.x = {
              field: spec.viewBy.field,
              value: p.__x,
              dateBucket: spec.viewBy.dateBucket,
            };
          }
          if (spec.segmentBy && seriesKey && seriesKey !== "value") {
            if (seriesKey === OTHER_KEY) return;
            click.segment = {
              field: spec.segmentBy.field,
              value: seriesKey === "(empty)" ? null : seriesKey,
            };
          }
          onDrill(click);
        }
      : undefined;

  if (viz.type === "singleNumber") {
    const total = seriesKeys.reduce(
      (sum, s) =>
        sum +
        data.reduce(
          (acc, p) => acc + (typeof p[s.key] === "number" ? (p[s.key] as number) : 0),
          0,
        ),
      0,
    );
    return (
      <KpiTile
        total={total}
        monetary={monetary}
        goal={hints.goal}
        trend={trend}
        accent={accent}
        onOpen={drill ? () => drill(undefined) : undefined}
      />
    );
  }

  if (viz.type === "table") {
    return (
      <ResultTable
        data={data}
        seriesKeys={seriesKeys}
        monetary={monetary}
        onRowClick={drill ? (p) => drill(p) : undefined}
      />
    );
  }

  const multiSeries = seriesKeys.length > 1;
  // Numbers on the graph: default on for pre-aggregated identity marks
  // (bars, pie); opt-in for time series where a label per point is noise.
  const showValues =
    opts.showValues ??
    (viz.type === "bar" || viz.type === "horizontalBar" || viz.type === "pie");
  const showLegend = (multiSeries || compareActive) && opts.showLegend !== false;
  const showGrid = opts.showGrid !== false;

  // Ranked single-series horizontals read best as a bar list.
  if (viz.type === "horizontalBar" && !multiSeries) {
    return (
      <BarListChart
        data={data}
        seriesKey={seriesKeys[0]?.key ?? "value"}
        monetary={monetary}
        accent={accent}
        onRowClick={drill ? (p) => drill(p) : undefined}
      />
    );
  }

  const labelStyle = { fill: INK.secondary, fontSize: 10, fontWeight: 500 };
  const labelFormatter = (v: unknown) =>
    typeof v === "number" ? formatCompact(v) : "";
  const tooltip = (
    <Tooltip
      content={<ChartTooltip monetary={monetary} />}
      cursor={{ fill: "rgba(148,163,184,0.08)" }}
    />
  );

  if (viz.type === "pie") {
    const key = seriesKeys[0]?.key ?? "value";
    // Same magnitude-sort + "Other" fold as categorical bars, tighter cap:
    // a pie stops reading past ~6 slices.
    const slices = shapeCategorical(data, seriesKeys.slice(0, 1), 6);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey={key}
            nameKey="x"
            outerRadius="70%"
            stroke={INK.surface}
            strokeWidth={2}
            cursor={drill ? "pointer" : undefined}
            onClick={
              drill
                ? (slice: { payload?: unknown }) =>
                    drill((slice?.payload as Point | undefined) ?? undefined)
                : undefined
            }
            // Custom label node: text wears text tokens, never the slice
            // color (a style-prop fill here would also override the Cells).
            label={(props: {
              x?: number;
              y?: number;
              textAnchor?: string;
              name?: string;
              value?: number;
            }) => {
              const name = String(props.name ?? "");
              const short = name.length > 16 ? `${name.slice(0, 15)}…` : name;
              return (
                <text
                  x={props.x}
                  y={props.y}
                  textAnchor={props.textAnchor as "start" | "end" | "middle"}
                  fill={INK.secondary}
                  fontSize={11}
                >
                  {short} · {formatValue(Number(props.value ?? 0), monetary)}
                </text>
              );
            }}
            labelLine={{ stroke: INK.baseline }}
          >
            {slices.map((s, i) => (
              <Cell
                key={i}
                fill={String(s.x).startsWith("Other") ? INK.muted : CATEGORICAL[i % MAX_SERIES]}
              />
            ))}
          </Pie>
          {tooltip}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // A time series with one bucket has no line to draw — a column says it better.
  const effectiveType =
    (viz.type === "line" || viz.type === "area") && data.length < 2
      ? "bar"
      : viz.type;

  // With an explicit accent, a single series wears it instead of slot 0.
  const colorAt = (key: string, i: number) =>
    !multiSeries && opts.color ? opts.color : seriesColor(key, i);

  // Chart-level click: recharts reports the hovered x (activePayload) —
  // enough to drill to the bucket; a specific segment isn't disambiguated.
  const chartClick = drill
    ? (state: { activePayload?: { payload?: unknown }[] } | null) => {
        const p = state?.activePayload?.[0]?.payload as Point | undefined;
        if (p) drill(p);
      }
    : undefined;

  const prevLine = compareActive ? (
    <Line
      type="monotone"
      dataKey={PREV_KEY}
      name={t("insights.chart.previousPeriod")}
      stroke={INK.muted}
      strokeWidth={1.5}
      strokeDasharray="5 4"
      dot={false}
      activeDot={{ r: 3, strokeWidth: 2, stroke: INK.surface }}
    />
  ) : null;

  if (effectiveType === "line" || effectiveType === "area") {
    // ComposedChart hosts the muted previous-period Line next to Areas.
    const Chart = compareActive
      ? ComposedChart
      : effectiveType === "line"
        ? LineChart
        : AreaChart;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart
          data={data}
          margin={{ top: 14, right: 16, bottom: 0, left: 0 }}
          onClick={chartClick}
        >
          {showGrid && <CartesianGrid stroke={INK.grid} vertical={false} />}
          <XAxis
            dataKey="x"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: INK.baseline }}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatCompact(v)}
            width={48}
          />
          {tooltip}
          {showLegend && <Legend formatter={legendFormatter} iconType="circle" iconSize={8} />}
          {goalLine(hints.goal, "y")}
          {prevLine}
          {seriesKeys.map((s, i) =>
            effectiveType === "line" ? (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colorAt(s.key, i)}
                strokeWidth={2}
                strokeLinecap="round"
                dot={
                  data.length <= 31
                    ? { r: 4, strokeWidth: 2, stroke: INK.surface, fill: colorAt(s.key, i) }
                    : false
                }
                activeDot={{ r: 5, strokeWidth: 2, stroke: INK.surface }}
              >
                {showValues && !multiSeries && data.length <= 24 && (
                  <LabelList position="top" formatter={labelFormatter} style={labelStyle} offset={8} />
                )}
              </Line>
            ) : (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colorAt(s.key, i)}
                strokeWidth={2}
                fill={colorAt(s.key, i)}
                fillOpacity={0.1}
              >
                {showValues && !multiSeries && data.length <= 24 && (
                  <LabelList position="top" formatter={labelFormatter} style={labelStyle} offset={8} />
                )}
              </Area>
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    );
  }

  const horizontal = effectiveType === "horizontalBar";
  const BarChartHost = compareActive ? ComposedChart : BarChart;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChartHost
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: showValues ? 16 : 8, right: 16, bottom: 0, left: 0 }}
        barCategoryGap="25%"
      >
        {showGrid && (
          <CartesianGrid stroke={INK.grid} vertical={horizontal} horizontal={!horizontal} />
        )}
        {horizontal ? (
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: INK.baseline }}
            tickFormatter={(v: number) => formatCompact(v)}
          />
        ) : (
          <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.baseline }} />
        )}
        {horizontal ? (
          <YAxis
            type="category"
            dataKey="x"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={118}
          />
        ) : (
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatCompact(v)}
            width={48}
          />
        )}
        {tooltip}
        {showLegend && <Legend formatter={legendFormatter} iconType="circle" iconSize={8} />}
        {goalLine(hints.goal, horizontal ? "x" : "y")}
        {prevLine}
        {seriesKeys.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={colorAt(s.key, i)}
            stackId={multiSeries ? "stack" : undefined}
            maxBarSize={24}
            stroke={multiSeries ? INK.surface : undefined}
            strokeWidth={multiSeries ? 1 : 0}
            cursor={drill ? "pointer" : undefined}
            onClick={
              drill
                ? (entry: { payload?: unknown }) =>
                    drill(entry?.payload as Point | undefined, s.key)
                : undefined
            }
            radius={
              multiSeries
                ? undefined
                : horizontal
                  ? [0, 4, 4, 0]
                  : [4, 4, 0, 0]
            }
          >
            {/* Per-segment labels on stacks are noise; label single series only. */}
            {showValues && !multiSeries && data.length <= 30 && (
              <LabelList
                position={horizontal ? "right" : "top"}
                formatter={labelFormatter}
                style={labelStyle}
              />
            )}
          </Bar>
        ))}
      </BarChartHost>
    </ResponsiveContainer>
  );
}
