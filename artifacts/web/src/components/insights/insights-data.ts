import { useQuery } from "@tanstack/react-query";
import {
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";
import {
  runInsightsQuery,
  runInsightsQueryBatch,
  type InsightsGlobalFilters,
  type InsightsQueryRequest,
  type InsightsQueryResult,
  type InsightsWidgetSpec,
} from "@workspace/api-client-react";
import { tStatic, type MessageKey } from "@/lib/i18n/static";
import { getDisplayTimeZone } from "@/lib/format";

// ---------------------------------------------------------------------------
// Batched query transport: every widget on a board mounts in the same tick,
// so a short collection window folds N per-widget queries (plus KPI-trend and
// compare companions) into ONE /insights/query-batch round trip. Items
// resolve/reject independently, so one bad widget spec doesn't fail the board.
// ---------------------------------------------------------------------------

const BATCH_WINDOW_MS = 10;
const BATCH_MAX_ITEMS = 30; // mirrors the API's maxItems

interface PendingQuery {
  request: InsightsQueryRequest;
  resolve: (r: InsightsQueryResult) => void;
  reject: (e: Error) => void;
}

let batchQueue: PendingQuery[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

async function flushBatch(): Promise<void> {
  const queue = batchQueue;
  batchQueue = [];
  batchTimer = null;
  if (queue.length === 0) return;
  // A lone query skips the batch envelope — same semantics, simpler logs.
  if (queue.length === 1) {
    const [item] = queue;
    try {
      item.resolve(await runInsightsQuery(item.request));
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }
  // Boards larger than one batch split into parallel chunks — serial awaits
  // would stack their latencies.
  const chunks: PendingQuery[][] = [];
  for (let i = 0; i < queue.length; i += BATCH_MAX_ITEMS) {
    chunks.push(queue.slice(i, i + BATCH_MAX_ITEMS));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { results } = await runInsightsQueryBatch({
          items: chunk.map((p) => p.request),
        });
        chunk.forEach((p, j) => {
          const entry = results[j];
          if (entry?.result) p.resolve(entry.result as InsightsQueryResult);
          else p.reject(new Error(entry?.error ?? tStatic("insights.queryFailed")));
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        chunk.forEach((p) => p.reject(e));
      }
    }),
  );
}

function runBatchedInsightsQuery(
  request: InsightsQueryRequest,
): Promise<InsightsQueryResult> {
  return new Promise((resolve, reject) => {
    batchQueue.push({ request, resolve, reject });
    if (!batchTimer) batchTimer = setTimeout(() => void flushBatch(), BATCH_WINDOW_MS);
  });
}

// One generic query hook: a widget is pure config, so its data is keyed by
// (spec, board filters). React Query dedupes identical widgets across the
// board and keeps results warm for 30s (app-wide staleTime); distinct specs
// travel together through the batch transport above.
export function useWidgetData(
  spec: InsightsWidgetSpec,
  globalFilters: InsightsGlobalFilters | undefined,
  enabled = true,
) {
  return useQuery<InsightsQueryResult, Error>({
    queryKey: ["insights-query", spec, globalFilters ?? null],
    queryFn: () => runBatchedInsightsQuery({ spec, globalFilters }),
    enabled,
  });
}

/** First-series points as {x, y} — the shape the KPI-trend and
 *  previous-period companions consume. */
export function firstSeriesPoints(
  result: InsightsQueryResult,
): { x: string; y: number | null }[] {
  const rows = (result.series?.[0]?.data ?? []) as { x?: unknown; y?: unknown }[];
  return rows.map((d) => ({
    x: d.x != null ? String(d.x) : "",
    y: typeof d.y === "number" ? d.y : null,
  }));
}

/** Currency formatting applies when the measure aggregates deal value — a count
 *  is a count regardless of field. One rule, shared by shell and builder
 *  (funnels fit too: their sum measure is always over `value`). */
export function isMonetarySpec(
  spec: Pick<InsightsWidgetSpec, "measure">,
): boolean {
  return spec.measure.agg !== "count" && spec.measure.field === "value";
}

// ---------------------------------------------------------------------------
// Board quick-filter state (ticket §7.1–7.2) + URL round-trip.
// ---------------------------------------------------------------------------

export const DATE_PRESETS = [
  { key: "today", label: "common.today" },
  { key: "yesterday", label: "common.yesterday" },
  { key: "thisWeek", label: "insights.preset.thisWeek" },
  { key: "last7", label: "insights.preset.last7" },
  { key: "thisMonth", label: "insights.preset.thisMonth" },
  { key: "last30", label: "insights.preset.last30" },
  { key: "thisQuarter", label: "insights.preset.thisQuarter" },
  { key: "thisYear", label: "insights.preset.thisYear" },
] as const satisfies readonly { key: string; label: MessageKey }[];
export type DatePresetKey = (typeof DATE_PRESETS)[number]["key"];

// The per-scope serviceable subsets of the spec's date bases (matching the
// server's basis-column maps). Single source for every basis dropdown.
export const DATE_BASES = [
  { key: "createdAt", label: "common.created" },
  { key: "wonAt", label: "common.won" },
  { key: "lostAt", label: "common.lost" },
  { key: "closedAt", label: "common.closed" },
] as const satisfies readonly { key: string; label: MessageKey }[];
export type DateBasisKey = (typeof DATE_BASES)[number]["key"];

export const ACTIVITY_DATE_BASES = [
  { key: "createdAt", label: "common.created" },
  { key: "activityDoneAt", label: "common.done" },
] as const satisfies readonly { key: string; label: MessageKey }[];

/** Today's date on the user's own calendar (their timezone setting), not the
 *  browser's, so "today" matches the dates the rest of the app shows. */
function userToday(): Date {
  // en-CA formats as YYYY-MM-DD.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: getDisplayTimeZone(),
  }).format(new Date());
  return parseISO(iso);
}

