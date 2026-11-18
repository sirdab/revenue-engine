import { Router, type IRouter } from "express";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ilike,
  notInArray,
  isNull,
  or,
  count,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  activitiesTable,
  activityTypeEnum,
  dealsTable,
  personsTable,
} from "@workspace/db";
import {
  ListActivitiesQueryParams,
  ListActivitiesResponse,
  CreateActivityBody,
  GetActivityParams,
  GetActivityResponse,
  UpdateActivityParams,
  UpdateActivityBody,
  UpdateActivityResponse,
  BulkUpdateActivitiesBody,
  BulkUpdateActivitiesResponse,
  DeleteActivityParams,
  PostActivityParams,
  PostActivityResponse,
  GetActivityHistoryParams,
  GetActivityHistoryResponse,
  MarkActivityNoReplyParams,
  MarkActivityNoReplyResponse,
} from "@workspace/api-zod";
import {
  activityQuery,
  activityDealOrg,
  loadActivityById,
  parsePagination,
  resolveOrderBy,
  escapeLike,
  isDealArchived,
  ARCHIVED_DEAL_ERROR,
  stripFalsyBooleanParams,
} from "../lib/queries";
import { isRealIsoDate } from "../lib/assistant-dates";
import { currentUser } from "../lib/auth";
import { notifyMentions } from "../lib/mentions";
import { claimUntouchedDeal } from "../lib/deal-claim";
import {
  logEntityEvent,
  logEntityEvents,
  logFieldChanges,
  TRACKED_ACTIVITY_FIELDS,
  loadEntityHistory,
} from "../lib/change-events";
import {
  DEAL_ACTIVITY_CONTACT_TYPES,
  loggedOutcomeError,
  noReplyRefusal,
  outcomeForDone,
} from "../lib/activity-outcome";

const router: IRouter = Router();

// Due-date buckets, keyed off a reference day. `today` comes from the client
// (its local calendar day) so "overdue vs today" matches what the user sees;
// activities with no due date count as upcoming rather than vanishing.
type Bucket = "overdue" | "today" | "upcoming" | "done";

const BUCKETS: readonly Bucket[] = ["overdue", "today", "upcoming", "done"];

function bucketConditions(today: string): Record<Bucket, SQL> {
  const open = eq(activitiesTable.done, false);
  return {
    done: eq(activitiesTable.done, true),
    overdue: and(open, lt(activitiesTable.dueDate, today))!,
    today: and(open, eq(activitiesTable.dueDate, today))!,
    upcoming: and(
      open,
      or(gt(activitiesTable.dueDate, today), isNull(activitiesTable.dueDate)),
    )!,
  };
}

const countWhere = (cond: SQL) =>
  sql<number>`count(*) filter (where ${cond})`.mapWith(Number);

