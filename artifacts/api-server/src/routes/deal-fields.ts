import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  dealsTable,
  dealFieldsTable,
  dealFieldOptionsTable,
  DEAL_FIELD_TYPES,
  type DealFieldConfig,
} from "@workspace/db";
import {
  loadFieldRegistry,
  resolveDealFields,
  setDealField,
  runDiscovery,
  fieldUsageCounts,
  reconcileFieldIndexes,
  purgeFieldValues,
  DealFieldError,
  type ResolvedField,
} from "../lib/deal-fields";
import { currentUser, requireAdmin } from "../lib/auth";
import { ARCHIVED_DEAL_ERROR } from "../lib/queries";
import { invalidateDealsFieldCatalog } from "../lib/insights/fields";
import { logger } from "../lib/logger";
import { clientErrorFromDb } from "../lib/pg-errors";
import { normalizeFieldConfig } from "../lib/deal-field-config";

const router: IRouter = Router();

// Any successful registry mutation on this router drops the Insights field
// catalog cache immediately, so an admin edit is buildable/filterable right
// away on this instance (other autoscale instances converge via the 30s TTL).
router.use((req, res, next) => {
  if (req.method !== "GET") {
    res.on("finish", () => {
      if (res.statusCode < 400) invalidateDealsFieldCatalog();
    });
  }
  next();
});

// ---------------------------------------------------------------------------
// Per-deal field values (auth) — the deal detail consumes these.
// ---------------------------------------------------------------------------

/** Resolve every field + value for a deal (each carries an `active` flag so
 *  the client can render inactive-but-filled data), or null if the deal is
 *  gone. */
async function resolvedFor(dealId: number): Promise<ResolvedField[] | null> {
  const [deal] = await db
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.id, dealId));
  if (!deal) return null;
  const registry = await loadFieldRegistry(true);
  return resolveDealFields(deal, registry);
}

router.get("/deals/:id/fields", async (req, res): Promise<void> => {
  const dealId = Number(req.params.id);
  if (!Number.isInteger(dealId)) {
    res.status(400).json({ error: "Invalid deal id" });
    return;
  }
  try {
    const fields = await resolvedFor(dealId);
    if (!fields) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    res.json({ fields });
  } catch (err) {
    logger.error({ err }, "Failed to resolve deal fields");
    res.status(500).json({ error: "Failed to load deal fields." });
  }
});

// Write a single field value. Auth (not admin) — any user editing the deal.
router.put("/deals/:id/fields/:key", async (req, res): Promise<void> => {
  const dealId = Number(req.params.id);
  const key = req.params.key;
  if (!Number.isInteger(dealId)) {
    res.status(400).json({ error: "Invalid deal id" });
    return;
  }
  const user = currentUser(res);
  try {
    const result = await db.transaction(async (tx) => {
      // Lock the deal row so the audit diff is computed against a stable snapshot.
      const [deal] = await tx
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, dealId))
        .for("update");
      if (!deal) return { status: 404 as const, error: "Deal not found" };
      // Archived deals are read-only — field values included.
      if (deal.archived) {
        return { status: 409 as const, error: ARCHIVED_DEAL_ERROR };
      }
      const [field] = await tx
        .select()
        .from(dealFieldsTable)
        .where(eq(dealFieldsTable.key, key));
      if (!field) return { status: 404 as const, error: "Field not found" };
      const options =
        field.fieldType === "enum" || field.fieldType === "set"
          ? await tx
              .select()
              .from(dealFieldOptionsTable)
              .where(
                and(
                  eq(dealFieldOptionsTable.fieldId, field.id),
                  eq(dealFieldOptionsTable.active, true),
                ),
              )
          : [];

      await setDealField(tx, deal, field, options, req.body?.value, {
        changedBy: user.id,
      });
      return { status: 200 as const };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ fields: await resolvedFor(dealId) });
  } catch (err) {
    if (err instanceof DealFieldError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const clientError = clientErrorFromDb(err);
    if (clientError) {
      res.status(clientError.status).json({ error: clientError.error });
      return;
    }
    logger.error({ err }, "Failed to set deal field");
    res.status(500).json({ error: "Failed to save the field." });
  }
});

// ---------------------------------------------------------------------------
// Field registry (read: auth; mutations: admin).
// ---------------------------------------------------------------------------

