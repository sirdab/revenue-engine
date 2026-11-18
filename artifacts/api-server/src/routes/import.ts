import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import {
  db,
  organizationsTable,
  personsTable,
  dealsTable,
  pipelinesTable,
  stagesTable,
  usersTable,
} from "@workspace/db";
import {
  ImportOrganizationsBody,
  ImportPersonsBody,
  ImportDealsBody,
  ImportOrganizationsResponse,
  ImportPersonsResponse,
  ImportDealsResponse,
} from "@workspace/api-zod";
import { currentUser, requireAdmin } from "../lib/auth";
import { logDealCreated } from "../lib/change-events";
import { isRealIsoDate } from "../lib/assistant-dates";
import { phoneNsn, phoneDigitsSql, phoneDigitsVariants, PHONE_MIN_NSN } from "../lib/queries";

// ---------------------------------------------------------------------------
// Bulk CSV import for organizations, persons and deals.
//
// The frontend wizard validates rows client-side and submits only the rows the
// user accepted, with values already coerced to the right types. This router is
// the AUTHORITATIVE layer: it re-checks every foreign key (owner / org / person
// exist, and a deal's stage belongs to its pipeline) that the client cannot
// verify, inserts the rows that pass in a single transaction, and returns a
// per-row report so the UI can show exactly which rows were rejected and why.
//
// Semantics (per product decision): create-only (never updates/dedupes),
// admin-only (every route is requireAdmin-gated), and links are by id (the
// wizard fills a single bulk-selected default into rows that omit the column).
//
// Exception: the deals import can create a contact inline. A deal row with a
// personPhone (and no explicit personId) links an existing contact that shares
// the phone, or creates one from personPhone/personName/personEmail — so deals
// and their contacts can be imported in a single pass.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// Bounds a single request so one import can't lock the table for minutes. The
// wizard chunks larger files beneath this limit.
const MAX_ROWS = 5000;

// Postgres caps one statement at 65,535 bind parameters, and MAX_ROWS rows of
// a dozen-plus columns passes it. Each import inserts in slices of this size,
// inside one transaction so a batch still lands whole or not at all.
const INSERT_CHUNK = 1000;
function inChunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    out.push(rows.slice(i, i + INSERT_CHUNK));
  }
  return out;
}

interface RowError {
  row: number; // 1-based index within the submitted batch
  message: string;
  field: string | null;
}

/** Distinct, finite ids from a column of optional references. */
function refIds(ids: Array<number | null | undefined>): number[] {
  return [
    ...new Set(
      ids.filter((n): n is number => typeof n === "number" && Number.isFinite(n)),
    ),
  ];
}

async function userIdSet(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  return new Set(rows.map((r) => r.id));
}

async function organizationIdSet(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(inArray(organizationsTable.id, ids));
  return new Set(rows.map((r) => r.id));
}

async function personIdSet(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: personsTable.id })
    .from(personsTable)
    .where(inArray(personsTable.id, ids));
  return new Set(rows.map((r) => r.id));
}

// For the deals importer's inline contact creation: map a normalized phone
// (national number, see phoneNsn) to the most-recently-created person carrying
// it, so a deal row links the existing contact instead of spawning a duplicate.
// Matching on the normalized form, not the raw string, mirrors the rest of the
// app (search.ts / queries.ts): "+44 7700 900123" and "07700900123" reuse the
// same contact when PHONE_COUNTRY_CODE=44.
async function personIdsByPhoneNsn(nsns: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!nsns.length) return map;
  const rows = await db
    .select({ id: personsTable.id, phone: personsTable.phone })
    .from(personsTable)
    .where(inArray(phoneDigitsSql(personsTable.phone), nsns.flatMap(phoneDigitsVariants)));
  for (const r of rows) {
    const nsn = phoneNsn(r.phone);
    if (!nsn) continue;
    const prev = map.get(nsn);
    if (prev == null || r.id > prev) map.set(nsn, r.id);
  }
  return map;
}

