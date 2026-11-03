import type { WidgetSpec } from "@workspace/insights-spec";
import {
  runDealsPerformance,
  InsightsQueryError,
  type GlobalFilters,
  type PerformanceResult,
} from "./compile-deals";
import { runActivitiesPerformance } from "./compile-activities";
import { runDealsFunnel, type FunnelResult } from "./compile-funnel";

// ---------------------------------------------------------------------------
// One executor for every insights query, shared by /insights/query and
// /insights/query-batch: picks the scope/report runner and fronts it with a
// short-TTL result cache.
//
// Caching across users is safe by design (ADR-E1): the app has no row-level
// scoping, so identical (spec, globalFilters) means identical results for
// every authenticated user. A team looking at the same shared board collapses
// to one scan per distinct spec per TTL window instead of N×M.
// ---------------------------------------------------------------------------

export type InsightsRunResult = PerformanceResult | FunnelResult;

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  value: InsightsRunResult;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
// In-flight dedup: concurrent identical queries (12 tiles of the same board
// opened by 3 users at once) share a single promise instead of racing the DB.
const pending = new Map<string, Promise<InsightsRunResult>>();

/** Deterministic JSON: objects with the same shape produce the same key
 *  regardless of property insertion order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

/** Test seam + admin escape hatch. */
export function clearInsightsQueryCache(): void {
  cache.clear();
}

function resolveRunner(
  spec: WidgetSpec,
): ((spec: WidgetSpec, global: GlobalFilters | null | undefined) => Promise<InsightsRunResult>) | null {
  if (spec.scope === "deals" && spec.reportType === "conversionFunnel") {
    return runDealsFunnel;
  }
  if (spec.scope === "deals" && spec.reportType === "performance") {
    return runDealsPerformance;
  }
  if (spec.scope === "activities" && spec.reportType === "performance") {
    return runActivitiesPerformance;
  }
  return null;
}

/** Execute a (validated, migrated) widget spec against the analytics layer,
 *  serving from / populating the shared result cache. Errors are never
 *  cached; a shared in-flight promise rejection reaches all its callers.
 *  `cached` is surfaced so route logs can tell a 2ms cache hit from a 2ms
 *  table scan — the first thing to check when a number looks stale. */
export async function runInsightsSpec(
  spec: WidgetSpec,
  global: GlobalFilters | null,
): Promise<{ result: InsightsRunResult; cached: boolean }> {
  const runner = resolveRunner(spec);
  if (!runner) {
    throw new InsightsQueryError(
      `Report "${spec.reportType}" for scope "${spec.scope}" is not implemented yet`,
    );
  }

  const key = stableStringify({ spec, global });
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { result: hit.value, cached: true };

  const inFlight = pending.get(key);
  if (inFlight) return { result: await inFlight, cached: true };

  const promise = runner(spec, global)
    .then((result) => {
      const stamped: InsightsRunResult = {
        ...result,
        meta: { ...result.meta, freshness: new Date().toISOString() },
      };
      if (cache.size >= CACHE_MAX_ENTRIES) {
        // Maps iterate in insertion order — evict the oldest entry.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { value: stamped, expires: Date.now() + CACHE_TTL_MS });
      return stamped;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, promise);
  return { result: await promise, cached: false };
}
