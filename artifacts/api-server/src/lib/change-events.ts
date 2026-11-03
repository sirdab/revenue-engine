import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  changeEventsTable,
  stagesTable,
  usersTable,
  pipelinesTable,
  personsTable,
  organizationsTable,
  dealsTable,
  type Deal,
  type Organization,
  type Person,
  type Activity,
  type Note,
  type ChangeValueSnapshot,
} from "@workspace/db";

// The table's own insert type preserves the typed jsonb snapshot columns, which
// the drizzle-zod insert schema would otherwise widen to a generic Json value.
type ChangeEventInsert = typeof changeEventsTable.$inferInsert;

// A database executor that is part of an open transaction. Every logged write
// runs inside the caller's transaction so the entity mutation and its history
// rows commit (or roll back) atomically.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ChangeSource = "ui" | "import" | "api" | "automation";

export interface ChangeContext {
  // Always taken from the authenticated server context — clients can never
  // author history on behalf of another user.
  changedBy: number | null;
  source?: ChangeSource;
  // When omitted, the database default (now()) is used. Passing an explicit
  // timestamp keeps a deal's stage event aligned with its stageChangeTime.
  changedAt?: Date;
}

// Reference fields carry a foreign-key id we resolve to a human label so the
// timeline still reads correctly after a stage/owner/pipeline/person/org/deal
// is renamed.
type RefKind =
  | "stage"
  | "user"
  | "pipeline"
  | "person"
  | "organization"
  | "deal"
  | null;

interface TrackedField<T = Record<string, unknown>> {
  key: keyof T;
  fieldKey: string;
  ref: RefKind;
}

// Every editable deal field whose changes we record — the same breadth
// Pipedrive's deal "flow" tracks, so a deal managed here has a history as
// complete as an imported one. Derived timestamps (wonTime, stageChangeTime,
// updateTime, …), the creator, and Pipedrive import internals are intentionally
// excluded: they are computed side effects, not user edits. The `fieldKey`
// strings are the canonical (snake_case) names shared with the import backfill
// so app-authored and imported events line up in one timeline.
const TRACKED_DEAL_FIELDS: readonly TrackedField<Deal>[] = [
  // Core pipeline fields.
  { key: "stageId", fieldKey: "stage_id", ref: "stage" },
  { key: "ownerId", fieldKey: "owner_id", ref: "user" },
  { key: "pipelineId", fieldKey: "pipeline_id", ref: "pipeline" },
  { key: "personId", fieldKey: "person_id", ref: "person" },
  { key: "organizationId", fieldKey: "organization_id", ref: "organization" },
  { key: "value", fieldKey: "value", ref: null },
  { key: "currency", fieldKey: "currency", ref: null },
  { key: "status", fieldKey: "status", ref: null },
  // Archive/restore was previously untracked, which made a restore invisible:
  // when one left a deal in a broken state there was no record of who did it.
  { key: "archived", fieldKey: "archived", ref: null },
  { key: "title", fieldKey: "title", ref: null },
  { key: "expectedCloseDate", fieldKey: "expected_close_date", ref: null },
  { key: "lostReason", fieldKey: "lost_reason", ref: null },
  { key: "lostReasonNote", fieldKey: "lost_reason_note", ref: null },
  { key: "visibleTo", fieldKey: "visible_to", ref: null },
  { key: "comments", fieldKey: "comments", ref: null },
  { key: "labels", fieldKey: "labels", ref: null },
  // Ad / UTM attribution.
  { key: "utmSource", fieldKey: "utm_source", ref: null },
  { key: "utmMedium", fieldKey: "utm_medium", ref: null },
  { key: "utmCampaign", fieldKey: "utm_campaign", ref: null },
  { key: "utmKeyword", fieldKey: "utm_keyword", ref: null },
  { key: "adName", fieldKey: "ad_name", ref: null },
  { key: "gclid", fieldKey: "gclid", ref: null },
  { key: "fbclid", fieldKey: "fbclid", ref: null },
];

// Organization fields we record on edit.
export const TRACKED_ORG_FIELDS: readonly TrackedField<Organization>[] = [
  { key: "name", fieldKey: "name", ref: null },
  { key: "address", fieldKey: "address", ref: null },
  { key: "ownerId", fieldKey: "owner_id", ref: "user" },
  { key: "labels", fieldKey: "labels", ref: null },
];