// Paginated, filtered search — high-performance list endpoint. The board/agenda
// views pass a bounded window so they never pull the whole activity history.
// Responds with `buckets`: per-bucket counts over the filtered set (ignoring
// the bucket filter itself and pagination) so summary tiles stay truthful on
// any page.
router.get("/activities/search", async (req, res): Promise<void> => {
  // Drafts never surface on the agenda/board — the exclusion sits in the
  // shared conditions so both the page and the bucket aggregate skip them.
  const conditions: SQL[] = [eq(activitiesTable.draft, false)];
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

  const q = str(req.query.q)?.trim();
  if (q) {
    const term = `%${escapeLike(q)}%`;
    const cond = or(
      ilike(activitiesTable.subject, term),
      ilike(activitiesTable.note, term),
      ilike(dealsTable.title, term),
    );
    if (cond) conditions.push(cond);
  }
  // The done/undone filter is applied to the page below but kept OUT of the
  // shared `conditions` (and thus the aggregate), so the summary tiles stay
  // whole-dataset — exactly how the bucket filter is treated.
  const doneFilter =
    req.query.done === "true"
      ? eq(activitiesTable.done, true)
      : req.query.done === "false"
        ? eq(activitiesTable.done, false)
        : undefined;
  const type = str(req.query.type);
  if (type) {
    const known = activityTypeEnum.enumValues.find((t) => t === type);
    if (!known) {
      res.status(400).json({ error: `Unknown activity type "${type}".` });
      return;
    }
    conditions.push(eq(activitiesTable.type, known));
  }
  const ownerId = num(req.query.ownerId);
  if (ownerId) conditions.push(eq(activitiesTable.ownerId, ownerId));
  const dealId = num(req.query.dealId);
  if (dealId) conditions.push(eq(activitiesTable.dealId, dealId));
  // Pipeline filter rides the deal join both queries already use.
  const pipelineId = num(req.query.pipelineId);
  if (pipelineId) conditions.push(eq(dealsTable.pipelineId, pipelineId));
  const personId = num(req.query.personId);
  if (personId) conditions.push(eq(activitiesTable.personId, personId));
  const orgId = num(req.query.orgId);
  if (orgId) conditions.push(eq(activitiesTable.orgId, orgId));
  const dueFrom = str(req.query.dueFrom);
  const dueTo = str(req.query.dueTo);
  for (const [name, value] of [["dueFrom", dueFrom], ["dueTo", dueTo]]) {
    if (value && !isRealIsoDate(value)) {
      res.status(400).json({ error: `${name} must be a real YYYY-MM-DD date.` });
      return;
    }
  }
  if (dueFrom) conditions.push(gte(activitiesTable.dueDate, dueFrom));
  if (dueTo) conditions.push(lte(activitiesTable.dueDate, dueTo));

  const todayParam = str(req.query.today);
  const today =
    todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam)
      ? todayParam
      : new Date().toISOString().slice(0, 10);
  const byBucket = bucketConditions(today);
  const bucket = BUCKETS.find((b) => b === req.query.bucket);
  // Page filters = shared conditions + the done filter + the selected bucket.
  const pageConds = [...conditions];
  if (doneFilter) pageConds.push(doneFilter);
  if (bucket) pageConds.push(byBucket[bucket]);
  const where = pageConds.length ? and(...pageConds) : undefined;

  const { page, limit, offset } = parsePagination(
    req.query as Record<string, unknown>,
    500,
  );
  // Keys must match the column ids the activities grid sends as `field:dir`.
  const orderBy = resolveOrderBy(
    req.query.sort as string | undefined,
    {
      subject: activitiesTable.subject,
      type: activitiesTable.type,
      due: activitiesTable.dueDate,
      dueDate: activitiesTable.dueDate,
      deal: dealsTable.title,
      // The grid's organization column: the deal's CRM org, sortable because
      // activityQuery already joins it.
      organization: activityDealOrg.name,
      person: personsTable.name,
      addTime: activitiesTable.addTime,
    },
    [asc(activitiesTable.done), asc(activitiesTable.dueDate)],
    activitiesTable.id,
  );

  // The q predicate can reference the joined deal title, so both the page and
  // the aggregate ride the same joined shape. One pass yields the overall
  // total plus every bucket count.
  const aggregate = () =>
    db
      .select({
        total: count(),
        overdue: countWhere(byBucket.overdue),
        today: countWhere(byBucket.today),
        upcoming: countWhere(byBucket.upcoming),
        done: countWhere(byBucket.done),
      })
      .from(activitiesTable)
      .leftJoin(dealsTable, eq(activitiesTable.dealId, dealsTable.id))
      .$dynamic();

  const [rows, [counts]] = await Promise.all([
    activityQuery()
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    aggregate().where(conditions.length ? and(...conditions) : undefined),
  ]);

  const items = rows;

  const { total, ...buckets } = counts;
  // Row count reflects the actual filtered page (bucket or done/undone), while
  // the bucket counts stay whole-dataset for the summary tiles.
  const filteredTotal = bucket
    ? buckets[bucket]
    : req.query.done === "false"
      ? buckets.overdue + buckets.today + buckets.upcoming
      : req.query.done === "true"
        ? buckets.done
        : total;
  res.json({
    items,
    page,
    limit,
    total: filteredTotal,
    buckets,
  });
});

