import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { and, asc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  dealsTable,
  personsTable,
  organizationsTable,
  pipelinesTable,
  stagesTable,
  usersTable,
  labelsTable,
  type DealField,
} from "@workspace/db";
import { runInWorkspace } from "../lib/workspace-settings";
import {
  presentedSecret,
  tenantIdForWebhookSecret,
} from "../lib/app-settings";
import {
  logDealCreated,
  logDealChanges,
  valuesEqual,
} from "../lib/change-events";
import {
  resolveAutoAssignment,
  auditAutoAssignedOwner,
} from "../lib/assignment";
import { runAutomations } from "../lib/automations";
import { loadFieldRegistry } from "../lib/deal-fields";
import { coerceSetValue } from "../lib/set-values";
import { fireWebhooks, type WebhookIntent } from "../lib/webhook-dispatch";
import { fireSlackMessages, type SlackIntent } from "../lib/slack";
import { loadDealById } from "../lib/queries";
import { logger } from "../lib/logger";
import { notify } from "../lib/notifications";
import { currencyForNewAmount } from "../lib/regional-context";

const router: IRouter = Router();

// Inbound lead webhook for n8n (and any other automation). Public — mounted
// BEFORE requireAuth — and authenticated by a per-workspace shared secret
// managed in the admin Settings page (stored in app_settings). The secret is
// also what says WHICH workspace the call is for: the request is bound to that
// tenant before any handler runs. Creates a deal in the target pipeline and
// optionally creates/links a person + organization.
router.use(
  "/webhooks",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const presented = presentedSecret(req);
    const tenantId = presented
      ? await tenantIdForWebhookSecret(presented)
      : null;
    if (tenantId == null) {
      res.status(401).json({ error: "Invalid or missing webhook secret" });
      return;
    }
    await runInWorkspace(tenantId, () => next());
  },
);

const idOrName = z.union([z.number().int().positive(), z.string().trim().min(1)]);

// Zapier/n8n send JSON numbers as strings; coerce, and treat "" / null as
// "not provided" so an empty mapping doesn't 400 the whole request.
const numeric = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().optional(),
);