// Person fields we record on edit.
export const TRACKED_PERSON_FIELDS: readonly TrackedField<Person>[] = [
  { key: "name", fieldKey: "name", ref: null },
  { key: "phone", fieldKey: "phone", ref: null },
  { key: "email", fieldKey: "email", ref: null },
  { key: "jobTitle", fieldKey: "job_title", ref: null },
  { key: "organizationId", fieldKey: "organization_id", ref: "organization" },
  { key: "ownerId", fieldKey: "owner_id", ref: "user" },
  { key: "labels", fieldKey: "labels", ref: null },
];

// Activity fields we record on edit. Note the schema uses `orgId`,
// not `organizationId` — activities/notes are the one table family that
// differs from persons/deals on this name (see SCHEMA.md).
export const TRACKED_ACTIVITY_FIELDS: readonly TrackedField<Activity>[] = [
  { key: "subject", fieldKey: "subject", ref: null },
  { key: "type", fieldKey: "type", ref: null },
  { key: "done", fieldKey: "done", ref: null },
  { key: "outcome", fieldKey: "outcome", ref: null },
  { key: "dueDate", fieldKey: "due_date", ref: null },
  { key: "dueTime", fieldKey: "due_time", ref: null },
  { key: "duration", fieldKey: "duration", ref: null },
  { key: "dealId", fieldKey: "deal_id", ref: "deal" },
  { key: "personId", fieldKey: "person_id", ref: "person" },
  { key: "orgId", fieldKey: "org_id", ref: "organization" },
  { key: "ownerId", fieldKey: "owner_id", ref: "user" },
];

// Note fields we record on edit. Author is `userId`, not `ownerId`.
export const TRACKED_NOTE_FIELDS: readonly TrackedField<Note>[] = [
  { key: "content", fieldKey: "content", ref: null },
  { key: "pinnedToDealFlag", fieldKey: "pinned_to_deal_flag", ref: null },
  { key: "pinnedToPersonFlag", fieldKey: "pinned_to_person_flag", ref: null },
  {
    key: "pinnedToOrganizationFlag",
    fieldKey: "pinned_to_organization_flag",
    ref: null,
  },
];

interface LabelMaps {
  stage: Map<number, string>;
  user: Map<number, string>;
  pipeline: Map<number, string>;
  person: Map<number, string>;
  organization: Map<number, string>;
  deal: Map<number, string>;
}

// Mutable set of referenced ids to batch-resolve, one bucket per ref kind.
interface RefIds {
  stage: Set<number>;
  user: Set<number>;
  pipeline: Set<number>;
  person: Set<number>;
  organization: Set<number>;
  deal: Set<number>;
}

function emptyRefIds(): RefIds {
  return {
    stage: new Set(),
    user: new Set(),
    pipeline: new Set(),
    person: new Set(),
    organization: new Set(),
    deal: new Set(),
  };
}

// Batch-resolve every referenced id to its label in one query per table, so a
// bulk operation touching many deals never degrades into per-row lookups.
async function resolveLabels(tx: Tx, ids: RefIds): Promise<LabelMaps> {
  const maps: LabelMaps = {
    stage: new Map(),
    user: new Map(),
    pipeline: new Map(),
    person: new Map(),
    organization: new Map(),
    deal: new Map(),
  };
  if (ids.stage.size) {
    const rows = await tx
      .select({ id: stagesTable.id, name: stagesTable.name })
      .from(stagesTable)
      .where(inArray(stagesTable.id, [...ids.stage]));
    for (const r of rows) maps.stage.set(r.id, r.name);
  }
  if (ids.user.size) {
    const rows = await tx
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, [...ids.user]));
    for (const r of rows) maps.user.set(r.id, r.name);
  }
  if (ids.pipeline.size) {
    const rows = await tx
      .select({ id: pipelinesTable.id, name: pipelinesTable.name })
      .from(pipelinesTable)
      .where(inArray(pipelinesTable.id, [...ids.pipeline]));
    for (const r of rows) maps.pipeline.set(r.id, r.name);
  }
  if (ids.person.size) {
    const rows = await tx
      .select({ id: personsTable.id, name: personsTable.name })
      .from(personsTable)
      .where(inArray(personsTable.id, [...ids.person]));
    for (const r of rows) maps.person.set(r.id, r.name);
  }
  if (ids.organization.size) {
    const rows = await tx
      .select({ id: organizationsTable.id, name: organizationsTable.name })
      .from(organizationsTable)
      .where(inArray(organizationsTable.id, [...ids.organization]));
    for (const r of rows) maps.organization.set(r.id, r.name);
  }
  if (ids.deal.size) {
    const rows = await tx
      .select({ id: dealsTable.id, name: dealsTable.title })
      .from(dealsTable)
      .where(inArray(dealsTable.id, [...ids.deal]));
    for (const r of rows) maps.deal.set(r.id, r.name);
  }
  return maps;
}

