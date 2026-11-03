import { Router, type IRouter } from "express";
import { and, asc, eq, getTableColumns, inArray, ne, sql } from "drizzle-orm";
import { db, pipelinesTable, stagesTable, dealsTable } from "@workspace/db";
import { requireAdmin, currentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  lockForCreate,
  nextLocalId,
  pipelineActiveDealCount,
  stageActiveDealCount,
  PipelineAdminError,
  PIPELINE_LOCK_KEY,
  STAGE_LOCK_KEY,
} from "../lib/pipeline-admin";
import {
  logEntityEvent,
  logEntityEvents,
  logEntityChanges,
  logDealChanges,
  type EntityEventInput,
} from "../lib/change-events";
import { loadFieldRegistry } from "../lib/deal-fields";

// Admin pipeline & stage management. Every route is admin-only; every mutation
// is transactional and audited to change_events (entityType pipeline/stage).
// Read-only listing for the app stays in routes/pipelines.ts + stages.ts.

const router: IRouter = Router();

function mapError(err: unknown, res: import("express").Response, log: string): void {
  if (err instanceof PipelineAdminError) {
    res.status(err.status).json({ error: err.message, ...(err.extra ?? {}) });
    return;
  }
  logger.error({ err }, log);
  res.status(500).json({ error: "Something went wrong." });
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

router.get("/admin/pipelines", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [rows, counts] = await Promise.all([
      db
        .select(getTableColumns(pipelinesTable))
        .from(pipelinesTable)
        .orderBy(asc(pipelinesTable.orderIndex), asc(pipelinesTable.id)),
      db
        .select({
          pipelineId: dealsTable.pipelineId,
          count: sql<number>`count(*)::int`,
        })
        .from(dealsTable)
        .where(ne(dealsTable.status, "deleted"))
        .groupBy(dealsTable.pipelineId),
    ]);
    const countByPipeline = new Map(counts.map((c) => [c.pipelineId, c.count]));
    res.json(
      rows.map((r) => ({ ...r, activeDealCount: countByPipeline.get(r.id) ?? 0 })),
    );
  } catch (err) {
    mapError(err, res, "Failed to list pipelines");
  }
});

