import { Router, type IRouter } from "express";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  dealsTable,
  stagesTable,
  pipelinesTable,
  organizationsTable,
  personsTable,
  changeEventsTable,
  usersTable,
  teamsTable,
  type Deal,
} from "@workspace/db";
import {
  ListDealsQueryParams,
  ListDealsResponse,
  ListDealLabelsResponse,
  ListDealOwnersResponse,
  CountDealsQueryParams,
  CountDealsResponse,
  ForecastDealsQueryParams,
  ForecastDealsResponse,
  GetDealStageSummaryQueryParams,
  GetDealStageSummaryResponse,
  BulkUpdateDealsBody,
  BulkUpdateDealsResponse,
  CreateDealBody,
  GetDealParams,
  GetDealResponse,
  UpdateDealParams,
  UpdateDealBody,
  UpdateDealResponse,
  DeleteDealParams,
  GetDealHistoryParams,
  GetDealHistoryResponse,
  MergeDealParams,
  MergeDealBody,
  MergeDealResponse,
} from "@workspace/api-zod";
import {
  dealQuery,
  dealCountQuery,
  dealSummaryTotals,
  loadDealById,
  compileDealFilters,
  buildDealOrderBy,
  DealFilterError,
  filterOverrides,
  isRottingExpr,
  escapeLike,
  personSearchConditions,
  stripFalsyBooleanParams,
} from "../lib/queries";
import { currentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  logDealChanges,
  logDealCreated,
  loadEntityHistory,
  valuesEqual,
  type Tx,
} from "../lib/change-events";
import {
  resolveAutoAssignment,
  auditAutoAssignedOwner,
} from "../lib/assignment";
import { runAutomations } from "../lib/automations";
import { fireWebhooks, type WebhookIntent } from "../lib/webhook-dispatch";
import { fireSlackMessages, type SlackIntent } from "../lib/slack";
import {
  computeMissingRequiredFields,
  computeMissingRequiredFieldsBulk,
  computeMissingWonFields,
  loadFieldRegistry,
  resolveDealFields,
} from "../lib/deal-fields";
import {
  mergeDeal,
  previewMerge,
  DealMergeError,
} from "../lib/deal-merge";
import { z } from "zod";
import { notify } from "../lib/notifications";
import {
  OWNER_CHANGE_ADMIN_ONLY,
  ownerChangeAllowed,
} from "../lib/deal-reassign";

const router: IRouter = Router();

// `archived`/`rotting` document "omitted/false = excluded", so their falsy
// string forms are stripped before zod coercion inverts them — see
// stripFalsyBooleanParams in lib/queries.ts for the full story.
const DEAL_BOOLEAN_QUERY_KEYS = ["archived", "rotting"] as const;

type DealStatus = "open" | "won" | "lost" | "deleted" | "all";
type DealView = "pipeline" | "list" | "forecast";

interface DealWhereParams {
  view?: DealView;
  status?: DealStatus;
  /** DSL filters reference status/lostReason — suppress the open-only default
   *  so those conditions aren't silently contradicted. */
  filtersOverrideStatus?: boolean;
  /** DSL filters reference archived — suppress BOTH the default archived=false
   *  lens and the open-only status default, so an "Archived is …" condition
   *  behaves like the archive view (all statuses of archived deals). */
  filtersOverrideArchived?: boolean;
  pipelineId?: number;
  stageId?: number;
  ownerId?: number;
  personId?: number;
  organizationId?: number;
  q?: string;
  archived?: boolean;
  /** true = only rotting deals; absent/false = no rotting filter. */
  rotting?: boolean;
}

// Shared WHERE assembly so list and count stay perfectly in sync.
// Exported for tests: the status/archived interaction is the whole policy that
// decides which deals a user can see, and it is pure enough to assert directly.
export function buildDealWhere(
  p: DealWhereParams,
  filterSql?: SQL,
): SQL | undefined {
  const conditions: SQL[] = [];
  // Archived deals are invisible to every working view; archived=true flips
  // the lens to archived-only, and an explicit DSL condition on `archived`
  // takes the lens over entirely. (The forecast report deliberately bypasses
  // this builder, so archived deals keep counting toward reporting.)
  if (!p.filtersOverrideArchived)
    conditions.push(eq(dealsTable.archived, p.archived === true));
  // Status policy: an explicit status filter wins; `status=all` is the explicit
  // "every status" lens, so it adds no condition at all; otherwise the default
  // is *open only* — won/lost stay out of every working view unless the user
  // asks for them. The `archived=true` toggle (p.archived) and a DSL condition
  // that references `archived` (filtersOverrideArchived) both drop the
  // open-only default, so "show me archived deals" surfaces won/lost/deleted
  // archived deals — otherwise the filter would look broken (near-empty),
  // since deals are usually archived only after they close.
  //
  // Note `all` is a status lens only: it never widens the archived lens above,
  // so "All" still means all *non-archived* statuses unless archived=true.
  if (p.status === "all") {
    /* no status condition */
  } else if (p.status) conditions.push(eq(dealsTable.status, p.status));
  else if (
    p.archived !== true &&
    !p.filtersOverrideStatus &&
    !p.filtersOverrideArchived
  )
    conditions.push(eq(dealsTable.status, "open"));

  if (p.pipelineId) conditions.push(eq(dealsTable.pipelineId, p.pipelineId));
  if (p.stageId) conditions.push(eq(dealsTable.stageId, p.stageId));
  if (p.ownerId) conditions.push(eq(dealsTable.ownerId, p.ownerId));
  if (p.personId) conditions.push(eq(dealsTable.personId, p.personId));
  if (p.organizationId)
    conditions.push(eq(dealsTable.organizationId, p.organizationId));
  const q = p.q?.trim();
  if (q) {
    const term = `%${escapeLike(q)}%`;
    const cond = or(
      ilike(dealsTable.title, term),
      ilike(organizationsTable.name, term),
      ...personSearchConditions(q),
    );
    if (cond) conditions.push(cond);
  }
  if (p.rotting === true) conditions.push(isRottingExpr);
  if (filterSql) conditions.push(filterSql);

  return conditions.length ? and(...conditions) : undefined;
}