router.get("/activities", async (req, res): Promise<void> => {
  // `includeDrafts=false`/`draftsOnly=false` must read as absent, not coerce to true.
  const parsed = ListActivitiesQueryParams.safeParse(
    stripFalsyBooleanParams(req.query, ["includeDrafts", "draftsOnly"]),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const {
    done,
    type,
    ownerId,
    dealId,
    personId,
    orgId,
    includeDrafts,
    draftsOnly,
    limit,
  } = parsed.data;
  const user = currentUser(res);
  // Draft visibility (creator-only, enforced in SQL — other users' drafts are
  // never returned): draftsOnly returns just the caller's drafts (a dedicated
  // drafts list that isn't buried under the posted-activity window); otherwise
  // drafts are excluded, and includeDrafts adds back the caller's own.
  const conditions: SQL[] = [
    draftsOnly
      ? and(
          eq(activitiesTable.draft, true),
          eq(activitiesTable.creatorUserId, user.id),
        )!
      : includeDrafts
        ? or(
            eq(activitiesTable.draft, false),
            eq(activitiesTable.creatorUserId, user.id),
          )!
        : eq(activitiesTable.draft, false),
  ];
  if (done !== undefined) conditions.push(eq(activitiesTable.done, done));
  if (type) conditions.push(eq(activitiesTable.type, type));
  if (ownerId) conditions.push(eq(activitiesTable.ownerId, ownerId));
  if (dealId) conditions.push(eq(activitiesTable.dealId, dealId));
  if (personId) conditions.push(eq(activitiesTable.personId, personId));
  if (orgId) conditions.push(eq(activitiesTable.orgId, orgId));

  const rows = await activityQuery()
    .where(and(...conditions))
    .orderBy(asc(activitiesTable.done), asc(activitiesTable.dueDate))
    .limit(limit ?? 500);
  res.json(ListActivitiesResponse.parse(rows));
});

router.post("/activities", async (req, res): Promise<void> => {
  const parsed = CreateActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const outcomeError = loggedOutcomeError(d, DEAL_ACTIVITY_CONTACT_TYPES);
  if (outcomeError) {
    res.status(400).json({ error: outcomeError });
    return;
  }
  const user = currentUser(res);
  // A logged outcome (replied / no reply) is something that already
  // happened, so it is written closed.
  const done = d.outcome !== undefined || (d.done ?? false);
  const outcome = done ? (d.outcome ?? outcomeForDone(true)) : null;
  const draft = d.draft ?? false;

  // Archived deals are read-only — no new linked activities.
  if (await isDealArchived(d.dealId)) {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }

  const created = await db.transaction(async (tx) => {
    // First activity a person logs on an untouched deal makes them its owner.
    // Before the insert, so the deal row is locked first (see deal-claim.ts);
    // a draft claims nothing until it is posted.
    if (d.dealId != null && !draft) {
      await claimUntouchedDeal(tx, d.dealId, user.id);
    }
    const [row] = await tx
      .insert(activitiesTable)
      .values({
        subject: d.subject,
        type: d.type,
        note: d.note ?? null,
        done,
        dueDate: d.dueDate ?? null,
        dueTime: d.dueTime ?? null,
        duration: d.duration ?? null,
        dealId: d.dealId ?? null,
        personId: d.personId ?? null,
        orgId: d.orgId ?? null,
        ownerId: d.ownerId ?? user.id,
        creatorUserId: user.id,
        draft,
        markedAsDoneTime: done ? new Date() : null,
        outcome,
      })
      .returning();
    // The History tab is visible to everyone; a draft logs nothing until it
    // is posted (the "created" event fires at post time instead).
    if (!draft) {
      await logEntityEvent(tx, "activity", row.id, "created", null, { id: row.id, label: row.subject }, {
        changedBy: user.id,
        source: "ui",
      });
    }
    return row;
  });

  // Mentions fire after commit, never blocking — but a draft stays silent
  // until it is posted (see POST /activities/:id/post).
  if (!draft) {
    void notifyMentions({
      content: created.note,
      actor: { id: user.id, name: user.name },
      target: created,
    });
  }
  const activity = await loadActivityById(created.id);
  res.status(201).json(GetActivityResponse.parse(activity));
});

// Bulk mark done/open or delete — mirrors POST /deals/bulk. Drafts are never
// bulk-touched (the page only lists posted activities, and foreign drafts must
// stay invisible), and rows already in the target done state are skipped so
// updatedCount is honest and history isn't spammed. Unlike the single-item
// mark-done flow there is no capture-details step: bulk just flips the state.
const notOnArchivedDeal = sql`not exists (
  select 1 from ${dealsTable}
  where ${dealsTable.id} = ${activitiesTable.dealId} and ${dealsTable.archived}
)`;

router.post("/activities/bulk", async (req, res): Promise<void> => {
  const parsed = BulkUpdateActivitiesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { ids, action } = parsed.data;
  const user = currentUser(res);
  const now = new Date();

  const updatedCount = await db.transaction(async (tx) => {
    const conditions = [
      inArray(activitiesTable.id, ids),
      eq(activitiesTable.draft, false),
      // Archived deals are read-only, their activities included — bulk
      // actions skip them, the same way deal bulk actions skip archived deals.
      notOnArchivedDeal,
    ];
    if (action === "mark_done") {
      conditions.push(eq(activitiesTable.done, false));
      // Calls, meetings, emails and WhatsApp are closed one at a time, because
      // closing one asks whether they replied and bulk has no such
      // step. Skipping them here, not in the UI, is what stops a bulk close
      // from counting unanswered calls as successful.
      conditions.push(
        notInArray(activitiesTable.type, [...DEAL_ACTIVITY_CONTACT_TYPES]),
      );
    }
    if (action === "mark_open") conditions.push(eq(activitiesTable.done, true));
    const before = await tx
      .select()
      .from(activitiesTable)
      .where(and(...conditions))
      .for("update");
    if (!before.length) return 0;
    const affectedIds = before.map((a) => a.id);

    if (action === "delete") {
      await tx
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, affectedIds));
      await logEntityEvents(
        tx,
        before.map((a) => ({
          entityType: "activity" as const,
          entityId: a.id,
          fieldKey: "deleted",
          oldValue: { id: a.id, label: a.subject },
          newValue: null,
        })),
        { changedBy: user.id, changedAt: now, source: "ui" },
      );
      return before.length;
    }

    const done = action === "mark_done";
    await tx
      .update(activitiesTable)
      .set({
        done,
        markedAsDoneTime: done ? now : null,
        outcome: outcomeForDone(done),
      })
      .where(inArray(activitiesTable.id, affectedIds));
    await logFieldChanges(
      tx,
      "activity",
      before.map((a) => ({
        entityId: a.id,
        before: a,
        patch: { done, outcome: outcomeForDone(done) },
      })),
      TRACKED_ACTIVITY_FIELDS,
      { changedBy: user.id, changedAt: now, source: "ui" },
    );
    return before.length;
  });

  res.json(BulkUpdateActivitiesResponse.parse({ updatedCount }));
});