router.post("/admin/pipelines", requireAdmin, async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const user = currentUser(res);
  try {
    const created = await db.transaction(async (tx) => {
      await lockForCreate(tx, PIPELINE_LOCK_KEY);
      const id = await nextLocalId(tx, "pipelines");
      const [agg] = await tx
        .select({
          maxOrder: sql<number>`coalesce(max(${pipelinesTable.orderIndex}), 0)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(pipelinesTable);
      const [row] = await tx
        .insert(pipelinesTable)
        .values({
          id,
          name,
          orderIndex: (agg?.maxOrder ?? 0) + 1,
          isDefault: (agg?.total ?? 0) === 0, // first pipeline becomes default
          adminOnlyReassign: req.body?.adminOnlyReassign === true,
        })
        .returning();
      await logEntityEvent(tx, "pipeline", id, "created", null, { id, label: name }, {
        changedBy: user.id,
      });
      return row;
    });
    res.status(201).json(created);
  } catch (err) {
    mapError(err, res, "Failed to create pipeline");
  }
});

router.patch("/admin/pipelines/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid pipeline id" });
    return;
  }
  const body = req.body ?? {};
  const user = currentUser(res);
  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(pipelinesTable)
        .where(eq(pipelinesTable.id, id))
        .for("update");
      if (!before) return { status: 404 as const, error: "Pipeline not found" };

      const updates: Partial<typeof pipelinesTable.$inferInsert> = {};
      if (typeof body.name === "string" && body.name.trim())
        updates.name = body.name.trim();
      if (typeof body.archived === "boolean") {
        if (body.archived && before.isDefault)
          throw new PipelineAdminError(
            "Set another pipeline as default before archiving this one",
            409,
          );
        updates.archived = body.archived;
      }
      if (body.wonRequiredFields !== undefined)
        updates.wonRequiredFields = await parseRequiredFields(body.wonRequiredFields);
      if (typeof body.adminOnlyReassign === "boolean")
        updates.adminOnlyReassign = body.adminOnlyReassign;
      if (Object.keys(updates).length) {
        await tx.update(pipelinesTable).set(updates).where(eq(pipelinesTable.id, id));
        await logEntityChanges(
          tx,
          "pipeline",
          id,
          before,
          updates,
          [
            { key: "name", fieldKey: "name" },
            { key: "archived", fieldKey: "archived" },
            { key: "wonRequiredFields", fieldKey: "won_required_fields" },
            { key: "adminOnlyReassign", fieldKey: "admin_only_reassign" },
          ],
          { changedBy: user.id },
        );
      }
      return { status: 200 as const };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const [updated] = await db
      .select()
      .from(pipelinesTable)
      .where(eq(pipelinesTable.id, id));
    res.json(updated);
  } catch (err) {
    mapError(err, res, "Failed to update pipeline");
  }
});

router.post("/admin/pipelines/:id/set-default", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid pipeline id" });
    return;
  }
  const user = currentUser(res);
  try {
    const result = await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(pipelinesTable)
        .where(eq(pipelinesTable.id, id))
        .for("update");
      if (!p) return { status: 404 as const, error: "Pipeline not found" };
      if (p.archived)
        throw new PipelineAdminError("Cannot set an archived pipeline as default", 400);
      if (!p.isDefault) {
        await tx
          .update(pipelinesTable)
          .set({ isDefault: false })
          .where(eq(pipelinesTable.isDefault, true));
        await tx
          .update(pipelinesTable)
          .set({ isDefault: true })
          .where(eq(pipelinesTable.id, id));
        await logEntityEvent(tx, "pipeline", id, "is_default", null, { label: "default" }, {
          changedBy: user.id,
        });
      }
      return { status: 200 as const };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    mapError(err, res, "Failed to set default pipeline");
  }
});

router.post("/admin/pipelines/reorder", requireAdmin, async (req, res): Promise<void> => {
  // Deduped so a repeated id in the client payload can't be moved twice while
  // its audit diff is still computed against the pre-reorder snapshot.
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set((req.body.ids as unknown[]).map(Number).filter(Number.isInteger))]
    : [];
  const user = currentUser(res);
  try {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: pipelinesTable.id, orderIndex: pipelinesTable.orderIndex })
        .from(pipelinesTable)
        .where(inArray(pipelinesTable.id, ids));
      const oldIndexById = new Map(existing.map((r) => [r.id, r.orderIndex]));
      const events: EntityEventInput[] = [];
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(pipelinesTable)
          .set({ orderIndex: i })
          .where(eq(pipelinesTable.id, ids[i]!));
        const oldIndex = oldIndexById.get(ids[i]!);
        if (oldIndex !== undefined && oldIndex !== i) {
          events.push({
            entityType: "pipeline",
            entityId: ids[i]!,
            fieldKey: "reorder",
            oldValue: { label: String(oldIndex) },
            newValue: { label: String(i) },
          });
        }
      }
      await logEntityEvents(tx, events, { changedBy: user.id, source: "ui" });
    });
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    mapError(err, res, "Failed to reorder pipelines");
  }
});

router.delete("/admin/pipelines/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid pipeline id" });
    return;
  }
  const user = currentUser(res);
  try {
    const result = await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(pipelinesTable)
        .where(eq(pipelinesTable.id, id))
        .for("update");
      if (!p) return { status: 404 as const, error: "Pipeline not found" };
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(pipelinesTable);
      if (total <= 1)
        throw new PipelineAdminError("Cannot delete the only pipeline", 400);
      if (p.isDefault)
        throw new PipelineAdminError("Cannot delete the default pipeline", 400);
      // FK from deals requires the pipeline hold no deals of any status.
      const [{ deals }] = await tx
        .select({ deals: sql<number>`count(*)::int` })
        .from(dealsTable)
        .where(eq(dealsTable.pipelineId, id));
      if (deals > 0)
        throw new PipelineAdminError(
          "Pipeline still has deals: reassign or delete them first, or archive the pipeline instead",
          409,
          { deals },
        );
      await tx.delete(stagesTable).where(eq(stagesTable.pipelineId, id));
      await tx.delete(pipelinesTable).where(eq(pipelinesTable.id, id));
      await logEntityEvent(tx, "pipeline", id, "deleted", { id, label: p.name }, null, {
        changedBy: user.id,
      });
      return { status: 200 as const };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    mapError(err, res, "Failed to delete pipeline");
  }
});

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

interface StageInput {
  name?: unknown;
  probability?: unknown;
  rottingDays?: unknown;
  requiredFields?: unknown;
  archived?: unknown;
}

function parseProbability(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100)
    throw new PipelineAdminError("probability must be an integer 0–100");
  return n;
}
function parseRottingDays(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new PipelineAdminError("rottingDays must be a positive integer or null");
  return n;
}
async function parseRequiredFields(v: unknown): Promise<string[]> {
  if (!Array.isArray(v))
    throw new PipelineAdminError("requiredFields must be an array");
  const keys = [
    ...new Set(
      v.filter((k) => typeof k === "string" && k.trim() !== "").map((k) => (k as string).trim()),
    ),
  ];
  if (keys.length) {
    const registry = await loadFieldRegistry();
    const valid = new Set(registry.fields.map((f) => f.key));
    for (const k of keys) {
      if (!valid.has(k))
        throw new PipelineAdminError(`Unknown deal field: ${k}`);
    }
  }
  return keys;
}

router.get("/admin/stages", requireAdmin, async (req, res): Promise<void> => {
  try {
    const pipelineId = Number(req.query.pipelineId);
    const where = Number.isInteger(pipelineId)
      ? eq(stagesTable.pipelineId, pipelineId)
      : undefined;
    const [rows, counts] = await Promise.all([
      db
        .select(getTableColumns(stagesTable))
        .from(stagesTable)
        .where(where)
        .orderBy(asc(stagesTable.orderIndex), asc(stagesTable.id)),
      db
        .select({
          stageId: dealsTable.stageId,
          count: sql<number>`count(*)::int`,
        })
        .from(dealsTable)
        .where(ne(dealsTable.status, "deleted"))
        .groupBy(dealsTable.stageId),
    ]);
    const countByStage = new Map(counts.map((c) => [c.stageId, c.count]));
    res.json(
      rows.map((r) => ({ ...r, activeDealCount: countByStage.get(r.id) ?? 0 })),
    );
  } catch (err) {
    mapError(err, res, "Failed to list stages");
  }
});

router.post("/admin/stages", requireAdmin, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as StageInput & { pipelineId?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const pipelineId = Number(body.pipelineId);
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  if (!Number.isInteger(pipelineId)) {
    res.status(400).json({ error: "pipelineId is required" });
    return;
  }
  const user = currentUser(res);
  try {
    const probability = body.probability === undefined ? 100 : parseProbability(body.probability);
    const rottingDays = parseRottingDays(body.rottingDays);
    const requiredFields =
      body.requiredFields === undefined ? [] : await parseRequiredFields(body.requiredFields);

    const created = await db.transaction(async (tx) => {
      const [pipeline] = await tx
        .select()
        .from(pipelinesTable)
        .where(eq(pipelinesTable.id, pipelineId));
      if (!pipeline)
        throw new PipelineAdminError("Pipeline not found", 404);
      await lockForCreate(tx, STAGE_LOCK_KEY);
      const id = await nextLocalId(tx, "stages");
      const [agg] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${stagesTable.orderIndex}), 0)::int` })
        .from(stagesTable)
        .where(eq(stagesTable.pipelineId, pipelineId));
      const [row] = await tx
        .insert(stagesTable)
        .values({
          id,
          name,
          pipelineId,
          orderIndex: (agg?.maxOrder ?? 0) + 1,
          probability,
          rottingDays,
          requiredFields,
        })
        .returning();
      await logEntityEvent(tx, "stage", id, "created", null, { id, label: name }, {
        changedBy: user.id,
      });
      return row;
    });
    res.status(201).json(created);
  } catch (err) {
    mapError(err, res, "Failed to create stage");
  }
});