const REF_MAP_KEY: Record<Exclude<RefKind, null>, keyof LabelMaps> = {
  stage: "stage",
  user: "user",
  pipeline: "pipeline",
  person: "person",
  organization: "organization",
  deal: "deal",
};

function snapshot(
  field: TrackedField<Record<string, unknown>>,
  raw: unknown,
  labels: LabelMaps,
): ChangeValueSnapshot | null {
  if (raw == null) return null;
  if (field.ref) {
    const id = raw as number;
    return { id, label: labels[REF_MAP_KEY[field.ref]].get(id) ?? null };
  }
  // Array fields (e.g. labels) render as a comma-joined label.
  if (Array.isArray(raw)) {
    return raw.length ? { label: raw.map(String).join(", ") } : null;
  }
  return typeof raw === "number"
    ? { id: raw, label: String(raw) }
    : { label: String(raw) };
}

function collectRefId(
  field: TrackedField<Record<string, unknown>>,
  raw: unknown,
  ids: RefIds,
): void {
  if (raw == null || typeof raw !== "number" || !field.ref) return;
  ids[REF_MAP_KEY[field.ref]].add(raw);
}

// Value-equality that understands arrays (labels) so a no-op edit (same set of
// labels, possibly reordered) doesn't produce a spurious event. Primitives use
// strict equality, matching the previous behaviour.
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  return false;
}

async function insertChangeEvents(
  tx: Tx,
  rows: ChangeEventInsert[],
): Promise<void> {
  if (!rows.length) return;
  // onConflictDoNothing makes re-imports idempotent against the unique
  // (entity_type, entity_id, field_key, changed_at) dedupe index.
  await tx.insert(changeEventsTable).values(rows).onConflictDoNothing();
}

// The audit timeline for one entity, oldest first, with the editor's name
// joined in — the same query deals.ts's history route used inline before this
// was extracted so organizations/persons/activities/notes can share
// it instead of re-writing it per route file.
//
// Bounded to the most recent `limit` events: a high-churn record can accrue
// thousands of rows, and an unbounded scan would balloon the query, the zod
// re-validation, and the rendered timeline. We fetch the newest N (indexed
// desc) then flip back to oldest-first for display — the tail of a long
// history is what anyone actually reads.
const HISTORY_LIMIT = 500;

export async function loadEntityHistory(
  entityType: ChangeEventInsert["entityType"],
  entityId: number,
  limit = HISTORY_LIMIT,
) {
  const rows = await db
    .select({
      id: changeEventsTable.id,
      entityType: changeEventsTable.entityType,
      entityId: changeEventsTable.entityId,
      fieldKey: changeEventsTable.fieldKey,
      oldValue: changeEventsTable.oldValue,
      newValue: changeEventsTable.newValue,
      changedBy: changeEventsTable.changedBy,
      changedByName: usersTable.name,
      changedAt: changeEventsTable.changedAt,
      source: changeEventsTable.source,
    })
    .from(changeEventsTable)
    .leftJoin(usersTable, eq(changeEventsTable.changedBy, usersTable.id))
    .where(
      and(
        eq(changeEventsTable.entityType, entityType),
        eq(changeEventsTable.entityId, entityId),
      ),
    )
    .orderBy(desc(changeEventsTable.changedAt), desc(changeEventsTable.id))
    .limit(limit);
  return rows.reverse();
}