router.get("/deal-fields", async (req, res): Promise<void> => {
  try {
    const fields = await db
      .select()
      .from(dealFieldsTable)
      .orderBy(asc(dealFieldsTable.orderIndex), asc(dealFieldsTable.id));
    const options = fields.length
      ? await db
          .select()
          .from(dealFieldOptionsTable)
          .orderBy(asc(dealFieldOptionsTable.orderIndex), asc(dealFieldOptionsTable.id))
      : [];
    // The admin screen wants usage counts; skip the extra work otherwise.
    const withUsage = req.query.usage === "1" && fields.length > 0;
    const usage = withUsage ? await fieldUsageCounts(fields) : {};
    res.json({
      fields: fields.map((f) => ({ ...f, usage: usage[f.id] ?? null })),
      options,
    });
  } catch (err) {
    logger.error({ err }, "Failed to list deal fields");
    res.status(500).json({ error: "Failed to load deal fields." });
  }
});

// Decode existing custom_fields keys into reviewable (pending) definitions.
router.post(
  "/deal-fields/discover",
  requireAdmin,
  async (_req, res): Promise<void> => {
    try {
      const user = currentUser(res);
      const result = await runDiscovery(user.id);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Field discovery failed");
      res.status(500).json({ error: "Discovery failed." });
    }
  },
);

interface OptionInput {
  value: string;
  label?: string;
  color?: string | null;
}

function readConfig(body: Record<string, unknown>): DealFieldConfig {
  const c = (body.config && typeof body.config === "object" ? body.config : {}) as DealFieldConfig;
  return normalizeFieldConfig(c);
}

// Create a user custom field (storage='custom'; server generates the key).
router.post("/deal-fields", requireAdmin, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const fieldType = String(body.fieldType ?? "");
  if (!label) {
    res.status(400).json({ error: "Label is required" });
    return;
  }
  if (!(DEAL_FIELD_TYPES as readonly string[]).includes(fieldType)) {
    res.status(400).json({ error: `Invalid field type: ${fieldType}` });
    return;
  }
  const slug =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) ||
    "field";
  const key = `${slug}_${randomBytes(3).toString("hex")}`;
  try {
    const created = await db.transaction(async (tx) => {
      const [field] = await tx
        .insert(dealFieldsTable)
        .values({
          key,
          label,
          fieldType,
          storage: "custom",
          sourceKey: key,
          editable: body.editable !== false,
          active: body.active !== false,
          system: false,
          config: readConfig(body),
          orderIndex: Number.isFinite(Number(body.orderIndex)) ? Number(body.orderIndex) : 0,
          createdBy: currentUser(res).id,
        })
        .returning();
      const opts = Array.isArray(body.options) ? (body.options as OptionInput[]) : [];
      if (opts.length && (fieldType === "enum" || fieldType === "set")) {
        await tx.insert(dealFieldOptionsTable).values(
          opts
            .filter((o) => o && typeof o.value === "string" && o.value.trim() !== "")
            .map((o, i) => ({
              fieldId: field!.id,
              value: o.value.trim(),
              label: (o.label ?? o.value).trim(),
              color: o.color ?? null,
              orderIndex: i,
            })),
        );
      }
      return field;
    });
    // Only touch indexes when the new field is actually filterable.
    if (created?.config?.filterable) await reconcileFieldIndexes();
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to create deal field");
    res.status(500).json({ error: "Failed to create the field." });
  }
});