router.patch("/admin/stages/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid stage id" });
    return;
  }
  const body = (req.body ?? {}) as StageInput;
  const user = currentUser(res);
  try {
    const updates: Partial<typeof stagesTable.$inferInsert> = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (body.probability !== undefined) updates.probability = parseProbability(body.probability);
    if (body.rottingDays !== undefined) updates.rottingDays = parseRottingDays(body.rottingDays);
    if (body.requiredFields !== undefined)
      updates.requiredFields = await parseRequiredFields(body.requiredFields);
    if (typeof body.archived === "boolean") updates.archived = body.archived;

    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(stagesTable)
        .where(eq(stagesTable.id, id))
        .for("update");
      if (!before) return { status: 404 as const, error: "Stage not found" };
      // Archiving must not strand open deals in a hidden column.
      if (updates.archived === true && !before.archived) {
        const active = await stageActiveDealCount(tx, id);
        if (active > 0)
          throw new PipelineAdminError(
            "Stage has active deals: move them to another stage before archiving",
            409,
            { deals: active, needsReassign: true },
          );
      }
      if (Object.keys(updates).length) {
        await tx.update(stagesTable).set(updates).where(eq(stagesTable.id, id));
        await logEntityChanges(
          tx,
          "stage",
          id,
          before,
          updates,
          [
            { key: "name", fieldKey: "name" },
            { key: "probability", fieldKey: "probability" },
            { key: "rottingDays", fieldKey: "rotting_days" },
            { key: "requiredFields", fieldKey: "required_fields" },
            { key: "archived", fieldKey: "archived" },
          ],
          { changedBy: user.id },
        );
      }
      return { status: 200 as const };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const [updated] = await db.select().from(stagesTable).where(eq(stagesTable.id, id));
    res.json(updated);
  } catch (err) {
    mapError(err, res, "Failed to update stage");
  }
});