// Audit a single custom-field value edit. `fieldKey` is namespaced by the
// caller (e.g. "cf:acv") so it never collides with the native deal field keys
// in TRACKED_DEAL_FIELDS or the `field_key = 'stage_id'` partial index. Lands on
// the deal (entityType "deal"), so the existing deal history timeline shows it.
export async function logCustomFieldChange(
  tx: Tx,
  dealId: number,
  fieldKey: string,
  oldValue: ChangeValueSnapshot | null,
  newValue: ChangeValueSnapshot | null,
  ctx: ChangeContext,
): Promise<void> {
  await insertChangeEvents(tx, [
    {
      entityType: "deal",
      entityId: dealId,
      fieldKey,
      oldValue,
      newValue,
      changedBy: ctx.changedBy,
      ...(ctx.changedAt ? { changedAt: ctx.changedAt } : {}),
      source: ctx.source ?? "ui",
    },
  ]);
}

// ---------------------------------------------------------------------------
// Config-entity + simple-marker audit (pipeline/stage/organization/person/
// activity/note/label "created"/"deleted"/"reorder" events). These are
// self-labeling — the entity's own name/value is the label — so no
// cross-table resolution is needed. (Richer ref-resolved *edit* logging for
// organization/person/activity/note goes through logFieldChanges instead.)
// ---------------------------------------------------------------------------

type ConfigEntityType =
  | "pipeline"
  | "stage"
  | "organization"
  | "person"
  | "activity"
  | "note"
  | "label"
  | "deal"
  // The WhatsApp support session: any signed-in user can unpair the
  // number, so the disconnect is recorded as a self-labelling marker event.
  | "whatsapp_session";

function configSnapshot(v: unknown): ChangeValueSnapshot | null {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  if (Array.isArray(v)) return { label: v.map(String).join(", ") };
  return { label: String(v) };
}

export interface EntityFieldSpec {
  key: string; // property on the before/patch objects
  fieldKey: string; // stored field_key
}

export interface EntityEventInput {
  entityType: ConfigEntityType;
  entityId: number;
  fieldKey: string;
  oldValue: ChangeValueSnapshot | null;
  newValue: ChangeValueSnapshot | null;
}

// Batch version of logEntityEvent: lets callers that produce many
// independent marker/field events under one ChangeContext (label rename/delete
// fanout, pipeline/stage reorder) issue a single insert instead of one per row.
export async function logEntityEvents(
  tx: Tx,
  events: EntityEventInput[],
  ctx: ChangeContext,
): Promise<void> {
  if (!events.length) return;
  await insertChangeEvents(
    tx,
    events.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      fieldKey: e.fieldKey,
      oldValue: e.oldValue,
      newValue: e.newValue,
      changedBy: ctx.changedBy,
      ...(ctx.changedAt ? { changedAt: ctx.changedAt } : {}),
      source: ctx.source ?? "ui",
    })),
  );
}

/** One audit event for a pipeline/stage (e.g. a `created`/`deleted` marker). */
export async function logEntityEvent(
  tx: Tx,
  entityType: ConfigEntityType,
  entityId: number,
  fieldKey: string,
  oldValue: ChangeValueSnapshot | null,
  newValue: ChangeValueSnapshot | null,
  ctx: ChangeContext,
): Promise<void> {
  await logEntityEvents(tx, [{ entityType, entityId, fieldKey, oldValue, newValue }], ctx);
}

/** Log one event per actually-changed field across a pipeline/stage edit. */
export async function logEntityChanges(
  tx: Tx,
  entityType: ConfigEntityType,
  entityId: number,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  fields: EntityFieldSpec[],
  ctx: ChangeContext,
): Promise<void> {
  const rows: ChangeEventInsert[] = [];
  for (const f of fields) {
    if (!(f.key in patch)) continue;
    const oldRaw = before[f.key];
    const newRaw = patch[f.key];
    if (valuesEqual(oldRaw, newRaw)) continue;
    rows.push({
      entityType,
      entityId,
      fieldKey: f.fieldKey,
      oldValue: configSnapshot(oldRaw),
      newValue: configSnapshot(newRaw),
      changedBy: ctx.changedBy,
      ...(ctx.changedAt ? { changedAt: ctx.changedAt } : {}),
      source: ctx.source ?? "ui",
    });
  }
  await insertChangeEvents(tx, rows);
}