router.get("/activities/:id", async (req, res): Promise<void> => {
  const params = GetActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const activity = await loadActivityById(params.data.id);
  // A foreign draft is invisible — indistinguishable from a missing row.
  if (!activity || (activity.draft && activity.creatorUserId !== user.id)) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  res.json(GetActivityResponse.parse(activity));
});

router.patch("/activities/:id", async (req, res): Promise<void> => {
  const params = UpdateActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof activitiesTable.$inferInsert> = { ...d };

  const user = currentUser(res);
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.id, params.data.id))
      .for("update");
    if (!existing) return null;
    // Drafts are creator-only (a foreign draft 404s like a missing row) and
    // log no history until posted.
    if (existing.draft && existing.creatorUserId !== user.id) return null;
    // Archived deals are read-only, their activities included: no edits to one
    // linked to an archived deal, and none moved onto one (same rule as create).
    if (
      (await isDealArchived(existing.dealId)) ||
      (d.dealId !== undefined &&
        d.dealId !== existing.dealId &&
        (await isDealArchived(d.dealId)))
    ) {
      return "archived" as const;
    }
    // Stamp the completion time only on a real transition: re-sending
    // done:true must not move a completion to a later day (insights count it
    // on the day it was stamped).
    if (d.done !== undefined && d.done !== existing.done) {
      updates.markedAsDoneTime = d.done ? new Date() : null;
      updates.outcome = outcomeForDone(d.done);
    }
    const [row] = await tx
      .update(activitiesTable)
      .set(updates)
      .where(eq(activitiesTable.id, params.data.id))
      .returning();
    // Drafts log no history until they're posted.
    if (!existing.draft) {
      await logFieldChanges(
        tx,
        "activity",
        [{ entityId: row.id, before: existing, patch: updates }],
        TRACKED_ACTIVITY_FIELDS,
        { changedBy: user.id, source: "ui" },
      );
    }
    return { row, previousNote: existing.note, wasDraft: existing.draft };
  });
  if (updated === "archived") {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  if (!updated) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  // Posted activities only: a still-draft edit stays silent until posted.
  if (!updated.wasDraft && d.note !== undefined) {
    void notifyMentions({
      content: updated.row.note,
      previousContent: updated.previousNote,
      actor: { id: user.id, name: user.name },
      target: updated.row,
    });
  }
  const activity = await loadActivityById(updated.row.id);
  res.json(UpdateActivityResponse.parse(activity));
});

router.delete("/activities/:id", async (req, res): Promise<void> => {
  const params = DeleteActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const activity = await db.transaction(async (tx) => {
    // Only the creator may discard a draft — a foreign draft matches zero
    // rows and 404s like a missing row. Discarding a draft leaves no trace.
    const [existing] = await tx
      .select()
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.id, params.data.id),
          or(
            eq(activitiesTable.draft, false),
            eq(activitiesTable.creatorUserId, user.id),
          ),
        ),
      )
      .for("update");
    if (!existing) return null;
    // Archived deals are read-only, their activities included. Discarding
    // your own draft stays allowed: it can never be posted there, and
    // otherwise it could never be removed either.
    if (!existing.draft && (await isDealArchived(existing.dealId))) {
      return "archived" as const;
    }
    const [deleted] = await tx
      .delete(activitiesTable)
      .where(eq(activitiesTable.id, existing.id))
      .returning();
    if (!deleted) return null;
    if (!deleted.draft) {
      await logEntityEvent(
        tx,
        "activity",
        deleted.id,
        "deleted",
        { id: deleted.id, label: deleted.subject },
        null,
        { changedBy: user.id, source: "ui" },
      );
    }
    return deleted;
  });
  if (activity === "archived") {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  if (!activity) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  res.sendStatus(204);
});

