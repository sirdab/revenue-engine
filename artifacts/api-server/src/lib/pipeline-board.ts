import { and, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db, pipelinesTable, stagesTable, dealsTable } from "@workspace/db";
import { dealQuery, escapeLike } from "./queries";

export interface PipelineBoardParams {
  pipelineId?: number;
  ownerId?: number;
  q?: string;
}

// Used by the assistant's pipeline_summary tool. The /board route
// (routes/pipelines.ts) still has its own separate copy of this query — it
// hasn't been consolidated onto this function.
// Returns null when the pipeline doesn't exist, so callers can 404/error.
export async function buildPipelineBoard(params: PipelineBoardParams) {
  const { pipelineId, ownerId, q } = params;

  // When no pipelineId is given, don't hard-filter on isDefault — if no
  // pipeline has that flag set, that filter would return zero rows and the
  // ORDER BY below would never get a chance to matter. Instead mirror
  // routes/pipelines.ts: fetch all non-archived pipelines ordered
  // default-first, and take the first one (limit(1) is required now that
  // this WHERE can match more than one row).
  const [pipeline] = await db
    .select()
    .from(pipelinesTable)
    .where(
      pipelineId == null
        ? eq(pipelinesTable.archived, false)
        : eq(pipelinesTable.id, pipelineId),
    )
    .orderBy(desc(pipelinesTable.isDefault), pipelinesTable.orderIndex, pipelinesTable.id)
    .limit(1);
  if (!pipeline) return null;

  const stages = await db
    .select()
    .from(stagesTable)
    .where(
      and(eq(stagesTable.pipelineId, pipeline.id), eq(stagesTable.archived, false)),
    )
    .orderBy(stagesTable.orderIndex);

  const conditions: SQL[] = [
    eq(dealsTable.pipelineId, pipeline.id),
    eq(dealsTable.status, "open"),
    // Archived deals never appear on the working board.
    eq(dealsTable.archived, false),
  ];
  if (ownerId) conditions.push(eq(dealsTable.ownerId, ownerId));
  if (q) conditions.push(ilike(dealsTable.title, `%${escapeLike(q)}%`));

  const deals = await dealQuery()
    .where(and(...conditions))
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

  const totalCount = deals.length;
  const totalValue = deals.reduce((acc, d) => acc + (d.value ?? 0), 0);

  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    totalCount,
    totalValue,
    columns,
  };
}