export interface DealChange {
  before: Deal;
  patch: Record<string, unknown>;
}

// Generic entity+field change: the same before/patch diffing and
// ref-label resolution logDealChanges already did, generalized to any entity
// type/tracked-field list. logDealChanges (below) is a thin wrapper over this
// so every existing caller (deals.ts, admin-pipelines.ts, deal-fields.ts) is
// unaffected. Log one event per ACTUAL change; fields unchanged (or absent
// from the patch) produce no event.
export interface FieldChange<T> {
  entityId: number;
  before: T;
  patch: Record<string, unknown>;
}

export async function logFieldChanges<T extends Record<string, unknown>>(
  tx: Tx,
  entityType: ChangeEventInsert["entityType"],
  changes: FieldChange<T>[],
  trackedFields: readonly TrackedField<T>[],
  ctx: ChangeContext,
): Promise<void> {
  const ids = emptyRefIds();

  interface Pending {
    entityId: number;
    field: TrackedField<T>;
    oldRaw: unknown;
    newRaw: unknown;
  }
  const pending: Pending[] = [];

  for (const { entityId, before, patch } of changes) {
    for (const field of trackedFields) {
      if (!(field.key in patch)) continue;
      const newRaw = patch[field.key as string];
      const oldRaw = before[field.key];
      if (valuesEqual(oldRaw, newRaw)) continue;
      collectRefId(field as TrackedField<Record<string, unknown>>, oldRaw, ids);
      collectRefId(field as TrackedField<Record<string, unknown>>, newRaw, ids);
      pending.push({ entityId, field, oldRaw, newRaw });
    }
  }

  if (!pending.length) return;
  const labels = await resolveLabels(tx, ids);

  const rows: ChangeEventInsert[] = pending.map((p) => ({
    entityType,
    entityId: p.entityId,
    fieldKey: p.field.fieldKey,
    oldValue: snapshot(p.field as TrackedField<Record<string, unknown>>, p.oldRaw, labels),
    newValue: snapshot(p.field as TrackedField<Record<string, unknown>>, p.newRaw, labels),
    changedBy: ctx.changedBy,
    ...(ctx.changedAt ? { changedAt: ctx.changedAt } : {}),
    source: ctx.source ?? "ui",
  }));

  await insertChangeEvents(tx, rows);
}

// Log one event per ACTUAL change across a batch of deal edits. Unchanged
// external signature/behavior — now a thin wrapper over logFieldChanges so
// every existing deal-side call site needs no changes.
export async function logDealChanges(
  tx: Tx,
  changes: DealChange[],
  ctx: ChangeContext,
): Promise<void> {
  await logFieldChanges(
    tx,
    "deal",
    changes.map(({ before, patch }) => ({
      entityId: before.id,
      before: before as unknown as Record<string, unknown>,
      patch,
    })),
    TRACKED_DEAL_FIELDS as readonly TrackedField<Record<string, unknown>>[],
    ctx,
  );
}

// Record a deal's creation: a `created` marker plus an initial `stage_id` entry
// so the stage timeline, time-in-stage, and funnel are complete from birth.
export async function logDealCreated(
  tx: Tx,
  deal: Deal,
  ctx: ChangeContext,
): Promise<void> {
  const ids = emptyRefIds();
  ids.stage.add(deal.stageId);
  const labels = await resolveLabels(tx, ids);
  const at = ctx.changedAt ?? deal.addTime ?? undefined;
  const common = {
    entityType: "deal" as const,
    entityId: deal.id,
    changedBy: ctx.changedBy,
    source: ctx.source ?? "ui",
    ...(at ? { changedAt: at } : {}),
  };
  const rows: ChangeEventInsert[] = [
    {
      ...common,
      fieldKey: "created",
      oldValue: null,
      newValue: { id: deal.id, label: deal.title },
    },
    {
      ...common,
      fieldKey: "stage_id",
      oldValue: null,
      newValue: { id: deal.stageId, label: labels.stage.get(deal.stageId) ?? null },
    },
  ];
  await insertChangeEvents(tx, rows);
}
