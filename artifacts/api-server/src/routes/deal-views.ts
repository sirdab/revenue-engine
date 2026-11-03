import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, dealViewsTable } from "@workspace/db";
import {
  ListDealViewsResponse,
  ListDealViewsResponseItem,
  CreateDealViewBody,
  UpdateDealViewParams,
  UpdateDealViewBody,
  UpdateDealViewResponse,
  DeleteDealViewParams,
} from "@workspace/api-zod";
import { currentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/deal-views", async (_req, res): Promise<void> => {
  const user = currentUser(res);
  const rows = await db
    .select()
    .from(dealViewsTable)
    .where(eq(dealViewsTable.userId, user.id))
    .orderBy(desc(dealViewsTable.updated));
  res.json(ListDealViewsResponse.parse(rows));
});

router.post("/deal-views", async (req, res): Promise<void> => {
  const parsed = CreateDealViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const [created] = await db
    .insert(dealViewsTable)
    .values({
      userId: user.id,
      name: parsed.data.name,
      definition: parsed.data.definition,
    })
    .returning();
  res.status(201).json(ListDealViewsResponseItem.parse(created));
});

router.patch("/deal-views/:id", async (req, res): Promise<void> => {
  const params = UpdateDealViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDealViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);

  const updates: Partial<typeof dealViewsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.definition !== undefined)
    updates.definition = parsed.data.definition;

  if (Object.keys(updates).length === 0) {
    const [existing] = await db
      .select()
      .from(dealViewsTable)
      .where(
        and(
          eq(dealViewsTable.id, params.data.id),
          eq(dealViewsTable.userId, user.id),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "View not found" });
      return;
    }
    res.json(UpdateDealViewResponse.parse(existing));
    return;
  }

  const [updated] = await db
    .update(dealViewsTable)
    .set(updates)
    .where(
      and(
        eq(dealViewsTable.id, params.data.id),
        eq(dealViewsTable.userId, user.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  res.json(UpdateDealViewResponse.parse(updated));
});

router.delete("/deal-views/:id", async (req, res): Promise<void> => {
  const params = DeleteDealViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const [deleted] = await db
    .delete(dealViewsTable)
    .where(
      and(
        eq(dealViewsTable.id, params.data.id),
        eq(dealViewsTable.userId, user.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