// Dedup key for an inline contact phone. A phone-shaped value keys on its NSN
// (so formatting variants collapse to one contact); anything too short to be a
// phone keys on the raw string, so it never reuses a contact on a stray digit
// or collides with another number's NSN.
function phoneKey(raw: string): string {
  const nsn = phoneNsn(raw);
  return nsn.length >= PHONE_MIN_NSN ? `nsn:${nsn}` : `raw:${raw.trim()}`;
}

// ---------------------------------------------------------------------------
// POST /import/organizations
// ---------------------------------------------------------------------------
router.post("/import/organizations", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ImportOrganizationsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { rows } = parsed.data;
  if (rows.length > MAX_ROWS) {
    res.status(400).json({ error: `Too many rows (max ${MAX_ROWS}).` });
    return;
  }
  const user = currentUser(res);

  const validOwners = await userIdSet(refIds(rows.map((r) => r.ownerId)));

  const errors: RowError[] = [];
  const values: (typeof organizationsTable.$inferInsert)[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (!r.name?.trim()) {
      errors.push({ row: rowNo, message: "Name is required.", field: "name" });
      return;
    }
    if (r.ownerId != null && !validOwners.has(r.ownerId)) {
      errors.push({
        row: rowNo,
        message: `Owner ${r.ownerId} does not exist.`,
        field: "ownerId",
      });
      return;
    }
    values.push({
      name: r.name.trim(),
      address: r.address ?? null,
      ownerId: r.ownerId ?? user.id,
    });
  });

  try {
    const created = await db.transaction(async (tx) => {
      const ids: { id: number }[] = [];
      for (const chunk of inChunks(values)) {
        ids.push(
          ...(await tx
            .insert(organizationsTable)
            .values(chunk)
            .returning({ id: organizationsTable.id })),
        );
      }
      return ids;
    });
    res.json(
      ImportOrganizationsResponse.parse({
        created: created.length,
        failed: errors.length,
        errors,
      }),
    );
  } catch {
    res.status(500).json({ error: "Failed to import organizations." });
  }
});

// ---------------------------------------------------------------------------
// POST /import/persons
// ---------------------------------------------------------------------------
router.post("/import/persons", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ImportPersonsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { rows } = parsed.data;
  if (rows.length > MAX_ROWS) {
    res.status(400).json({ error: `Too many rows (max ${MAX_ROWS}).` });
    return;
  }
  const user = currentUser(res);

  const [validOwners, validOrgs] = await Promise.all([
    userIdSet(refIds(rows.map((r) => r.ownerId))),
    organizationIdSet(refIds(rows.map((r) => r.organizationId))),
  ]);

  const errors: RowError[] = [];
  const values: (typeof personsTable.$inferInsert)[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (!r.name?.trim()) {
      errors.push({ row: rowNo, message: "Name is required.", field: "name" });
      return;
    }
    if (r.organizationId != null && !validOrgs.has(r.organizationId)) {
      errors.push({
        row: rowNo,
        message: `Organization ${r.organizationId} does not exist.`,
        field: "organizationId",
      });
      return;
    }
    if (r.ownerId != null && !validOwners.has(r.ownerId)) {
      errors.push({
        row: rowNo,
        message: `Owner ${r.ownerId} does not exist.`,
        field: "ownerId",
      });
      return;
    }
    values.push({
      name: r.name.trim(),
      email: r.email ?? null,
      phone: r.phone ?? null,
      jobTitle: r.jobTitle?.trim() || null,
      organizationId: r.organizationId ?? null,
      ownerId: r.ownerId ?? user.id,
    });
  });

  try {
    const created = await db.transaction(async (tx) => {
      const ids: { id: number }[] = [];
      for (const chunk of inChunks(values)) {
        ids.push(
          ...(await tx
            .insert(personsTable)
            .values(chunk)
            .returning({ id: personsTable.id })),
        );
      }
      return ids;
    });
    res.json(
      ImportPersonsResponse.parse({
        created: created.length,
        failed: errors.length,
        errors,
      }),
    );
  } catch {
    res.status(500).json({ error: "Failed to import persons." });
  }
});

