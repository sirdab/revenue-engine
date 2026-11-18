import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, count, type SQL } from "drizzle-orm";
import {
  db,
  organizationsTable,
  personsTable,
  dealsTable,
  activitiesTable,
  notesTable,
} from "@workspace/db";
import {
  ListOrganizationsQueryParams,
  ListOrganizationsResponse,
  CreateOrganizationBody,
  GetOrganizationParams,
  GetOrganizationResponse,
  UpdateOrganizationParams,
  UpdateOrganizationBody,
  UpdateOrganizationResponse,
  DeleteOrganizationParams,
  GetOrganizationHistoryParams,
  GetOrganizationHistoryResponse,
} from "@workspace/api-zod";
import {
  organizationQuery,
  loadOrganizationById,
  parsePagination,
  resolveOrderBy,
  orgDealCount,
  orgPersonCount,
  escapeLike,
} from "../lib/queries";
import { currentUser } from "../lib/auth";
import {
  logEntityEvent,
  logFieldChanges,
  TRACKED_ORG_FIELDS,
  loadEntityHistory,
} from "../lib/change-events";

const router: IRouter = Router();

// Paginated, filtered search — high-performance list endpoint.
router.get("/organizations/search", async (req, res): Promise<void> => {
  const conditions: SQL[] = [];
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    const term = `%${escapeLike(q)}%`;
    const cond = or(
      ilike(organizationsTable.name, term),
      ilike(organizationsTable.address, term),
    );
    if (cond) conditions.push(cond);
  }
  const ownerId = Number(req.query.ownerId);
  if (Number.isFinite(ownerId)) conditions.push(eq(organizationsTable.ownerId, ownerId));

  const where = conditions.length ? and(...conditions) : undefined;
  const { page, limit, offset } = parsePagination(
    req.query as Record<string, unknown>,
  );
  // Keys must match the column ids the contacts grid sends as `field:dir`.
  const orderBy = resolveOrderBy(
    req.query.sort as string | undefined,
    {
      name: organizationsTable.name,
      address: organizationsTable.address,
      persons: orgPersonCount,
      deals: orgDealCount,
      updateTime: organizationsTable.updateTime,
      addTime: organizationsTable.addTime,
    },
    [desc(organizationsTable.updateTime)],
    organizationsTable.id,
  );

  const items = await organizationQuery()
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(organizationsTable)
    .where(where);

  res.json({ items, page, limit, total });
});

router.get("/organizations", async (req, res): Promise<void> => {
  const parsed = ListOrganizationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions: SQL[] = [];
  if (parsed.data.q) {
    conditions.push(
      ilike(organizationsTable.name, `%${escapeLike(parsed.data.q)}%`),
    );
  }
  const rows = await organizationQuery()
    .where(and(...conditions))
    .orderBy(desc(organizationsTable.updateTime));
  res.json(ListOrganizationsResponse.parse(rows));
});

router.post("/organizations", async (req, res): Promise<void> => {
  const parsed = CreateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const user = currentUser(res);
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizationsTable)
      .values({
        name: d.name,
        address: d.address ?? null,
        labels: d.labels ?? null,
        ownerId: user.id,
      })
      .returning();
    await logEntityEvent(tx, "organization", row.id, "created", null, { id: row.id, label: row.name }, {
      changedBy: user.id,
      source: "ui",
    });
    return row;
  });
  const org = await loadOrganizationById(created.id);
  res.status(201).json(GetOrganizationResponse.parse(org));
});

router.get("/organizations/:id", async (req, res): Promise<void> => {
  const params = GetOrganizationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const org = await loadOrganizationById(params.data.id);
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json(GetOrganizationResponse.parse(org));
});

router.patch("/organizations/:id", async (req, res): Promise<void> => {
  const params = UpdateOrganizationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, params.data.id))
      .for("update");
    if (!existing) return null;
    const [row] = await tx
      .update(organizationsTable)
      .set(parsed.data)
      .where(eq(organizationsTable.id, params.data.id))
      .returning();
    await logFieldChanges(
      tx,
      "organization",
      [{ entityId: row.id, before: existing, patch: parsed.data }],
      TRACKED_ORG_FIELDS,
      { changedBy: user.id, source: "ui" },
    );
    return row;
  });
  if (!updated) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const org = await loadOrganizationById(updated.id);
  res.json(UpdateOrganizationResponse.parse(org));
});

router.delete("/organizations/:id", async (req, res): Promise<void> => {
  const params = DeleteOrganizationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const user = currentUser(res);
  const found = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, id))
      .for("update");
    if (!existing) return false;
    await tx
      .update(personsTable)
      .set({ organizationId: null })
      .where(eq(personsTable.organizationId, id));
    await tx
      .update(dealsTable)
      .set({ organizationId: null })
      .where(eq(dealsTable.organizationId, id));
    await tx
      .update(activitiesTable)
      .set({ orgId: null })
      .where(eq(activitiesTable.orgId, id));
    await tx
      .update(notesTable)
      .set({ orgId: null })
      .where(eq(notesTable.orgId, id));
    await tx.delete(organizationsTable).where(eq(organizationsTable.id, id));
    await logEntityEvent(tx, "organization", id, "deleted", { id, label: existing.name }, null, {
      changedBy: user.id,
      source: "ui",
    });
    return true;
  });
  if (!found) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/organizations/:id/history", async (req, res): Promise<void> => {
  const params = GetOrganizationHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const org = await loadOrganizationById(params.data.id);
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const events = await loadEntityHistory("organization", params.data.id);
  res.json(GetOrganizationHistoryResponse.parse({ events }));
});

export default router;