const LeadWebhookBody = z.object({
  pipeline: idOrName,
  stage: idOrName.optional(),
  title: z.string().trim().min(1).optional(),
  value: numeric.optional(),
  currency: z.string().trim().min(1).optional(),
  ownerEmail: z.string().trim().email().optional(),
  externalId: z.string().trim().min(1).optional(),
  person: z
    .object({
      name: z.string().trim().min(1),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(1).optional(),
    })
    .optional(),
  organization: z.object({ name: z.string().trim().min(1) }).optional(),
  // Free-form deal labels (e.g. ["Hot", "Inbound"]). Stored as-is on the
  // native deals.labels text[] — no predefined set required. Accepts an array
  // or a single/comma-separated string (Zapier can't easily emit JSON arrays).
  labels: z
    .preprocess(
      (v) =>
        typeof v === "string"
          ? v.split(",").map((s) => s.trim()).filter(Boolean)
          : v,
      z.array(z.string().trim().min(1)),
    )
    .optional(),
  // Optional deal detail fields.
  expectedCloseDate: z.string().trim().min(1).optional(),
  comments: z.string().trim().min(1).optional(),
  // UTM / ad attribution (native deals columns). Ad group (utm_content) has no
  // column — pass it via `customFields` as "UTM Ad Group" instead.
  utmSource: z.string().trim().min(1).optional(),
  utmMedium: z.string().trim().min(1).optional(),
  utmCampaign: z.string().trim().min(1).optional(),
  utmKeyword: z.string().trim().min(1).optional(),
  adName: z.string().trim().min(1).optional(),
  gclid: z.string().trim().min(1).optional(),
  fbclid: z.string().trim().min(1).optional(),
  // iOS Google Ads click ids (gclid's replacements under ATT), stored for
  // ad-conversion attribution.
  wbraid: z.string().trim().min(1).optional(),
  gbraid: z.string().trim().min(1).optional(),
  // Generic map of deal-field label/key -> value for every other field
  // (ad group and any user-created custom field).
  // Resolved against the deal-field registry and stored in custom_fields jsonb;
  // unknown keys are stored as-is so a later Discover pass can formalise them.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

// Inbound "update an existing deal" webhook body. Targets the deal by its
// internal id (create returns deal.id / deal.externalId in its response).
// Every field except `dealId` is optional — only the fields present are
// changed (partial patch). Mirrors LeadWebhookBody's field set and coercion
// so the two webhooks accept values the same way (no status/won-lost, no
// pipeline/person/organization changes — those are out of scope).
const UpdateDealWebhookBody = z.object({
  dealId: z.coerce.number().int().positive(),
  stage: idOrName.optional(),
  value: numeric.optional(),
  currency: z.string().trim().min(1).optional(),
  ownerEmail: z.string().trim().email().optional(),
  labels: z
    .preprocess(
      (v) =>
        typeof v === "string"
          ? v.split(",").map((s) => s.trim()).filter(Boolean)
          : v,
      z.array(z.string().trim().min(1)),
    )
    .optional(),
  comments: z.string().trim().min(1).optional(),
  expectedCloseDate: z.string().trim().min(1).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// An empty / whitespace-only string means "not provided": Zapier/n8n emit "" for
// every mapped-but-empty field, and the schema's optional strings reject "" (they
// require the key to be absent, not blank). Treat blanks as missing.
function isBlank(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "";
}

// Recursively drop blank-string members so a partial payload never 400s on an
// optional field that was mapped but empty.
function pruneBlanks(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (isBlank(v)) delete obj[k];
    else if (isPlainObject(v)) pruneBlanks(v);
  }
}

// Zapier/n8n emit nested fields as flat dotted keys ("person.name",
// "organization.name", "customFields.Size") and their "Unflatten" toggle does
// not reliably split on dots — so those keys arrive literal and get dropped by
// the schema. Fold dotted keys back into nested objects here, making the caller's
// mapping work regardless of that toggle. Non-dotted keys pass through untouched;
// an already-nested object (Unflatten did work) is preserved. Blank strings are
// dropped, and a person/organization left without a name is removed (it can't be
// created without one) so it doesn't fail the required-name check.
function unflattenBody(body: unknown): unknown {
  if (!isPlainObject(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (isBlank(value)) continue;
    if (!key.includes(".")) {
      if (isPlainObject(out[key]) && isPlainObject(value)) {
        out[key] = { ...(out[key] as object), ...value };
      } else {
        out[key] = value;
      }
      continue;
    }
    const path = key.split(".");
    let node = out;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i]!;
      if (!isPlainObject(node[seg])) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[path[path.length - 1]!] = value;
  }
  pruneBlanks(out);
  for (const rec of ["person", "organization"] as const) {
    const v = out[rec];
    if (isPlainObject(v) && isBlank(v.name ?? "")) delete out[rec];
  }
  return out;
}

router.post("/webhooks/leads", async (req, res): Promise<void> => {
  // --- Validate body --------------------------------------------------------
  const parsed = LeadWebhookBody.safeParse(unflattenBody(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  if (!b.title && !b.person && !b.organization) {
    res.status(400).json({
      error: "Provide at least one of: title, person, or organization",
    });
    return;
  }

  // --- Idempotency ----------------------------------------------------------
  if (b.externalId) {
    const [existing] = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(eq(dealsTable.externalId, b.externalId));
    if (existing) {
      const deal = await loadDealById(existing.id);
      res.status(200).json({ deal, idempotent: true });
      return;
    }
  }

  // --- Resolve pipeline -----------------------------------------------------
  const [pipeline] =
    typeof b.pipeline === "number"
      ? await db
          .select()
          .from(pipelinesTable)
          .where(eq(pipelinesTable.id, b.pipeline))
      : await db
          .select()
          .from(pipelinesTable)
          .where(ilike(pipelinesTable.name, b.pipeline));
  if (!pipeline) {
    res.status(404).json({ error: `Pipeline not found: ${b.pipeline}` });
    return;
  }

  // --- Resolve stage (default: first stage of the pipeline) -----------------
  let stageId: number;
  if (b.stage !== undefined) {
    const [stage] =
      typeof b.stage === "number"
        ? await db
            .select({ id: stagesTable.id })
            .from(stagesTable)
            .where(
              and(
                eq(stagesTable.id, b.stage),
                eq(stagesTable.pipelineId, pipeline.id),
              ),
            )
        : await db
            .select({ id: stagesTable.id })
            .from(stagesTable)
            .where(
              and(
                ilike(stagesTable.name, b.stage),
                eq(stagesTable.pipelineId, pipeline.id),
              ),
            );
    if (!stage) {
      res
        .status(400)
        .json({ error: `Stage not found in pipeline: ${b.stage}` });
      return;
    }
    stageId = stage.id;
  } else {
    const [first] = await db
      .select({ id: stagesTable.id })
      .from(stagesTable)
      .where(eq(stagesTable.pipelineId, pipeline.id))
      .orderBy(asc(stagesTable.orderIndex), asc(stagesTable.id))
      .limit(1);
    if (!first) {
      res
        .status(400)
        .json({ error: "Pipeline has no stages; specify a stage" });
      return;
    }
    stageId = first.id;
  }

  // --- Resolve owner (payload email -> default env -> first active admin) ---
  const owner = await resolveOwner(b.ownerEmail);
  if (!owner) {
    res.status(500).json({ error: "No owner could be resolved for the deal" });
    return;
  }

  const title =
    b.title ??
    (b.organization
      ? `New lead - ${b.organization.name}`
      : `New lead - ${b.person!.name}`);

  // --- Resolve labels (reuse existing, create only when genuinely new) ------
  // Incoming labels are matched case-insensitively to labels already in use and
  // canonicalised to their existing spelling — so "Hot"/"hot" never become two
  // labels. A label that matches nothing is kept as-is (i.e. created).
  let appliedLabels: string[] | null = null;
  if (b.labels?.length) {
    const known = await getKnownLabels();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of b.labels) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(known.get(key) ?? trimmed);
    }
    appliedLabels = out.length ? out : null;
  }

  // --- Resolve the free-form custom-fields map into a jsonb patch -----------
  const cfPatch = b.customFields
    ? await buildCustomFieldsPatch(b.customFields)
    : {};

  // --- Create org + person + deal atomically --------------------------------
  try {
    const webhooks: WebhookIntent[] = [];
    const slackMessages: SlackIntent[] = [];
    let notifyAssignedTo: number | null = null;
    const created = await db.transaction(async (tx) => {
      let organizationId: number | null = null;
      if (b.organization) {
        const [existingOrg] = await tx
          .select({ id: organizationsTable.id })
          .from(organizationsTable)
          .where(ilike(organizationsTable.name, b.organization.name))
          .limit(1);
        if (existingOrg) {
          organizationId = existingOrg.id;
        } else {
          const [org] = await tx
            .insert(organizationsTable)
            .values({ name: b.organization.name, ownerId: owner.id })
            .returning({ id: organizationsTable.id });
          organizationId = org.id;
        }
      }

      let personId: number | null = null;
      if (b.person) {
        // De-dupe by email when we have one, otherwise always create.
        let existingPerson: { id: number } | undefined;
        if (b.person.email) {
          [existingPerson] = await tx
            .select({ id: personsTable.id })
            .from(personsTable)
            .where(ilike(personsTable.email, b.person.email))
            .limit(1);
        }
        if (existingPerson) {
          personId = existingPerson.id;
        } else {
          const [person] = await tx
            .insert(personsTable)
            .values({
              name: b.person.name,
              email: b.person.email ?? null,
              phone: b.person.phone ?? null,
              organizationId,
              ownerId: owner.id,
            })
            .returning({ id: personsTable.id });
          personId = person.id;
        }
      }

      const now = new Date();
      // Inbound leads are the app's "deal added" surface: let a matching rule
      // pick the owner, preferring it over the webhook-resolved default owner.
      const autoOwner = await resolveAutoAssignment(tx, "deal_added", {
        title,
        organizationId,
        value: b.value ?? 0,
        pipelineId: pipeline.id,
        stageId,
        ownerId: owner.id,
        createdDate: now,
        wonTime: null,
        status: "open",
        utmKeyword: b.utmKeyword ?? null,
        lostReason: null,
        customFields: cfPatch,
      });
      const dealOwnerId = autoOwner ?? owner.id;
      notifyAssignedTo = autoOwner;
      const [deal] = await tx
        .insert(dealsTable)
        .values({
          title,
          value: b.value ?? 0,
          currency: b.currency ?? currencyForNewAmount(owner.defaultCurrency),
          pipelineId: pipeline.id,
          stageId,
          ownerId: dealOwnerId,
          creatorUserId: owner.id,
          personId,
          organizationId,
          labels: appliedLabels,
          externalId: b.externalId ?? null,
          expectedCloseDate: b.expectedCloseDate ?? null,
          comments: b.comments ?? null,
          utmSource: b.utmSource ?? null,
          utmMedium: b.utmMedium ?? null,
          utmCampaign: b.utmCampaign ?? null,
          utmKeyword: b.utmKeyword ?? null,
          adName: b.adName ?? null,
          gclid: b.gclid ?? null,
          fbclid: b.fbclid ?? null,
          wbraid: b.wbraid ?? null,
          gbraid: b.gbraid ?? null,
          customFields: Object.keys(cfPatch).length ? cfPatch : null,
          stageChangeTime: now,
        })
        .returning();
      await logDealCreated(tx, deal, {
        changedBy: owner.id,
        source: "automation",
      });
      // When a rule reassigned away from the webhook default, record the
      // owner_id change (no-op when the rule resolved the same owner).
      if (autoOwner != null) {
        await auditAutoAssignedOwner(
          tx,
          { ...deal, ownerId: owner.id },
          autoOwner,
          now,
        );
      }
      // Inbound leads are a "deal added" surface too — same automations as the
      // app's create (the inserted row already carries the resolved owner).
      // actorId null: an inbound lead has no CRM user behind it, so nobody is
      // excluded from notifications about it.
      await runAutomations(tx, "deal_added", deal, {
        depth: 0,
        actorId: null,
        webhooks,
        slackMessages,
      });
      return deal;
    });

    await fireWebhooks(webhooks);
    void fireSlackMessages(slackMessages);

    if (notifyAssignedTo != null) {
      void notify({
        type: "deal_assigned",
        dealId: created.id,
        dealTitle: created.title,
        userId: notifyAssignedTo,
      });
    }

    const deal = await loadDealById(created.id);
    res.status(201).json({ deal, idempotent: false });
  } catch (err) {
    logger.error({ err }, "lead webhook failed to create deal");
    res.status(500).json({ error: "Failed to create deal" });
  }
});

router.post("/webhooks/deals/update", async (req, res): Promise<void> => {
  // --- Validate body --------------------------------------------------------
  const normalized = unflattenBody(req.body);
  if (normalized && typeof normalized === "object") {
    pruneBlanks(normalized as Record<string, unknown>);
  }
  const parsed = UpdateDealWebhookBody.safeParse(normalized);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  // --- Load the target deal -------------------------------------------------
  const [existing] = await db
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.id, b.dealId));
  if (!existing) {
    res.status(404).json({ error: `Deal not found: ${b.dealId}` });
    return;
  }
  if (existing.archived) {
    res.status(409).json({ error: "Deal is archived and cannot be updated" });
    return;
  }

  // --- Resolve stage (must belong to the deal's pipeline) -------------------
  let stageId: number | undefined;
  if (b.stage !== undefined) {
    const [stage] =
      typeof b.stage === "number"
        ? await db
            .select({ id: stagesTable.id })
            .from(stagesTable)
            .where(
              and(
                eq(stagesTable.id, b.stage),
                eq(stagesTable.pipelineId, existing.pipelineId),
              ),
            )
        : await db
            .select({ id: stagesTable.id })
            .from(stagesTable)
            .where(
              and(
                ilike(stagesTable.name, b.stage),
                eq(stagesTable.pipelineId, existing.pipelineId),
              ),
            );
    if (!stage) {
      res.status(400).json({
        error: `Stage not found in the deal's pipeline: ${b.stage}`,
      });
      return;
    }
    stageId = stage.id;
  }

  // --- Resolve owner (only if ownerEmail was provided) ----------------------
  let ownerId: number | undefined;
  if (b.ownerEmail !== undefined) {
    const owner = await resolveOwner(b.ownerEmail);
    if (!owner) {
      res.status(400).json({ error: `Owner not found: ${b.ownerEmail}` });
      return;
    }
    ownerId = owner.id;
  }

  // --- Resolve labels (canonicalise against existing, same as create) -------
  let appliedLabels: string[] | undefined;
  if (b.labels !== undefined) {
    const known = await getKnownLabels();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of b.labels) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(known.get(key) ?? trimmed);
    }
    appliedLabels = out;
  }

  // --- Resolve custom fields; merge onto existing jsonb ---------------------
  let mergedCustomFields: Record<string, unknown> | undefined;
  if (b.customFields !== undefined) {
    const cfPatch = await buildCustomFieldsPatch(b.customFields);
    mergedCustomFields = {
      ...((existing.customFields as Record<string, unknown> | null) ?? {}),
      ...cfPatch,
    };
  }

  // --- Build the partial patch (only present fields) ------------------------
  // `patch` is the client-supplied change set used for BOTH the DB write and
  // the audit/automation diff (so a no-op write never fires an automation and
  // never logs a change — mirrors PATCH /deals/:id).
  const now = new Date();
  const patch: Record<string, unknown> = {};
  if (stageId !== undefined) patch.stageId = stageId;
  if (b.value !== undefined) patch.value = b.value;
  if (b.currency !== undefined) patch.currency = b.currency;
  if (ownerId !== undefined) patch.ownerId = ownerId;
  if (appliedLabels !== undefined) patch.labels = appliedLabels;
  if (b.comments !== undefined) patch.comments = b.comments;
  if (b.expectedCloseDate !== undefined)
    patch.expectedCloseDate = b.expectedCloseDate;
  if (mergedCustomFields !== undefined) patch.customFields = mergedCustomFields;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Provide at least one field to update" });
    return;
  }

  // Did anything actually change vs the current row? Same diff test the audit
  // log uses, so trigger and audit agree on what "changed" means.
  const dealChanged = Object.keys(patch).some(
    (k) => !valuesEqual((existing as Record<string, unknown>)[k], patch[k]),
  );
  if (!dealChanged) {
    const deal = await loadDealById(existing.id);
    res.status(200).json({ deal, changed: false });
    return;
  }

  // A stage move resets the aging/rotting clock, like PATCH /deals/:id.
  // Typed like the deals.ts PATCH path (`Partial<...$inferInsert>`) so the
  // `.set()` call typechecks; `patch` (Record<string,unknown>) stays separate
  // and is what feeds the audit/diff, exactly as deals.ts does with auditPatch.
  const updates: Partial<typeof dealsTable.$inferInsert> = { ...patch };
  if (stageId !== undefined && stageId !== existing.stageId) {
    updates.stageChangeTime = now;
  }

  const webhooks: WebhookIntent[] = [];
  const slackMessages: SlackIntent[] = [];
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(dealsTable)
        .set(updates)
        .where(eq(dealsTable.id, existing.id));
      // No session user on a webhook: attribute to the resolved owner when one
      // was provided, else the deal's current owner. Logged with source
      // "automation" (matching the lead webhook's logDealCreated).
      const changedBy = ownerId ?? existing.ownerId;
      await logDealChanges(tx, [{ before: existing, patch }], {
        changedBy,
        changedAt: now,
        source: "automation",
      });
      const [updated] = await tx
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, existing.id));
      if (updated) {
        // `existing` is the before, so a conditioned automation fires only when
        // this update makes the deal enter its conditions (dealAutomationMatches).
        await runAutomations(
          tx,
          "deal_updated",
          updated,
          { depth: 0, actorId: null, webhooks, slackMessages },
          existing,
        );
      }
    });

    await fireWebhooks(webhooks);
    // Fire any Slack messages the deal_updated automations queued (same
    // post-commit, best-effort pattern as the PATCH /deals path).
    void fireSlackMessages(slackMessages);
    const deal = await loadDealById(existing.id);
    res.status(200).json({ deal, changed: true });
  } catch (err) {
    logger.error({ err, dealId: b.dealId }, "deal update webhook failed");
    res.status(500).json({ error: "Failed to update deal" });
  }
});