const STAGE_NOT_IN_PIPELINE_ERROR =
  "Stage does not belong to the specified pipeline";

/** A stage with the archive state of both it and its pipeline. */
async function loadTargetStage(dbc: typeof db | Tx, stageId: number) {
  const [stage] = await dbc
    .select({
      pipelineId: stagesTable.pipelineId,
      name: stagesTable.name,
      stageArchived: stagesTable.archived,
      pipelineArchived: pipelinesTable.archived,
    })
    .from(stagesTable)
    .innerJoin(pipelinesTable, eq(pipelinesTable.id, stagesTable.pipelineId))
    .where(eq(stagesTable.id, stageId));
  return stage ?? null;
}

// A deal can only be placed in a live stage of a live pipeline. Only live
// stages become board columns, so a deal put in an archived one vanishes from
// the board while still counting toward its totals.
function archivedTargetError(stage: {
  stageArchived: boolean;
  pipelineArchived: boolean;
}): string | null {
  if (stage.pipelineArchived) {
    return "That pipeline is archived, so deals can't be placed in it.";
  }
  if (stage.stageArchived) {
    return "That stage is archived, so deals can't be placed in it.";
  }
  return null;
}

router.get("/deals", async (req, res): Promise<void> => {
  const parsed = ListDealsQueryParams.safeParse(
    stripFalsyBooleanParams(req.query, DEAL_BOOLEAN_QUERY_KEYS),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const p = parsed.data;

  let filterSql: SQL | undefined;
  try {
    filterSql = compileDealFilters(p.filters);
  } catch (err) {
    res.status(400).json({
      error: err instanceof DealFilterError ? err.message : "Invalid filter",
    });
    return;
  }

  const overrides = filterOverrides(p.filters);
  const where = buildDealWhere(
    {
      ...p,
      filtersOverrideStatus: overrides.status,
      filtersOverrideArchived: overrides.archived,
    },
    filterSql,
  );
  const page = p.page ?? 1;
  const limit = p.limit ?? 50;
  const orderBy = buildDealOrderBy(p.sort);

  const items = await dealQuery()
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = await dealCountQuery().where(where);

  // The raw custom_fields jsonb is never sent as-is. When the client requests
  // custom-field columns (?columns=key1,key2), resolve just those into a
  // per-row `customFields` map keyed by field key; otherwise drop it entirely.
  const projected = await projectCustomFields(items, p.columns);

  res.json(
    ListDealsResponse.parse({
      items: projected,
      page,
      limit,
      total: count,
    }),
  );
});

// Resolve the requested custom-field columns for a page of deals. Only fields
// stored in the custom_fields jsonb are projected (native `column` fields
// already ride along on the row); unknown keys are ignored. Returns rows with
// `customFields` set to the resolved subset (or null when nothing is
// requested), so the raw jsonb is never leaked to the client.
async function projectCustomFields<T extends { customFields?: unknown }>(
  items: T[],
  columnsParam: string | undefined,
): Promise<Array<T & { customFields: Record<string, unknown> | null }>> {
  const requested = new Set(
    (columnsParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const blank = () => items.map((it) => ({ ...it, customFields: null }));
  if (requested.size === 0) return blank();

  const registry = await loadFieldRegistry(true);
  const wanted = registry.fields.filter(
    (f) => requested.has(f.key) && f.storage !== "column",
  );
  if (wanted.length === 0) return blank();

  const subset = { fields: wanted, optionsByField: registry.optionsByField };
  return items.map((it) => {
    const cf: Record<string, unknown> = {};
    // `it` is a dealQuery row (deal columns + joined display fields) — a
    // superset of Deal, which is all resolveDealFields reads from.
    for (const r of resolveDealFields(it as unknown as Deal, subset))
      cf[r.key] = r.value;
    return { ...it, customFields: cf };
  });
}

router.post("/deals", async (req, res): Promise<void> => {
  const parsed = CreateDealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const user = currentUser(res);
  const now = new Date();

  const targetStage = await loadTargetStage(db, d.stageId);
  if (!targetStage || targetStage.pipelineId !== d.pipelineId) {
    res.status(400).json({ error: STAGE_NOT_IN_PIPELINE_ERROR });
    return;
  }
  const archivedError = archivedTargetError(targetStage);
  if (archivedError) {
    res.status(400).json({ error: archivedError });
    return;
  }

  const webhooks: WebhookIntent[] = [];
  const slackMessages: SlackIntent[] = [];
  // Set inside the transaction when a rule picks the owner; the notification
  // fires only after the transaction commits (a rolled-back deal must never
  // notify anyone).
  let notifyAssignedTo: number | null = null;
  const created = await db.transaction(async (tx) => {
    // Auto-assignment: when the client didn't pick an owner, let a matching
    // "deal added" rule choose one (falls back to the creator when no rule
    // matches). An explicit owner always wins — respect the client's intent.
    let ownerId = d.ownerId ?? user.id;
    let autoAssignedOwner: number | null = null;
    if (d.ownerId == null) {
      autoAssignedOwner = await resolveAutoAssignment(tx, "deal_added", {
        title: d.title,
        organizationId: d.organizationId ?? null,
        value: d.value ?? 0,
        pipelineId: d.pipelineId,
        stageId: d.stageId,
        ownerId,
        createdDate: now,
        wonTime: null,
        status: "open",
        utmKeyword: null,
        lostReason: null,
        customFields: null,
      });
      if (autoAssignedOwner != null) ownerId = autoAssignedOwner;
    }

    const [row] = await tx
      .insert(dealsTable)
      .values({
        title: d.title,
        value: d.value ?? 0,
        currency: d.currency ?? user.defaultCurrency ?? "USD",
        pipelineId: d.pipelineId,
        stageId: d.stageId,
        ownerId,
        creatorUserId: user.id,
        personId: d.personId ?? null,
        organizationId: d.organizationId ?? null,
        expectedCloseDate: d.expectedCloseDate ?? null,
        stageChangeTime: now,
      })
      .returning();
    await logDealCreated(tx, row, {
      changedBy: user.id,
      source: d.source,
    });
    // Audit the auto-assignment as its own owner_id event, separate from the
    // "created" marker (before-owner is null — the deal had none yet).
    if (autoAssignedOwner != null) {
      await auditAutoAssignedOwner(
        tx,
        { ...row, ownerId: null },
        autoAssignedOwner,
        now,
      );
    }
    // Deal-created automations (e.g. auto-schedule a call) — after assignment
    // so an "assign to deal owner" action resolves to the final owner.
    await runAutomations(tx, "deal_added", row, {
      depth: 0,
      actorId: user.id,
      webhooks,
      slackMessages,
    });
    notifyAssignedTo = autoAssignedOwner;
    return row;
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
  res.status(201).json(GetDealResponse.parse(deal));
});

// Specific /deals/* routes must be registered before /deals/:id so they are not
// captured by the :id param matcher.
router.get("/deals/count", async (req, res): Promise<void> => {
  const parsed = CountDealsQueryParams.safeParse(
    stripFalsyBooleanParams(req.query, DEAL_BOOLEAN_QUERY_KEYS),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const p = parsed.data;

  let filterSql: SQL | undefined;
  try {
    filterSql = compileDealFilters(p.filters);
  } catch (err) {
    res.status(400).json({
      error: err instanceof DealFilterError ? err.message : "Invalid filter",
    });
    return;
  }

  const overrides = filterOverrides(p.filters);
  const where = buildDealWhere(
    {
      ...p,
      filtersOverrideStatus: overrides.status,
      filtersOverrideArchived: overrides.archived,
    },
    filterSql,
  );
  const [{ count }] = await dealCountQuery().where(where);
  res.json(CountDealsResponse.parse({ count }));
});

// Value totals for the header info popover — same filter surface as /count,
// hand-written outside the OpenAPI spec (like the /search endpoints).
router.get("/deals/summary", async (req, res): Promise<void> => {
  const parsed = CountDealsQueryParams.safeParse(
    stripFalsyBooleanParams(req.query, DEAL_BOOLEAN_QUERY_KEYS),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const p = parsed.data;

  let filterSql: SQL | undefined;
  try {
    filterSql = compileDealFilters(p.filters);
  } catch (err) {
    res.status(400).json({
      error: err instanceof DealFilterError ? err.message : "Invalid filter",
    });
    return;
  }

  const overrides = filterOverrides(p.filters);
  const totals = await dealSummaryTotals(
    buildDealWhere(
      {
        ...p,
        filtersOverrideStatus: overrides.status,
        filtersOverrideArchived: overrides.archived,
      },
      filterSql,
    ),
  );
  res.json({
    count: totals.reduce((sum, t) => sum + t.count, 0),
    totals,
  });
});

router.get("/deals/forecast", async (req, res): Promise<void> => {
  const parsed = ForecastDealsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const p = parsed.data;

  let filterSql: SQL | undefined;
  try {
    filterSql = compileDealFilters(p.filters);
  } catch (err) {
    res.status(400).json({
      error: err instanceof DealFilterError ? err.message : "Invalid filter",
    });
    return;
  }

  const conditions: SQL[] = [];
  conditions.push(eq(dealsTable.status, p.status ?? "open"));
  if (p.pipelineId) conditions.push(eq(dealsTable.pipelineId, p.pipelineId));
  if (p.ownerId) conditions.push(eq(dealsTable.ownerId, p.ownerId));
  if (filterSql) conditions.push(filterSql);
  conditions.push(isNotNull(dealsTable.expectedCloseDate));
  const where = and(...conditions);

  const monthExpr = sql<string>`to_char(${dealsTable.expectedCloseDate}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month: monthExpr,
      count: sql<number>`count(*)::int`,
      totalValue: sql<number>`coalesce(sum(${dealsTable.value}), 0)`,
      weightedValue: sql<number>`coalesce(sum(${dealsTable.value} * ${stagesTable.probability} / 100.0), 0)`,
    })
    .from(dealsTable)
    .leftJoin(
      organizationsTable,
      eq(dealsTable.organizationId, organizationsTable.id),
    )
    .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .where(where)
    .groupBy(monthExpr)
    .orderBy(monthExpr);

  const buckets = rows.map((r) => {
    const [year, month] = r.month.split("-").map(Number);
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString(
      "en-US",
      { month: "long", year: "numeric", timeZone: "UTC" },
    );
    return {
      month: r.month,
      label,
      count: r.count,
      totalValue: r.totalValue,
      weightedValue: r.weightedValue,
    };
  });

  res.json(
    ForecastDealsResponse.parse({
      buckets,
      totalCount: buckets.reduce((s, b) => s + b.count, 0),
      totalValue: buckets.reduce((s, b) => s + b.totalValue, 0),
      totalWeightedValue: buckets.reduce((s, b) => s + b.weightedValue, 0),
    }),
  );
});

// Per-stage aggregates for one pipeline (home dashboard). One row per
// non-archived stage, zeroes included, in board order. Weighted value uses
// the same probability weighting as /deals/forecast.
router.get("/deals/stage-summary", async (req, res): Promise<void> => {
  const parsed = GetDealStageSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const p = parsed.data;

  const dealJoin: SQL[] = [
    eq(dealsTable.stageId, stagesTable.id),
    eq(dealsTable.archived, false),
    eq(dealsTable.status, p.status ?? "open"),
  ];
  if (p.ownerId) dealJoin.push(eq(dealsTable.ownerId, p.ownerId));

  const rows = await db
    .select({
      stageId: stagesTable.id,
      name: stagesTable.name,
      orderIndex: stagesTable.orderIndex,
      count: sql<number>`count(${dealsTable.id})::int`,
      totalValue: sql<number>`coalesce(sum(${dealsTable.value}), 0)::float8`,
      weightedValue: sql<number>`coalesce(sum(${dealsTable.value} * ${stagesTable.probability} / 100.0), 0)::float8`,
    })
    .from(stagesTable)
    .leftJoin(dealsTable, and(...dealJoin))
    .where(
      and(
        eq(stagesTable.pipelineId, p.pipelineId),
        eq(stagesTable.archived, false),
      ),
    )
    .groupBy(stagesTable.id, stagesTable.name, stagesTable.orderIndex)
    .orderBy(asc(stagesTable.orderIndex));

  res.json(
    GetDealStageSummaryResponse.parse({
      stages: rows,
      totalCount: rows.reduce((s, r) => s + r.count, 0),
      totalValue: rows.reduce((s, r) => s + r.totalValue, 0),
      totalWeightedValue: rows.reduce((s, r) => s + r.weightedValue, 0),
    }),
  );
});

// Merge a duplicate deal into a primary. preview=true dry-runs.
router.post("/deals/:id/merge", async (req, res): Promise<void> => {
  const params = MergeDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = MergeDealBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const user = currentUser(res);
  try {
    const summary = body.data.preview
      ? await previewMerge(params.data.id, body.data.intoDealId)
      : await mergeDeal(params.data.id, body.data.intoDealId, user.id);
    res.json(
      MergeDealResponse.parse({
        ...summary,
        preview: body.data.preview === true,
      }),
    );
  } catch (err) {
    if (err instanceof DealMergeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Failed to merge deals");
    res.status(500).json({ error: "Something went wrong." });
  }
});

/** `admin_only_reassign` of each of these pipelines (an unknown id reads as
 *  unlocked: there is no pipeline to lock). */
async function pipelineReassignLocks(
  dbc: typeof db | Tx,
  pipelineIds: number[],
): Promise<boolean[]> {
  const ids = [...new Set(pipelineIds)];
  if (!ids.length) return [];
  const rows = await dbc
    .select({ locked: pipelinesTable.adminOnlyReassign })
    .from(pipelinesTable)
    .where(inArray(pipelinesTable.id, ids));
  return rows.map((r) => r.locked);
}

router.post("/deals/bulk", async (req, res): Promise<void> => {
  const parsed = BulkUpdateDealsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { ids, action, stageId, ownerId } = parsed.data;
  const user = currentUser(res);
  const now = new Date();

  if (action === "set_owner" && ownerId == null) {
    res.status(400).json({ error: "ownerId is required for set_owner" });
    return;
  }
  if (action === "set_stage" && stageId == null) {
    res.status(400).json({ error: "stageId is required for set_stage" });
    return;
  }

  // For set_stage we only move deals already in the target stage's pipeline.
  let stagePipelineId: number | null = null;
  if (action === "set_stage") {
    const stage = await loadTargetStage(db, stageId as number);
    if (!stage) {
      res.status(400).json({ error: "Stage not found" });
      return;
    }
    const archivedError = archivedTargetError(stage);
    if (archivedError) {
      res.status(400).json({ error: archivedError });
      return;
    }
    stagePipelineId = stage.pipelineId;
  }

  const result = await db.transaction(async (tx) => {
    const where =
      action === "set_stage"
        ? and(
            inArray(dealsTable.id, ids),
            eq(dealsTable.pipelineId, stagePipelineId as number),
          )
        : inArray(dealsTable.id, ids);

    // Archived deals are read-only — bulk actions never touch them.
    const before = await tx
      .select()
      .from(dealsTable)
      .where(and(where, eq(dealsTable.archived, false)))
      .for("update");

    // Same gate as the single-deal PATCH: a deal can't enter a stage whose
    // required fields it hasn't filled. Blocked deals are skipped (the rest
    // still move) and reported so the client can prompt per deal.
    let blocked: {
      id: number;
      title: string;
      missingRequiredFields: { key: string; label: string }[];
    }[] = [];
    // A rep may bulk-reassign only when none of the selected deals sits in a
    // pipeline locked to admins (lib/deal-reassign.ts); one locked deal
    // refuses the whole request rather than silently skipping it.
    if (
      action === "set_owner" &&
      !user.isAdmin &&
      !ownerChangeAllowed({
        isAdmin: user.isAdmin,
        ownerChanged: true,
        lockedPipelines: await pipelineReassignLocks(
          tx,
          before.map((d) => d.pipelineId),
        ),
      })
    ) {
      return { status: 403 as const, error: OWNER_CHANGE_ADMIN_ONLY };
    }

    let affected = before;
    if (action === "set_stage") {
      const target = stageId as number;
      // A deal already in the target stage is not moved: rewriting its
      // stage_change_time would un-rot it with no stage event to show why,
      // and counting it would overstate updatedCount.
      const moving = before.filter((d) => d.stageId !== target);
      const missingByDeal = await computeMissingRequiredFieldsBulk(
        moving,
        target,
      );
      blocked = moving
        .filter((d) => missingByDeal.has(d.id))
        .map((d) => ({
          id: d.id,
          title: d.title,
          missingRequiredFields: (missingByDeal.get(d.id) ?? []).map((f) => ({
            key: f.key,
            label: f.label,
          })),
        }));
      affected = moving.filter((d) => !missingByDeal.has(d.id));
    }
    if (!affected.length) return { status: 200 as const, updatedCount: 0, blocked };
    const affectedIds = affected.map((d) => d.id);

    let setValues: Partial<typeof dealsTable.$inferInsert>;
    let patch: Record<string, unknown>;
    if (action === "delete") {
      setValues = { status: "deleted" };
      patch = { status: "deleted" };
    } else if (action === "set_owner") {
      setValues = { ownerId: ownerId as number };
      patch = { ownerId: ownerId as number };
    } else {
      setValues = { stageId: stageId as number, stageChangeTime: now };
      patch = { stageId: stageId as number };
    }

    await tx
      .update(dealsTable)
      .set(setValues)
      .where(inArray(dealsTable.id, affectedIds));
    await logDealChanges(
      tx,
      affected.map((b) => ({ before: b, patch })),
      { changedBy: user.id, changedAt: now },
    );
    return { status: 200 as const, updatedCount: affected.length, blocked };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(
    BulkUpdateDealsResponse.parse({
      updatedCount: result.updatedCount,
      ...(result.blocked.length ? { blocked: result.blocked } : {}),
    }),
  );
});

// Distinct labels across all deals, so the label picker can offer existing
// labels instead of free-typing a new one each time. Must precede /deals/:id.
router.get("/deals/labels", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ label: sql<string | null>`distinct unnest(${dealsTable.labels})` })
    .from(dealsTable)
    .where(isNotNull(dealsTable.labels))
    .orderBy(sql`1`);
  // text[] can hold NULL/empty elements; keep only real label strings.
  const labels = rows.map((r) => r.label).filter((l): l is string => !!l);
  res.json(ListDealLabelsResponse.parse(labels));
});

// Distinct owners that actually have deals, so the owner filter never lists old
// users with zero deals. Active accounts only: a deactivated user who
// still owns won/lost deals is not offered as a filter choice — their deals
// stay visible, and the automation/rule pickers reading this list get active
// users only. Must precede /deals/:id.
router.get("/deals/owners", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({
      id: usersTable.id,
      name: usersTable.name,
      teamName: teamsTable.name,
    })
    .from(dealsTable)
    .innerJoin(usersTable, eq(usersTable.id, dealsTable.ownerId))
    .leftJoin(teamsTable, eq(usersTable.teamId, teamsTable.id))
    .where(
      and(
        inArray(dealsTable.status, ["open", "won", "lost"]),
        eq(usersTable.activeFlag, true),
      ),
    )
    .orderBy(asc(usersTable.name));
  res.json(ListDealOwnersResponse.parse(rows));
});

router.get("/deals/:id", async (req, res): Promise<void> => {
  const params = GetDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const deal = await loadDealById(params.data.id);
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  res.json(GetDealResponse.parse(deal));
});

router.patch("/deals/:id", async (req, res): Promise<void> => {
  const params = UpdateDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = params.data.id;
  const d = parsed.data;
  const now = new Date();
  const user = currentUser(res);

  // Whether the client is explicitly touching the owner in this PATCH. When it
  // is (even to clear it), auto-assignment must not interfere.
  const ownerProvided =
    req.body != null &&
    Object.prototype.hasOwnProperty.call(req.body, "ownerId");

  // Lock the deal row for the lifetime of the transaction so the audit diff is
  // computed against a snapshot that cannot change underneath us — a concurrent
  // write can't produce a torn oldValue or a wrong no-op decision in the log.
  const webhooks: WebhookIntent[] = [];
  const slackMessages: SlackIntent[] = [];
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(dealsTable)
      .where(eq(dealsTable.id, id))
      .for("update");
    if (!existing) return { status: 404 as const, error: "Deal not found" };

    // Archived deals are read-only: the only accepted write is the restore
    // (archived=false). Everything else — UI, automations, API — bounces.
    if (existing.archived && d.archived !== false) {
      return {
        status: 409 as const,
        error:
          "This deal is archived and read-only. Restore it to make changes.",
        code: "DEAL_ARCHIVED" as const,
      };
    }

    // Reassigning is admin-only in a pipeline flagged admin_only_reassign,
    // checked against both the deal's pipeline and the one it moves to
    // (lib/deal-reassign.ts). Compared against the locked row rather than
    // "ownerId was sent", so a form that echoes the current owner back still
    // saves, and a move without an owner change is never refused. Assignment
    // rules, the first-activity claim and webhooks are not a person
    // reassigning and keep running in every pipeline.
    const ownerChanged =
      ownerProvided && (d.ownerId ?? null) !== existing.ownerId;
    if (
      ownerChanged &&
      !user.isAdmin &&
      !ownerChangeAllowed({
        isAdmin: user.isAdmin,
        ownerChanged,
        lockedPipelines: await pipelineReassignLocks(tx, [
          existing.pipelineId,
          d.pipelineId ?? existing.pipelineId,
        ]),
      })
    ) {
      return { status: 403 as const, error: OWNER_CHANGE_ADMIN_ONLY };
    }

    if (d.pipelineId != null || d.stageId != null) {
      const effPipeline = d.pipelineId ?? existing.pipelineId;
      const effStage = d.stageId ?? existing.stageId;
      const stage = await loadTargetStage(tx, effStage);
      if (!stage || stage.pipelineId !== effPipeline) {
        return {
          status: 400 as const,
          error: STAGE_NOT_IN_PIPELINE_ERROR,
        };
      }
      // Only a MOVE is refused: re-sending the stage a deal already sits in
      // (a won deal in a since-archived stage, say) is not a move.
      if (effStage !== existing.stageId || effPipeline !== existing.pipelineId) {
        const archivedError = archivedTargetError(stage);
        if (archivedError) {
          return { status: 400 as const, error: archivedError };
        }
      }

      // A stage move is blocked while the target stage's required fields are
      // still empty — the client fills them in a modal and retries. Checked
      // against the deal as it will be after this PATCH (same as the won gate
      // below), so a value sent alongside the move counts.
      if (d.stageId != null && d.stageId !== existing.stageId) {
        const missing = await computeMissingRequiredFields(
          { ...existing, ...d },
          d.stageId,
        );
        if (missing.length) {
          return {
            status: 409 as const,
            error: `"${stage.name}" requires ${missing.length} field${missing.length === 1 ? "" : "s"} before the deal can move.`,
            missingRequiredFields: missing,
            stageName: stage.name,
          };
        }
      }
    }

    // Marking a deal as won is blocked while the pipeline's won-required
    // fields are empty — same modal-and-retry contract as stage moves
    // (action: "won" adjusts the dialog). Checked against the deal as it will
    // be after this PATCH, so a value sent alongside status counts.
    if (d.status === "won" && existing.status !== "won") {
      const pipelineId = d.pipelineId ?? existing.pipelineId;
      const missing = await computeMissingWonFields(
        { ...existing, ...d },
        pipelineId,
      );
      if (missing.length) {
        return {
          status: 409 as const,
          error: `${missing.length} field${missing.length === 1 ? "" : "s"} must be filled before the deal can be marked as won.`,
          missingRequiredFields: missing,
          action: "won" as const,
        };
      }
    }

    const updates: Partial<typeof dealsTable.$inferInsert> = { ...d };

    // Archive lifecycle: stamp on archive, clear on restore.
    if (d.archived === true && !existing.archived) {
      updates.archiveTime = now;
    } else if (d.archived === false && existing.archived) {
      updates.archiveTime = null;
      // A restore also drops the merge pointer. Leaving it set produced a deal
      // that read as completely live — back in the pipeline, merge button and
      // all — but that could never be merged again in either direction, with
      // nothing on screen to say why and no code path able to clear it.
      // Un-archiving is the deliberate "this is a real deal again" act, so it
      // takes the pointer with it. The merge stays on the record either way:
      // the `merged_from` event on the survivor is permanent, and so is this
      // deal's own `merged_into` marker.
      updates.mergedIntoDealId = null;
    }

    if (d.stageId != null && d.stageId !== existing.stageId) {
      updates.stageChangeTime = now;
    }
    if (d.status && d.status !== existing.status) {
      if (d.status === "won") {
        updates.wonTime = now;
        updates.closeTime = now;
        updates.lostTime = null;
      } else if (d.status === "lost") {
        updates.lostTime = now;
        updates.closeTime = now;
        updates.wonTime = null;
      } else {
        updates.wonTime = null;
        updates.lostTime = null;
        updates.closeTime = null;
      }
    }

    // Auto-assignment on "deal updated": fires only when the pipeline or stage
    // actually changed, and never when the client is setting the owner itself
    // in this same PATCH. Unowned deals may be routed by any matching rule;
    // an OWNED deal is only re-routed by a rule that explicitly opted into
    // "may take over owned deals" (e.g. a handover from one team to another).
    const pipelineOrStageChanged =
      (d.pipelineId != null && d.pipelineId !== existing.pipelineId) ||
      (d.stageId != null && d.stageId !== existing.stageId);
    let autoAssignedOwner: number | null = null;
    if (pipelineOrStageChanged && !ownerProvided) {
      const effective = { ...existing, ...updates };
      autoAssignedOwner = await resolveAutoAssignment(tx, "deal_updated", {
        title: effective.title,
        organizationId: effective.organizationId,
        value: effective.value,
        pipelineId: effective.pipelineId,
        stageId: effective.stageId,
        ownerId: effective.ownerId ?? null,
        createdDate: existing.addTime,
        wonTime: effective.wonTime,
        status: effective.status,
        utmKeyword: effective.utmKeyword,
        lostReason: effective.lostReason,
        customFields: effective.customFields,
      }, { dealOwned: existing.ownerId != null });
      // Reassigning to the same person is a no-op, not a change to audit.
      if (autoAssignedOwner === existing.ownerId) autoAssignedOwner = null;
      if (autoAssignedOwner != null) updates.ownerId = autoAssignedOwner;
    }

    await tx.update(dealsTable).set(updates).where(eq(dealsTable.id, id));
    const auditPatch: Record<string, unknown> = { ...d };
    await logDealChanges(tx, [{ before: existing, patch: auditPatch }], {
      changedBy: user.id,
      changedAt: now,
    });
    // Audit the auto-assignment separately with the automation source, so it is
    // never conflated with the user's edit (auditPatch never carries ownerId
    // here — the client didn't provide it).
    if (autoAssignedOwner != null) {
      await auditAutoAssignedOwner(tx, existing, autoAssignedOwner, now);
    }
    // Deal-updated automations are considered whenever the PATCH is a REAL
    // change — at least one client-supplied field genuinely differs from the
    // locked `existing` row. This reuses the SAME diff test the audit log uses
    // (valuesEqual on the client patch vs existing), so the trigger and the
    // audit log agree on what "changed" means; a no-op write never fires. We
    // compare `auditPatch` (the client body), NOT the DB `updates` object,
    // which carries server-computed Date fields (stageChangeTime, wonTime,
    // closeTime, archiveTime) that would misfire on nearly every write. A
    // "won" automation is now a deal_updated automation with a status-is-won
    // condition. The row is re-read so the engine sees post-update values, and
    // `existing` is handed over as the before: an automation with conditions
    // fires only when the deal ENTERS them (see dealAutomationMatches), so a
    // later comment on a won deal does not announce the win again.
    const dealChanged = Object.keys(auditPatch).some(
      (k) =>
        !valuesEqual(
          (existing as Record<string, unknown>)[k],
          auditPatch[k],
        ),
    );
    if (dealChanged) {
      const [updated] = await tx
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, id));
      if (updated) {
        // A won deal is announced by a user-configured "deal won" automation
        // (a deal_updated automation gated on status=won), so there is no
        // built-in Slack announcement here — one owner, no double-post.
        await runAutomations(
          tx,
          "deal_updated",
          updated,
          { depth: 0, actorId: user.id, webhooks, slackMessages },
          existing,
        );
      }
    }
    return {
      status: 200 as const,
      beforeStageId: existing.stageId,
      autoAssignedOwner,
      dealTitle: existing.title,
    };
  });

  // Fire collected webhooks/Slack only when the write actually committed (200).
  if (result.status === 200) {
    await fireWebhooks(webhooks);
    void fireSlackMessages(slackMessages);
  }

  if (result.status === 200 && result.autoAssignedOwner != null) {
    void notify({
      type: "deal_assigned",
      dealId: id,
      dealTitle: result.dealTitle,
      userId: result.autoAssignedOwner,
    });
  }

  if (result.status !== 200) {
    res.status(result.status).json({
      error: result.error,
      // 409s carry a machine-readable code: DEAL_ARCHIVED (read-only) or the
      // required-fields block with its field payload.
      ...("code" in result && result.code === "DEAL_ARCHIVED"
        ? { code: result.code }
        : result.status === 409
          ? {
              code: "REQUIRED_FIELDS_MISSING",
              missingRequiredFields: result.missingRequiredFields,
              ...("stageName" in result ? { stageName: result.stageName } : {}),
              ...("action" in result ? { action: result.action } : {}),
            }
          : {}),
    });
    return;
  }

  const deal = await loadDealById(id);
  // Required fields are enforced BEFORE the move commits (409 above), so a
  // successful response never carries missing fields.
  res.json(UpdateDealResponse.parse(deal));
});

router.delete("/deals/:id", async (req, res): Promise<void> => {
  const params = DeleteDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const user = currentUser(res);
  const found = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(dealsTable)
      .where(eq(dealsTable.id, id))
      .for("update");
    if (!existing) return false;
    await tx
      .update(dealsTable)
      .set({ status: "deleted" })
      .where(eq(dealsTable.id, id));
    await logDealChanges(
      tx,
      [{ before: existing, patch: { status: "deleted" } }],
      { changedBy: user.id },
    );
    return true;
  });
  if (!found) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/deals/:id/history", async (req, res): Promise<void> => {
  const params = GetDealHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;

  const deal = await loadDealById(id);
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  const events = await loadEntityHistory("deal", id);

  // Each stage_id event marks entry into a stage; the time spent there runs
  // until the next stage_id event. The deal's current stage runs until now()
  // while the deal is open, and stops at close_time once it is won or lost —
  // a closed deal is no longer spending time anywhere. (close_time is cleared
  // on reopen, so a reopened deal's clock runs again.)
  const nextEntry = sql<Date | null>`lead(${changeEventsTable.changedAt}) over (order by ${changeEventsTable.changedAt}, ${changeEventsTable.id})`;
  const closedAt = deal.closeTime ?? null;
  const openEnd = closedAt
    ? sql`greatest(${closedAt}::timestamptz, ${changeEventsTable.changedAt})`
    : sql`now()`;
  const stageDurations = await db
    .select({
      stageId: sql<number | null>`(${changeEventsTable.newValue}->>'id')::int`,
      stageName: sql<string | null>`${changeEventsTable.newValue}->>'label'`,
      enteredAt: changeEventsTable.changedAt,
      exitedAt: nextEntry,
      durationSeconds: sql<number>`extract(epoch from (coalesce(${nextEntry}, ${openEnd}) - ${changeEventsTable.changedAt}))::float8`,
    })
    .from(changeEventsTable)
    .where(
      and(
        eq(changeEventsTable.entityType, "deal"),
        eq(changeEventsTable.entityId, id),
        eq(changeEventsTable.fieldKey, "stage_id"),
      ),
    )
    .orderBy(asc(changeEventsTable.changedAt), asc(changeEventsTable.id));

  res.json(GetDealHistoryResponse.parse({ events, stageDurations }));
});


export default router;