// Update label/flags/order/options + activate. key, field_type, storage and
// source_key are immutable — ignored if sent.
router.patch("/deal-fields/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid field id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await db.transaction(async (tx) => {
      const [field] = await tx
        .select()
        .from(dealFieldsTable)
        .where(eq(dealFieldsTable.id, id));
      if (!field) return { status: 404 as const, error: "Field not found" };

      const updates: Record<string, unknown> = {};
      if (typeof body.label === "string") updates.label = body.label.trim();
      if (typeof body.editable === "boolean") updates.editable = body.editable;
      if (typeof body.active === "boolean") updates.active = body.active;
      if (Number.isFinite(Number(body.orderIndex)))
        updates.orderIndex = Number(body.orderIndex);
      if (body.config && typeof body.config === "object")
        updates.config = normalizeFieldConfig({
          ...field.config,
          ...(body.config as DealFieldConfig),
        });
      if (Object.keys(updates).length) {
        await tx.update(dealFieldsTable).set(updates).where(eq(dealFieldsTable.id, id));
      }

      // Reconcile enum/set options: upsert provided (active), soft-delete absent.
      if (Array.isArray(body.options)) {
        const provided = (body.options as OptionInput[]).filter(
          (o) => o && typeof o.value === "string" && o.value.trim() !== "",
        );
        const providedValues = new Set(provided.map((o) => o.value.trim()));
        const existing = await tx
          .select()
          .from(dealFieldOptionsTable)
          .where(eq(dealFieldOptionsTable.fieldId, id));
        const existingByValue = new Map(existing.map((o) => [o.value, o]));
        let i = 0;
        for (const o of provided) {
          const v = o.value.trim();
          const found = existingByValue.get(v);
          if (found) {
            await tx
              .update(dealFieldOptionsTable)
              .set({ label: (o.label ?? v).trim(), color: o.color ?? null, active: true, orderIndex: i })
              .where(eq(dealFieldOptionsTable.id, found.id));
          } else {
            await tx.insert(dealFieldOptionsTable).values({
              fieldId: id,
              value: v,
              label: (o.label ?? v).trim(),
              color: o.color ?? null,
              orderIndex: i,
            });
          }
          i++;
        }
        for (const o of existing) {
          if (!providedValues.has(o.value) && o.active) {
            await tx
              .update(dealFieldOptionsTable)
              .set({ active: false })
              .where(eq(dealFieldOptionsTable.id, o.id));
          }
        }
      }

      // Only the filterable flag or active state affect the expression indexes.
      const beforeFilterable = !!field.config?.filterable;
      const afterFilterable =
        updates.config !== undefined
          ? !!(updates.config as DealFieldConfig).filterable
          : beforeFilterable;
      const afterActive =
        typeof updates.active === "boolean" ? updates.active : field.active;
      const reconcileNeeded =
        beforeFilterable !== afterFilterable ||
        (field.active !== afterActive && (beforeFilterable || afterFilterable));
      return { status: 200 as const, reconcileNeeded };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (result.reconcileNeeded) await reconcileFieldIndexes();
    const [updated] = await db
      .select()
      .from(dealFieldsTable)
      .where(eq(dealFieldsTable.id, id));
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update deal field");
    res.status(500).json({ error: "Failed to update the field." });
  }
});

// Persist a new field order (ids in the desired order → order_index = position).
router.post("/deal-fields/reorder", requireAdmin, async (req, res): Promise<void> => {
  const ids = Array.isArray((req.body ?? {}).ids) ? (req.body.ids as unknown[]) : [];
  const clean = ids.map(Number).filter((n) => Number.isInteger(n));
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < clean.length; i++) {
        await tx
          .update(dealFieldsTable)
          .set({ orderIndex: i })
          .where(eq(dealFieldsTable.id, clean[i]!));
      }
    });
    res.json({ ok: true, count: clean.length });
  } catch (err) {
    logger.error({ err }, "Failed to reorder deal fields");
    res.status(500).json({ error: "Failed to reorder fields." });
  }
});

// Archive a field (soft delete). ?purge=true also strips its values from every
// deal (synchronous — there is no job queue).
router.delete("/deal-fields/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid field id" });
    return;
  }
  try {
    const [field] = await db
      .select()
      .from(dealFieldsTable)
      .where(eq(dealFieldsTable.id, id));
    if (!field) {
      res.status(404).json({ error: "Field not found" });
      return;
    }
    await db
      .update(dealFieldsTable)
      .set({ active: false })
      .where(eq(dealFieldsTable.id, id));
    if (req.query.purge === "true") await purgeFieldValues(field);
    // Archiving a filterable field should drop its index.
    if (field.config?.filterable) await reconcileFieldIndexes();
    res.json({ ok: true, purged: req.query.purge === "true" });
  } catch (err) {
    logger.error({ err }, "Failed to archive deal field");
    res.status(500).json({ error: "Failed to archive the field." });
  }
});

// Make the filterable expression indexes match the flags (manual trigger).
router.post(
  "/deal-fields/reconcile-indexes",
  requireAdmin,
  async (_req, res): Promise<void> => {
    try {
      res.json(await reconcileFieldIndexes());
    } catch (err) {
      logger.error({ err }, "Failed to reconcile field indexes");
      res.status(500).json({ error: "Reconcile failed." });
    }
  },
);

export default router;
