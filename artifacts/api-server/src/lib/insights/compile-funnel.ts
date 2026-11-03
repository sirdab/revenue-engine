import { sql, type SQL } from "drizzle-orm";
import { asc, desc, eq } from "drizzle-orm";
import { db, pipelinesTable } from "@workspace/db";
import {
  isFilterGroup,
  type ExtendedFilterGroup,
  type ExtendedFilterNode,
} from "@workspace/deals-filter";
import type { WidgetSpec } from "@workspace/insights-spec";
import {
  compileExtendedGroup,
  compileGlobalFilters,
  InsightsQueryError,
  type GlobalFilters,
} from "./compile-deals";
import { runAnalyticsQuery } from "./analytics-db";
import { loadDealsFieldCatalog } from "./fields";

// ---------------------------------------------------------------------------
// The `conversionFunnel` report (ticket A2): stage-by-stage conversion over
// change_events. Adapted from the production funnel CTE in routes/pipelines.ts
// — same reconstruction (historical stage entries + a current-stage fallback
// for history-less deals), extended with per-stage value sums and the shared
// board ∩ widget filter composition.
//
// "Reached" at stage S = the deal moved past S (a later stage) or ended won.
// Conversion shown on stage S is reached(S) / entered(S).
// ---------------------------------------------------------------------------

interface FunnelRow {
  stage_id: number;
  stage_name: string;
  order_index: number;
  entered_count: number;
  entered_value: number;
  reached_later_count: number;
  won_count: number;
  total_entered: number;
  total_won: number;
  [key: string]: unknown;
}

export interface FunnelResult {
  xKey: string;
  series: { key: string; label?: string; data: Record<string, unknown>[] }[];
  meta: {
    scope: string;
    appliedFilters: { board: string[]; widget: string[] };
    totalRows: number;
    headline?: { label: string; value: number };
    /** Compute time (ISO) — lets cached responses stay honest about age. */
    freshness?: string;
  };
}

/** The funnel is per-pipeline: honor an explicit `pipeline is N` condition in
 *  the widget's filters, else fall back to the default pipeline.
 *  Exported for tests. */