// Known deal labels, keyed by lowercase → canonical spelling, so incoming
// webhook labels reuse the existing label instead of creating a case-variant
// duplicate. Registry spellings (admin-curated) win over in-use spellings.
async function getKnownLabels(): Promise<Map<string, string>> {
  const [rows, registered] = await Promise.all([
    db
      .select({
        label: sql<string | null>`distinct unnest(${dealsTable.labels})`,
      })
      .from(dealsTable)
      .where(isNotNull(dealsTable.labels)),
    db
      .select({ name: labelsTable.name })
      .from(labelsTable)
      .where(eq(labelsTable.entity, "deal")),
  ]);
  const map = new Map<string, string>();
  for (const r of rows) {
    const l = r.label?.trim();
    if (l) map.set(l.toLowerCase(), l);
  }
  for (const r of registered) map.set(r.name.toLowerCase(), r.name);
  return map;
}

// Light type coercion for a custom-field value coming off a webhook (values
// usually arrive as strings). Mirrors the registry field type so numbers/bools
// land as JSON scalars rather than strings.
function coerceCustomValue(fieldType: string | undefined, v: unknown): unknown {
  if (fieldType === "double" || fieldType === "monetary") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  if (fieldType === "boolean") {
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  }
  // A `set` stores a JSON ARRAY and its members must be canonical option
  // values; an inbound scalar ("RTL") would otherwise land as a bare string,
  // which the UI reads as empty and the editor cannot repair. See
  // coerceSetValue for why unknown members are kept rather than dropped.
  if (fieldType === "set") return coerceSetValue(v);
  if (Array.isArray(v)) return v.map(String);
  if (v != null && typeof v === "object") return v;
  return String(v);
}