router.post("/admin/stages/reorder", requireAdmin, async (req, res): Promise<void> => {
  const pipelineId = Number(req.body?.pipelineId);
  // Deduped so a repeated id in the client payload can't be moved twice while
  // its audit diff is still computed against the pre-reorder snapshot.
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set((req.body.ids as unknown[]).map(Number).filter(Number.isInteger))]
    : [];
  if (!Number.isInteger(pipelineId)) {
    res.status(400).json({ error: "pipelineId is required" });
    return;
  }
  const user = currentUser(res);
  try {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: stagesTable.id, orderIndex: stagesTable.orderIndex })
        .from(stagesTable)
        .where(and(inArray(stagesTable.id, ids), eq(stagesTable.pipelineId, pipelineId)));
      const oldIndexById = new Map(existing.map((r) => [r.id, r.orderIndex]));
      const events: EntityEventInput[] = [];
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(stagesTable)
          .set({ orderIndex: i })
          .where(and(eq(stagesTable.id, ids[i]!), eq(stagesTable.pipelineId, pipelineId)));
        const oldIndex = oldIndexById.get(ids[i]!);
        if (oldIndex !== undefined && oldIndex !== i) {
          events.push({
            entityType: "stage",
            entityId: ids[i]!,
            fieldKey: "reorder",
            oldValue: { label: String(oldIndex) },
            newValue: { label: String(i) },
          });
        }
      }
      await logEntityEvents(tx, events, { changedBy: user.id, source: "ui" });
    });
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    mapError(err, res, "Failed to reorder stages");
  }
});

router.delete("/admin/stages/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid stage id" });
    return;
  }
  const reassignToStageId = Number(req.body?.reassignToStageId);
  const user = currentUser(res);
  const now = new Date();
  try {
    const result = await db.transaction(async (tx) => {
      const [stage] = await tx
        .select()
        .from(stagesTable)
        .where(eq(stagesTable.id, id))
        .for("update");
      if (!stage) return { status: 404 as const, error: "Stage not found" };
      const [{ siblings }] = await tx
        .select({ siblings: sql<number>`count(*)::int` })
        .from(stagesTable)
        .where(eq(stagesTable.pipelineId, stage.pipelineId));
      if (siblings <= 1)
        throw new PipelineAdminError("Cannot delete the last stage in a pipeline", 400);

      // Any deal (any status) referencing the stage blocks deletion via the FK.
      const [{ deals }] = await tx
        .select({ deals: sql<number>`count(*)::int` })
        .from(dealsTable)
        .where(eq(dealsTable.stageId, id));
      if (deals > 0) {
        if (!Number.isInteger(reassignToStageId))
          throw new PipelineAdminError(
            "Stage has deals: provide reassignToStageId to move them first",
            409,
            { deals, needsReassign: true },
          );
        const [target] = await tx
          .select()
          .from(stagesTable)
          .where(eq(stagesTable.id, reassignToStageId));
        if (
          !target ||
          target.id === id ||
          target.pipelineId !== stage.pipelineId ||
          target.archived
        )
          throw new PipelineAdminError(
            "Reassignment target must be another active stage in the same pipeline",
            400,
          );
        // Audit the active deals we move (deleted deals just satisfy the FK).
        const activeBefore = await tx
          .select()
          .from(dealsTable)
          .where(and(eq(dealsTable.stageId, id), ne(dealsTable.status, "deleted")));
        await tx
          .update(dealsTable)
          .set({ stageId: reassignToStageId, stageChangeTime: now })
          .where(eq(dealsTable.stageId, id));
        if (activeBefore.length) {
          await logDealChanges(
            tx,
            activeBefore.map((d) => ({ before: d, patch: { stageId: reassignToStageId } })),
            { changedBy: user.id, changedAt: now },
          );
        }
      }
      await tx.delete(stagesTable).where(eq(stagesTable.id, id));
      await logEntityEvent(tx, "stage", id, "deleted", { id, label: stage.name }, null, {
        changedBy: user.id,
      });
      return { status: 200 as const };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    mapError(err, res, "Failed to delete stage");
  }
});

export default router;