// Publish a draft. One-way transition: `addTime` is reset to the post time so
// the entry sorts as new, and the "created" history event fires now (nothing
// was logged while it was a draft). Posting an already-posted entry is an
// idempotent no-op.
router.post("/activities/:id/post", async (req, res): Promise<void> => {
  const params = PostActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const posted = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.id, params.data.id))
      .for("update");
    if (!existing) return null;
    if (existing.draft && existing.creatorUserId !== user.id) return null;
    if (!existing.draft) return { row: existing, published: false };
    // Archived deals are read-only — a draft linked to one cannot post.
    if (await isDealArchived(existing.dealId)) return "archived" as const;
    if (existing.dealId != null) {
      await claimUntouchedDeal(tx, existing.dealId, user.id, existing.id);
    }
    const [row] = await tx
      .update(activitiesTable)
      .set({ draft: false, addTime: new Date() })
      .where(eq(activitiesTable.id, params.data.id))
      .returning();
    await logEntityEvent(tx, "activity", row.id, "created", null, { id: row.id, label: row.subject }, {
      changedBy: user.id,
      source: "ui",
    });
    return { row, published: true };
  });
  if (posted === "archived") {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  if (!posted) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  // Publishing a draft is its first chance to notify — it stayed silent while
  // a draft, so every mention fires here.
  if (posted.published) {
    void notifyMentions({
      content: posted.row.note,
      actor: { id: user.id, name: user.name },
      target: posted.row,
    });
  }
  const activity = await loadActivityById(posted.row.id);
  res.json(PostActivityResponse.parse(activity));
});

// "No reply" on planned work: the attempt closes as no_reply and an open copy
// takes its place to reschedule, with the history rows, in one transaction.
// Drafts are refused (post first) and a foreign draft 404s like a missing row.
router.post("/activities/:id/no-reply", async (req, res): Promise<void> => {
  const params = MarkActivityNoReplyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.id, params.data.id))
      .for("update");
    if (!before || (before.draft && before.creatorUserId !== user.id)) {
      return { status: 404 as const, error: "Activity not found" };
    }
    const refusal = noReplyRefusal(before, DEAL_ACTIVITY_CONTACT_TYPES);
    if (refusal) return { status: 409 as const, error: refusal };
    if (await isDealArchived(before.dealId)) {
      return { status: 409 as const, error: ARCHIVED_DEAL_ERROR };
    }
    const patch = { done: true, outcome: "no_reply" as const };
    await tx
      .update(activitiesTable)
      .set({ ...patch, markedAsDoneTime: new Date() })
      .where(eq(activitiesTable.id, before.id));
    await logFieldChanges(
      tx,
      "activity",
      [{ entityId: before.id, before, patch }],
      TRACKED_ACTIVITY_FIELDS,
      { changedBy: user.id, source: "ui" },
    );
    const [copy] = await tx
      .insert(activitiesTable)
      .values({
        subject: before.subject,
        type: before.type,
        note: before.note,
        busy: before.busy,
        dueDate: before.dueDate,
        dueTime: before.dueTime,
        duration: before.duration,
        dealId: before.dealId,
        personId: before.personId,
        orgId: before.orgId,
        leadId: before.leadId,
        ownerId: before.ownerId,
        creatorUserId: user.id,
      })
      .returning();
    await logEntityEvent(
      tx,
      "activity",
      copy.id,
      "created",
      null,
      { id: copy.id, label: copy.subject },
      { changedBy: user.id, source: "ui" },
    );
    return { status: 200 as const, closedId: before.id, followUpId: copy.id };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const [closed, followUp] = await Promise.all([
    loadActivityById(result.closedId),
    loadActivityById(result.followUpId),
  ]);
  res.json(MarkActivityNoReplyResponse.parse({ closed, followUp }));
});

router.get("/activities/:id/history", async (req, res): Promise<void> => {
  const params = GetActivityHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const activity = await loadActivityById(params.data.id);
  if (!activity || (activity.draft && activity.creatorUserId !== user.id)) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  const events = await loadEntityHistory("activity", params.data.id);
  res.json(GetActivityHistoryResponse.parse({ events }));
});

export default router;