// Resolve an inbound `customFields` map (keyed by human label / field key /
// source key, case-insensitive) into a deals.custom_fields jsonb patch. Known
// data/custom registry fields write at their source key; column-backed concepts
// are skipped (they have explicit body fields); unknown keys are stored as-is so
// a later Discover pass can formalise them.
async function buildCustomFieldsPatch(
  map: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const entries = Object.entries(map).filter(
    ([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return {};
  const { fields } = await loadFieldRegistry(true);
  const lookup = new Map<string, DealField>();
  for (const f of fields) {
    for (const alias of [f.key, f.sourceKey, f.label]) {
      if (alias) lookup.set(alias.trim().toLowerCase(), f);
    }
  }
  const patch: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of entries) {
    const field = lookup.get(rawKey.trim().toLowerCase());
    if (field && field.storage === "column") continue; // covered by body fields
    const storeKey = field ? field.sourceKey ?? field.key : rawKey;
    patch[storeKey] = coerceCustomValue(field?.fieldType, rawVal);
  }
  return patch;
}

interface OwnerRow {
  id: number;
  defaultCurrency: string;
}

// Payload ownerEmail -> WEBHOOK_DEFAULT_OWNER_EMAIL env -> first ACTIVE admin.
// Every step only accepts an active user: an email that names a deactivated
// user falls through to the next option rather than hand a new lead to
// somebody who no longer signs in.
async function resolveOwner(email?: string): Promise<OwnerRow | null> {
  const byEmail = async (e: string): Promise<OwnerRow | undefined> => {
    const [u] = await db
      .select({ id: usersTable.id, defaultCurrency: usersTable.defaultCurrency })
      .from(usersTable)
      .where(and(ilike(usersTable.email, e), eq(usersTable.activeFlag, true)))
      .limit(1);
    return u;
  };
  if (email) {
    const u = await byEmail(email);
    if (u) return u;
  }
  const envEmail = process.env.WEBHOOK_DEFAULT_OWNER_EMAIL;
  if (envEmail) {
    const u = await byEmail(envEmail);
    if (u) return u;
  }
  const [admin] = await db
    .select({ id: usersTable.id, defaultCurrency: usersTable.defaultCurrency })
    .from(usersTable)
    .where(and(eq(usersTable.isAdmin, true), eq(usersTable.activeFlag, true)))
    .orderBy(asc(usersTable.id))
    .limit(1);
  return admin ?? null;
}

export default router;