// ---------------------------------------------------------------------------
// POST /import/deals
// ---------------------------------------------------------------------------
router.post("/import/deals", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ImportDealsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { rows } = parsed.data;
  if (rows.length > MAX_ROWS) {
    res.status(400).json({ error: `Too many rows (max ${MAX_ROWS}).` });
    return;
  }
  const user = currentUser(res);
  const now = new Date();

  // Pull every referenced parent in one round-trip each. Stages carry their
  // pipelineId so we can verify the (pipeline, stage) pairing per row.
  const pipelineIds = refIds(rows.map((r) => r.pipelineId));
  const stageIds = refIds(rows.map((r) => r.stageId));
  // Distinct phone NSNs from rows that want an inline contact (phone present,
  // no explicit personId), used to reuse existing contacts instead of
  // duplicating. Short/non-phone values are excluded so we never match an
  // existing contact (or every null-phone contact) on a stray digit.
  const inlineNsns = [
    ...new Set(
      rows
        .filter((r) => r.personId == null && r.personPhone?.trim())
        .map((r) => phoneNsn(r.personPhone))
        .filter((nsn) => nsn.length >= PHONE_MIN_NSN),
    ),
  ];
  const [
    validPipelines,
    stageRows,
    validOwners,
    validPersons,
    validOrgs,
    existingByNsn,
  ] = await Promise.all([
      pipelineIds.length
        ? db
            .select({ id: pipelinesTable.id })
            .from(pipelinesTable)
            .where(inArray(pipelinesTable.id, pipelineIds))
        : Promise.resolve([] as { id: number }[]),
      stageIds.length
        ? db
            .select({ id: stagesTable.id, pipelineId: stagesTable.pipelineId })
            .from(stagesTable)
            .where(inArray(stagesTable.id, stageIds))
        : Promise.resolve([] as { id: number; pipelineId: number }[]),
      userIdSet(refIds(rows.map((r) => r.ownerId))),
      personIdSet(refIds(rows.map((r) => r.personId))),
      organizationIdSet(refIds(rows.map((r) => r.organizationId))),
      personIdsByPhoneNsn(inlineNsns),
    ]);
  const pipelineSet = new Set(validPipelines.map((p) => p.id));
  const stagePipeline = new Map(stageRows.map((s) => [s.id, s.pipelineId]));

  // Contacts to create for inline rows, deduped by phone key so two deals
  // sharing a phone (in any format) produce one contact. Filled during row
  // validation, inserted in the transaction below; `pendingKeys[i]` marks which
  // created contact deal `i` links once the person ids are known.
  const newPersonByKey = new Map<string, typeof personsTable.$inferInsert>();
  const pendingKeys: (string | null)[] = [];

  const errors: RowError[] = [];
  const values: (typeof dealsTable.$inferInsert)[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (!r.title?.trim()) {
      errors.push({ row: rowNo, message: "Title is required.", field: "title" });
      return;
    }
    if (!pipelineSet.has(r.pipelineId)) {
      errors.push({
        row: rowNo,
        message: `Pipeline ${r.pipelineId} does not exist.`,
        field: "pipelineId",
      });
      return;
    }
    if (!stagePipeline.has(r.stageId)) {
      errors.push({
        row: rowNo,
        message: `Stage ${r.stageId} does not exist.`,
        field: "stageId",
      });
      return;
    }
    if (stagePipeline.get(r.stageId) !== r.pipelineId) {
      errors.push({
        row: rowNo,
        message: `Stage ${r.stageId} does not belong to pipeline ${r.pipelineId}.`,
        field: "stageId",
      });
      return;
    }
    if (r.ownerId != null && !validOwners.has(r.ownerId)) {
      errors.push({
        row: rowNo,
        message: `Owner ${r.ownerId} does not exist.`,
        field: "ownerId",
      });
      return;
    }
    if (r.personId != null && !validPersons.has(r.personId)) {
      errors.push({
        row: rowNo,
        message: `Person ${r.personId} does not exist.`,
        field: "personId",
      });
      return;
    }
    // A name/email with no phone (and no personId) can't become a contact —
    // phone is what identifies and dedupes the inline contact. Reject rather
    // than silently drop the contact details.
    const inlinePhone = r.personId == null ? r.personPhone?.trim() : undefined;
    if (
      r.personId == null &&
      !inlinePhone &&
      (r.personName?.trim() || r.personEmail?.trim())
    ) {
      errors.push({
        row: rowNo,
        message:
          "A person phone is required to create a contact (set personPhone, or set personId to link an existing one).",
        field: "personPhone",
      });
      return;
    }
    if (r.organizationId != null && !validOrgs.has(r.organizationId)) {
      errors.push({
        row: rowNo,
        message: `Organization ${r.organizationId} does not exist.`,
        field: "organizationId",
      });
      return;
    }
    // The wizard checks only the date's shape, so an impossible date like
    // 2026-02-30 used to reach the insert and fail the whole batch with a 500.
    if (r.expectedCloseDate != null && !isRealIsoDate(r.expectedCloseDate)) {
      errors.push({
        row: rowNo,
        message: `Expected close date ${r.expectedCloseDate} is not a real date (YYYY-MM-DD).`,
        field: "expectedCloseDate",
      });
      return;
    }
    if (r.value != null && r.value < 0) {
      errors.push({
        row: rowNo,
        message: "Value can't be negative.",
        field: "value",
      });
      return;
    }
    // Resolve the deal's contact: an explicit personId wins; otherwise an
    // inline phone links an existing contact (reused by its normalized NSN) or
    // schedules a new contact to be created in the transaction below.
    let resolvedPersonId: number | null = r.personId ?? null;
    let pendingKey: string | null = null;
    if (resolvedPersonId == null && inlinePhone) {
      const nsn = phoneNsn(inlinePhone);
      const existing =
        nsn.length >= PHONE_MIN_NSN ? existingByNsn.get(nsn) : undefined;
      if (existing != null) {
        resolvedPersonId = existing;
      } else {
        const key = phoneKey(inlinePhone);
        pendingKey = key;
        if (!newPersonByKey.has(key)) {
          newPersonByKey.set(key, {
            name: r.personName?.trim() || "Unknown",
            phone: inlinePhone,
            email: r.personEmail?.trim() || null,
            organizationId: r.organizationId ?? null,
            ownerId: r.ownerId ?? user.id,
          });
        }
      }
    }
    pendingKeys.push(pendingKey);
    values.push({
      title: r.title.trim(),
      value: r.value ?? 0,
      currency: r.currency ?? user.defaultCurrency ?? "USD",
      pipelineId: r.pipelineId,
      stageId: r.stageId,
      ownerId: r.ownerId ?? user.id,
      creatorUserId: user.id,
      personId: resolvedPersonId,
      organizationId: r.organizationId ?? null,
      expectedCloseDate: r.expectedCloseDate ?? null,
      labels: r.labels ?? null,
      stageChangeTime: now,
    });
  });

  try {
    const created = await db.transaction(async (tx) => {
      // Create the inline contacts first, then point their deals at the new ids.
      if (newPersonByKey.size) {
        const keyToId = new Map<string, number>();
        for (const chunk of inChunks([...newPersonByKey.values()])) {
          const createdPersons = await tx
            .insert(personsTable)
            .values(chunk)
            .returning({ id: personsTable.id, phone: personsTable.phone });
          for (const p of createdPersons) {
            if (p.phone != null) keyToId.set(phoneKey(p.phone), p.id);
          }
        }
        values.forEach((v, idx) => {
          const key = pendingKeys[idx];
          if (key != null) v.personId = keyToId.get(key) ?? null;
        });
      }

      const inserted: (typeof dealsTable.$inferSelect)[] = [];
      for (const chunk of inChunks(values)) {
        inserted.push(...(await tx.insert(dealsTable).values(chunk).returning()));
      }
      // Mirror single-create: every imported deal gets a "created" audit entry
      // tagged with source="import".
      for (const row of inserted) {
        await logDealCreated(tx, row, { changedBy: user.id, source: "import" });
      }
      return inserted;
    });
    res.json(
      ImportDealsResponse.parse({
        created: created.length,
        failed: errors.length,
        errors,
      }),
    );
  } catch {
    res.status(500).json({ error: "Failed to import deals." });
  }
});

export default router;