export function pipelineFromFilters(
  group: ExtendedFilterGroup,
): number | undefined {
  for (const node of group.conditions as ExtendedFilterNode[]) {
    if (isFilterGroup(node as never)) {
      const nested = pipelineFromFilters(node as ExtendedFilterGroup);
      if (nested !== undefined) return nested;
      continue;
    }
    const cond = node as { field: string; operator: string; value?: unknown };
    if (cond.field === "pipeline" && cond.operator === "is") {
      const n = Number(cond.value);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export async function runDealsFunnel(
  spec: WidgetSpec,
  global: GlobalFilters | null | undefined,
): Promise<FunnelResult> {
  const catalog = await loadDealsFieldCatalog();

  const byValue = spec.measure.agg === "sum";
  if (!byValue && spec.measure.agg !== "count") {
    throw new InsightsQueryError(
      `Funnel supports count or sum(value), not "${spec.measure.agg}"`,
    );
  }

  let pipelineId = pipelineFromFilters(spec.filters);
  if (pipelineId === undefined && global?.pipelineIds?.length === 1) {
    pipelineId = global.pipelineIds[0];
  }
  if (pipelineId === undefined) {
    const [fallback] = await db
      .select({ id: pipelinesTable.id })
      .from(pipelinesTable)
      .where(eq(pipelinesTable.archived, false))
      .orderBy(desc(pipelinesTable.isDefault), asc(pipelinesTable.orderIndex))
      .limit(1);
    if (!fallback) throw new InsightsQueryError("No pipeline found");
    pipelineId = fallback.id;
  }

  // board ∩ widget deal-level conditions, applied to the deals entering the
  // funnel. Compiled against unaliased "deals" — the CTE below deliberately
  // selects `from deals` (no alias) so these predicates bind.
  const widgetApplied: string[] = [];
  const conditions: SQL[] = [];
  const widgetFilter = compileExtendedGroup(spec.filters, catalog);
  if (widgetFilter.where) {
    conditions.push(widgetFilter.where);
    widgetApplied.push("widget filter");
  }
  const board = compileGlobalFilters(global, spec, catalog);
  conditions.push(...board.conditions);
  if (widgetFilter.needsOrgJoin || board.needsOrgJoin) {
    throw new InsightsQueryError(
      "Organization filters are not supported on the funnel yet",
    );
  }

  const extraWhere =
    conditions.length > 0
      ? sql` and ${sql.join(conditions, sql` and `)}`
      : sql``;

  const query = sql`
    with scoped_deals as (
      select deals.id, deals.status, deals.value
      from deals
      where deals.pipeline_id = ${pipelineId}
        and deals.status <> 'deleted'
        and deals.archived = false${extraWhere}
    ),
    entries as (
      -- Historical stage entries reconstructed from the append-only audit log.
      select
        ce.entity_id as deal_id,
        s.id as stage_id,
        s.order_index,
        ce.changed_at as entered_at
      from change_events ce
      join scoped_deals sd on sd.id = ce.entity_id
      join stages s on s.id = (ce.new_value->>'id')::int
      where ce.entity_type = 'deal'
        and ce.field_key = 'stage_id'
        and s.pipeline_id = ${pipelineId}
      union all
      -- Fallback for deals with no stage history (created before the audit
      -- log or imported without events): count their current stage once.
      select
        d.id as deal_id,
        s.id as stage_id,
        s.order_index,
        d.add_time as entered_at
      from deals d
      join scoped_deals sd on sd.id = d.id
      join stages s on s.id = d.stage_id
      where s.pipeline_id = ${pipelineId}
        and not exists (
          select 1 from change_events ce2
          where ce2.entity_type = 'deal'
            and ce2.entity_id = d.id
            and ce2.field_key = 'stage_id'
        )
    ),
    deal_stage as (
      select distinct deal_id, stage_id, order_index from entries
    ),
    deal_progress as (
      select deal_id, max(order_index) as max_order from entries group by deal_id
    ),
    stage_stats as (
      select
        ds.stage_id,
        count(*)::int as entered_count,
        coalesce(sum(sd.value), 0)::float8 as entered_value,
        (count(*) filter (
          where dp.max_order > ds.order_index or sd.status = 'won'
        ))::int as reached_later_count,
        (count(*) filter (where sd.status = 'won'))::int as won_count
      from deal_stage ds
      join scoped_deals sd on sd.id = ds.deal_id
      join deal_progress dp on dp.deal_id = ds.deal_id
      group by ds.stage_id
    )
    select
      s.id as stage_id,
      s.name as stage_name,
      s.order_index as order_index,
      coalesce(ss.entered_count, 0) as entered_count,
      coalesce(ss.entered_value, 0) as entered_value,
      coalesce(ss.reached_later_count, 0) as reached_later_count,
      coalesce(ss.won_count, 0) as won_count,
      (select count(distinct deal_id) from entries)::int as total_entered,
      (select count(*) from scoped_deals where status = 'won')::int as total_won
    from stages s
    left join stage_stats ss on ss.stage_id = s.id
    where s.pipeline_id = ${pipelineId} and s.archived = false
    order by s.order_index
  `;

  const rows = await runAnalyticsQuery<FunnelRow>(query);

  const totalEntered = rows.length > 0 ? rows[0].total_entered : 0;
  const totalWon = rows.length > 0 ? rows[0].total_won : 0;

  const data = rows.map((r) => ({
    x: r.stage_name,
    stageId: r.stage_id,
    y: byValue ? Number(r.entered_value) : r.entered_count,
    entered: r.entered_count,
    enteredValue: Number(r.entered_value),
    reached: r.reached_later_count,
    won: r.won_count,
    // Conversion out of this stage: moved past it (or won) / entered it.
    conversion:
      r.entered_count > 0 ? r.reached_later_count / r.entered_count : null,
  }));

  return {
    xKey: "x",
    series: [{ key: byValue ? "value" : "deals", data }],
    meta: {
      scope: "deals",
      appliedFilters: { board: board.applied, widget: widgetApplied },
      totalRows: rows.length,
      headline: {
        label: "Win rate",
        value: totalEntered > 0 ? totalWon / totalEntered : 0,
      },
    },
  };
}
