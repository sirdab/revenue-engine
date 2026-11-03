import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, stagesTable } from "@workspace/db";
import { ListStagesQueryParams, ListStagesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stages", async (req, res): Promise<void> => {
  const parsed = ListStagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Archived stages are hidden from pickers, board columns, and filters.
  const notArchived = eq(stagesTable.archived, false);
  const rows = parsed.data.pipelineId
    ? await db
        .select()
        .from(stagesTable)
        .where(and(eq(stagesTable.pipelineId, parsed.data.pipelineId), notArchived))
        .orderBy(stagesTable.orderIndex)
    : await db.select().from(stagesTable).where(notArchived).orderBy(stagesTable.orderIndex);

  res.json(ListStagesResponse.parse(rows));
});

export default router;