/** Resolve a preset to a concrete date range (weeks start Monday). */
export function presetRange(preset: DatePresetKey): { from: string; to: string } {
  const now = userToday();
  const day = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "today":
      return { from: day(now), to: day(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: day(y), to: day(y) };
    }
    case "thisWeek":
      return {
        from: day(startOfWeek(now, { weekStartsOn: 1 })),
        to: day(endOfWeek(now, { weekStartsOn: 1 })),
      };
    case "last7":
      return { from: day(subDays(now, 6)), to: day(now) };
    case "thisMonth":
      return { from: day(startOfMonth(now)), to: day(endOfMonth(now)) };
    case "last30":
      return { from: day(subDays(now, 29)), to: day(now) };
    case "thisQuarter":
      return { from: day(startOfQuarter(now)), to: day(endOfQuarter(now)) };
    case "thisYear":
      return { from: day(startOfYear(now)), to: day(endOfYear(now)) };
  }
}

export interface BoardFilters {
  ownerIds: number[];
  pipelineIds: number[];
  statuses: ("open" | "won" | "lost")[];
  qualification?: "qualified" | "unqualified";
  /** Preset wins over from/to; from/to describe a custom range. */
  preset?: DatePresetKey;
  from?: string;
  to?: string;
  basis?: DateBasisKey;
  /** base64url-encoded ExtendedFilterGroup from the board's Add-filter. */
  filters?: string;
}

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  ownerIds: [],
  pipelineIds: [],
  statuses: [],
};

export function boardFiltersActive(f: BoardFilters): boolean {
  return (
    f.ownerIds.length > 0 ||
    f.pipelineIds.length > 0 ||
    f.statuses.length > 0 ||
    !!f.qualification ||
    !!f.preset ||
    !!f.from ||
    !!f.to ||
    !!f.filters
  );
}

export function toGlobalFilters(
  f: BoardFilters,
): InsightsGlobalFilters | undefined {
  const out: InsightsGlobalFilters = {};
  if (f.ownerIds.length > 0) out.ownerIds = f.ownerIds;
  if (f.pipelineIds.length > 0) out.pipelineIds = f.pipelineIds;
  if (f.statuses.length > 0) out.statuses = f.statuses;
  if (f.qualification) out.qualification = f.qualification;
  if (f.filters) out.filters = f.filters;
  const range = f.preset
    ? presetRange(f.preset)
    : f.from || f.to
      ? { from: f.from, to: f.to }
      : undefined;
  if (range && (range.from || range.to)) {
    out.dateRange = {
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
      ...(f.preset ? { preset: f.preset } : {}),
      ...(f.basis ? { basis: f.basis } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// URL round-trip: the whole board view (dashboard + filters) is deep-linkable.
const PRESET_KEYS = new Set<string>(DATE_PRESETS.map((p) => p.key));
const BASIS_KEYS = new Set<string>(DATE_BASES.map((b) => b.key));

export function boardStateToParams(
  dashboardId: number | null,
  f: BoardFilters,
): URLSearchParams {
  const p = new URLSearchParams();
  if (dashboardId != null) p.set("d", String(dashboardId));
  if (f.ownerIds.length > 0) p.set("o", f.ownerIds.join("."));
  if (f.pipelineIds.length > 0) p.set("p", f.pipelineIds.join("."));
  if (f.statuses.length > 0) p.set("s", f.statuses.join("."));
  if (f.qualification) p.set("q", f.qualification);
  if (f.preset) p.set("dp", f.preset);
  else {
    if (f.from) p.set("df", f.from);
    if (f.to) p.set("dt", f.to);
  }
  if (f.basis) p.set("db", f.basis);
  if (f.filters) p.set("f", f.filters);
  return p;
}

export function boardStateFromParams(search: string): {
  dashboardId: number | null;
  filters: BoardFilters;
} {
  const p = new URLSearchParams(search);
  const nums = (key: string) =>
    (p.get(key) ?? "")
      .split(".")
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
  const statuses = (p.get("s") ?? "")
    .split(".")
    .filter((s): s is "open" | "won" | "lost" =>
      s === "open" || s === "won" || s === "lost",
    );
  const q = p.get("q");
  const preset = p.get("dp");
  const basis = p.get("db");
  const id = Number(p.get("d"));
  return {
    dashboardId: Number.isFinite(id) && id > 0 ? id : null,
    filters: {
      ownerIds: nums("o"),
      pipelineIds: nums("p"),
      statuses,
      qualification:
        q === "qualified" || q === "unqualified" ? q : undefined,
      preset:
        preset && PRESET_KEYS.has(preset) ? (preset as DatePresetKey) : undefined,
      from: p.get("df") ?? undefined,
      to: p.get("dt") ?? undefined,
      basis: basis && BASIS_KEYS.has(basis) ? (basis as DateBasisKey) : undefined,
      filters: p.get("f") ?? undefined,
    },
  };
}

