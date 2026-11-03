import { Router, type IRouter } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, pipelinesTable, stagesTable, dealsTable } from "@workspace/db";
import {
  ListPipelinesResponse,
  GetBoardQueryParams,
  GetBoardResponse,
  GetPipelineFunnelQueryParams,
  GetPipelineFunnelResponse,
} from "@workspace/api-zod";
import { compileDealFilters, dealQuery, DealFilterError } from "../lib/queries";
import { buildDealWhere } from "./deals";

const router: IRouter = Router();

router.get("/pipelines", async (_req, res): Promise<void> => {
  // Archived pipelines are hidden; the default sorts first so consumers that use
  // pipelines[0] pick it by construction.
  const rows = await db
    .select()
    .from(pipelinesTable)
    .where(eq(pipelinesTable.archived, false))
    .orderBy(
      desc(pipelinesTable.isDefault),
      pipelinesTable.orderIndex,
      pipelinesTable.id,
    );
  res.json(ListPipelinesResponse.parse(rows));
});

router.get("/board", async (req, res): Promise<void> => {
  const parsed = GetBoardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { pipelineId, ownerId, q, filters } = parsed.data;

  let filterSql: SQL | undefined;
  try {
    filterSql = compileDealFilters(filters);
  } catch (err) {
    res.status(400).json({
      error: err instanceof DealFilterError ? err.message : "Invalid filter",
    });
    return;
  }

  const [pipeline] = await db
    .select()
    .from(pipelinesTable)
    .where(eq(pipelinesTable.id, pipelineId));
  if (!pipeline) {
    res.status(404).json({ error: "Pipeline not found" });
    return;
  }

  const stages = await db
    .select()
    .from(stagesTable)
    .where(
      and(eq(stagesTable.pipelineId, pipelineId), eq(stagesTable.archived, false)),
    )
    .orderBy(stagesTable.orderIndex);

  // The same WHERE the deals list builds, so a search or a filter means the
  // same thing on the board as in the list. The board stays the open,
  // unarchived working view whatever the filter says: it passes no
  // status/archived overrides, so a "Status is won" filter leaves it empty
  // rather than turning it into a board of closed deals.
  const where = buildDealWhere(
    { pipelineId, ownerId, q, status: "open", archived: false },
    filterSql,
  );

  const deals = await dealQuery()
    .where(where)
    .orderBy(desc(dealsTable.updateTime));

  const columns = stages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stageId === stage.id);
    const sum = stageDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);
    return {
      stageId: stage.id,
      stageName: stage.name,
      orderIndex: stage.orderIndex,
      count: stageDeals.length,
      sum,
      deals: stageDeals,
    };
  });

  // The header totals are the sum of the columns, so they always agree with
  // what is on screen: a deal left in an archived stage has no column, and
  // counting it anyway made the header disagree with the board.
  const totalCount = columns.reduce((acc, c) => acc + c.count, 0);
  const totalValue = columns.reduce((acc, c) => acc + c.sum, 0);

  res.json(
    GetBoardResponse.parse({
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      totalCount,
      totalValue,
      columns,
    }),
  );
});

interface FunnelRow {
  stage_id: number;
  stage_name: string;
  order_index: number;
  entered_count: number;
  reached_later_count: number;
  won_count: number;
  avg_time_in_stage_seconds: number | null;
  total_entered: number;
  [key: string]: unknown;
}

router.get("/funnel", async (req, res): Promise<void> => {
  const parsed = GetPipelineFunnelQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { pipelineId, from, to, ownerId } = parsed.data;

  const [pipeline] = await db
    .select()
    .from(pipelinesTable)
    .where(eq(pipelinesTable.id, pipelineId));
  if (!pipeline) {
    res.status(404).json({ error: "Pipeline not found" });
    return;
  }

  // Optional scoping predicates applied to the deals that enter the funnel.
  const ownerFilter = ownerId != null ? sql` and d.owner_id = ${ownerId}` : sql``;
  const fromFilter = from
    ? sql` and (d.add_time at time zone 'Asia/Riyadh')::date >= ${from}::date`
    : sql``;
  const toFilter = to
    ? sql` and (d.add_time at time zone 'Asia/Riyadh')::date <= ${to}::date`
    : sql``;

  const result = await db.execute<FunnelRow>(sql`
    with scoped_deals as (
      select d.id, d.status, d.close_time
      from deals d
      where d.pipeline_id = ${pipelineId}
        and d.status <> 'deleted'${ownerFilter}${fromFilter}${toFilter}
    ),
    entries as (
      -- Historical stage entries reconstructed from the append-only audit log.
      select
        ce.entity_id as deal_id,
        s.id as stage_id,
        s.order_index,
        ce.changed_at as entered_at,
        lead(ce.changed_at) over (
          partition by ce.entity_id order by ce.changed_at, ce.id
        ) as exited_at
      from change_events ce
      join scoped_deals sd on sd.id = ce.entity_id
      join stages s on s.id = (ce.new_value->>'id')::int
      where ce.entity_type = 'deal'
        and ce.field_key = 'stage_id'
        and s.pipeline_id = ${pipelineId}
      union all
      -- Fallback for deals with no stage history (e.g. created before this
      -- feature or imported without events): count their current stage once.
      select
        d.id as deal_id,
        s.id as stage_id,
        s.order_index,
        d.add_time as entered_at,
        null::timestamptz as exited_at
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
    durations as (
      -- The last stage a deal entered runs until now() while the deal is open,
      -- and stops at close_time once it is won or lost (close_time is cleared
      -- on reopen), so closed deals stop inflating their final stage's average.
      select e.stage_id,
             avg(extract(epoch from (
               coalesce(
                 e.exited_at,
                 -- greatest() skips nulls, so it must not see an open deal's.
                 case when sd.close_time is not null
                   then greatest(sd.close_time, e.entered_at) end,
                 now()
               )
               - e.entered_at
             )))::float8 as avg_secs
      from entries e
      join scoped_deals sd on sd.id = e.deal_id
      group by e.stage_id
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
      coalesce(ss.reached_later_count, 0) as reached_later_count,
      coalesce(ss.won_count, 0) as won_count,
      d.avg_secs as avg_time_in_stage_seconds,
      (select count(distinct deal_id) from entries)::int as total_entered
    from stages s
    left join stage_stats ss on ss.stage_id = s.id
    left join durations d on d.stage_id = s.id
    where s.pipeline_id = ${pipelineId} and s.archived = false
    order by s.order_index
  `);

  const rows = result.rows;
  const totalEntered = rows.length ? rows[0].total_entered : 0;
  const stages = rows.map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    orderIndex: r.order_index,
    enteredCount: r.entered_count,
    reachedLaterCount: r.reached_later_count,
    wonCount: r.won_count,
    conversionRate:
      r.entered_count > 0 ? r.reached_later_count / r.entered_count : 0,
    avgTimeInStageSeconds: r.avg_time_in_stage_seconds,
  }));

  res.json(
    GetPipelineFunnelResponse.parse({
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      totalEntered,
      stages,
    }),
  );
});

export default router;
