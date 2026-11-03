import { Router, type IRouter } from "express";
import { and, desc, eq, or, count, type SQL } from "drizzle-orm";
import {
  db,
  personsTable,
  organizationsTable,
  dealsTable,
  activitiesTable,
  notesTable,
  filesTable,
  leadsTable,
} from "@workspace/db";
import {
  ListPersonsQueryParams,
  ListPersonsResponse,
  CreatePersonBody,
  GetPersonParams,
  GetPersonResponse,
  UpdatePersonParams,
  UpdatePersonBody,
  UpdatePersonResponse,
  DeletePersonParams,
  GetPersonHistoryParams,
  GetPersonHistoryResponse,
} from "@workspace/api-zod";
import {
  personQuery,
  loadPersonById,
  parsePagination,
  resolveOrderBy,
  personDealCount,
  personSearchConditions,
} from "../lib/queries";
import { currentUser } from "../lib/auth";
import {
  logEntityEvent,
  logFieldChanges,
  TRACKED_PERSON_FIELDS,
  loadEntityHistory,
} from "../lib/change-events";

const router: IRouter = Router();

// Paginated, filtered search — the high-performance list endpoint. Registered
// before "/persons/:id" so the literal path wins.
router.get("/persons/search", async (req, res): Promise<void> => {
  const conditions: SQL[] = [];
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    const cond = or(...personSearchConditions(q));
    if (cond) conditions.push(cond);
  }
  const orgId = Number(req.query.organizationId);
  if (Number.isFinite(orgId)) conditions.push(eq(personsTable.organizationId, orgId));
  const ownerId = Number(req.query.ownerId);
  if (Number.isFinite(ownerId)) conditions.push(eq(personsTable.ownerId, ownerId));

  const where = conditions.length ? and(...conditions) : undefined;
  const { page, limit, offset } = parsePagination(
    req.query as Record<string, unknown>,
  );
  // Keys must match the column ids the contacts grid sends as `field:dir`.
  const orderBy = resolveOrderBy(
    req.query.sort as string | undefined,
    {
      name: personsTable.name,
      email: personsTable.email,
      phone: personsTable.phone,
      jobTitle: personsTable.jobTitle,
      organization: organizationsTable.name,
      deals: personDealCount,
      updateTime: personsTable.updateTime,
      addTime: personsTable.addTime,
    },
    [desc(personsTable.updateTime)],
    personsTable.id,
  );

  const items = await personQuery()
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(personsTable)
    .where(where);

  res.json({ items, page, limit, total });
});

router.get("/persons", async (req, res): Promise<void> => {
  const parsed = ListPersonsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions: SQL[] = [];
  if (parsed.data.q) {
    const cond = or(...personSearchConditions(parsed.data.q));
    if (cond) conditions.push(cond);
  }
  const rows = await personQuery()
    .where(and(...conditions))
    .orderBy(desc(personsTable.updateTime));
  res.json(ListPersonsResponse.parse(rows));
});

router.post("/persons", async (req, res): Promise<void> => {
  const parsed = CreatePersonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const user = currentUser(res);
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(personsTable)
      .values({
        name: d.name,
        phone: d.phone ?? null,
        email: d.email ?? null,
        jobTitle: d.jobTitle?.trim() || null,
        organizationId: d.organizationId ?? null,
        labels: d.labels ?? null,
        ownerId: user.id,
      })
      .returning();
    await logEntityEvent(tx, "person", row.id, "created", null, { id: row.id, label: row.name }, {
      changedBy: user.id,
      source: "ui",
    });
    return row;
  });
  const person = await loadPersonById(created.id);
  res.status(201).json(GetPersonResponse.parse(person));
});

router.get("/persons/:id", async (req, res): Promise<void> => {
  const params = GetPersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const person = await loadPersonById(params.data.id);
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json(GetPersonResponse.parse(person));
});

router.patch("/persons/:id", async (req, res): Promise<void> => {
  const params = UpdatePersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePersonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(personsTable)
      .where(eq(personsTable.id, params.data.id))
      .for("update");
    if (!existing) return null;
    const [row] = await tx
      .update(personsTable)
      .set(parsed.data)
      .where(eq(personsTable.id, params.data.id))
      .returning();
    await logFieldChanges(
      tx,
      "person",
      [{ entityId: row.id, before: existing, patch: parsed.data }],
      TRACKED_PERSON_FIELDS,
      { changedBy: user.id, source: "ui" },
    );
    return row;
  });
  if (!updated) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  const person = await loadPersonById(updated.id);
  res.json(UpdatePersonResponse.parse(person));
});

router.delete("/persons/:id", async (req, res): Promise<void> => {
  const params = DeletePersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const user = currentUser(res);
  const found = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(personsTable)
      .where(eq(personsTable.id, id))
      .for("update");
    if (!existing) return false;
    await tx
      .update(dealsTable)
      .set({ personId: null })
      .where(eq(dealsTable.personId, id));
    await tx
      .update(activitiesTable)
      .set({ personId: null })
      .where(eq(activitiesTable.personId, id));
    await tx
      .update(notesTable)
      .set({ personId: null })
      .where(eq(notesTable.personId, id));
    // Pipedrive-era file links and leads hold NO ACTION foreign keys too;
    // left in place they fail the delete.
    await tx
      .update(filesTable)
      .set({ personId: null })
      .where(eq(filesTable.personId, id));
    await tx
      .update(leadsTable)
      .set({ personId: null })
      .where(eq(leadsTable.personId, id));
    await tx.delete(personsTable).where(eq(personsTable.id, id));
    await logEntityEvent(tx, "person", id, "deleted", { id, label: existing.name }, null, {
      changedBy: user.id,
      source: "ui",
    });
    return true;
  });
  if (!found) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/persons/:id/history", async (req, res): Promise<void> => {
  const params = GetPersonHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const person = await loadPersonById(params.data.id);
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  const events = await loadEntityHistory("person", params.data.id);
  res.json(GetPersonHistoryResponse.parse({ events }));
});

export default router;
