import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  labelsTable,
  dealsTable,
  personsTable,
  organizationsTable,
  LABEL_COLORS,
  type Label,
  type LabelEntity,
} from "@workspace/db";
import {
  logEntityEvents,
  type Tx,
  type ChangeContext,
  type EntityEventInput,
} from "./change-events";

// Label registry service.
//
// Label VALUES are denormalized text[] on deals / persons / organizations; the
// registry (labels table) holds each label's canonical spelling, color, and
// order. Everything here preserves one invariant: a registry mutation that
// changes a name (rename, merge, delete) rewrites the denormalized arrays in
// the same transaction, so the registry and the data never disagree. All name
// matching is case-insensitive; rewrites canonicalize stray casings as a side
// effect.

export const DEFAULT_LABEL_COLOR = "teal";
// Color for labels that exist on records but were never registered.
export const UNREGISTERED_COLOR = "slate";

export class LabelError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// The three tables carrying a `labels text[]` column. The column is named
// identically everywhere, which the raw rewrite SQL below relies on.
const ENTITY_TABLES = {
  deal: dealsTable,
  person: personsTable,
  organization: organizationsTable,
} as const;

export interface LabelWithUsage extends Label {
  usageCount: number;
}
export interface UnregisteredLabel {
  name: string;
  usageCount: number;
}

function normalizeColor(color: string | undefined | null): string {
  return color && (LABEL_COLORS as readonly string[]).includes(color)
    ? color
    : DEFAULT_LABEL_COLOR;
}

// One pass over an entity's label arrays: how often each distinct label is
// used, keyed case-insensitively, keeping the first spelling seen for display.
async function usageByName(
  entity: LabelEntity,
): Promise<Map<string, UnregisteredLabel>> {
  const table = ENTITY_TABLES[entity];
  const result = await db.execute<{ name: string; count: number }>(sql`
    select min(x) as name, count(*)::int as count
    from ${table}, unnest(${table.labels}) as x
    group by lower(x)
  `);
  const map = new Map<string, UnregisteredLabel>();
  for (const row of result.rows) {
    map.set(row.name.toLowerCase(), {
      name: row.name,
      usageCount: Number(row.count),
    });
  }
  return map;
}

async function registryRows(entity: LabelEntity): Promise<Label[]> {
  return db
    .select()
    .from(labelsTable)
    .where(eq(labelsTable.entity, entity))
    .orderBy(asc(labelsTable.orderIndex), asc(sql`lower(${labelsTable.name})`));
}

/** Registered labels with usage counts + in-use labels missing from the registry. */
export async function adminListLabels(entity: LabelEntity): Promise<{
  labels: LabelWithUsage[];
  unregistered: UnregisteredLabel[];
}> {
  const [rows, usage] = await Promise.all([
    registryRows(entity),
    usageByName(entity),
  ]);
  const registered = new Set(rows.map((r) => r.name.toLowerCase()));
  const labels = rows.map((r) => ({
    ...r,
    usageCount: usage.get(r.name.toLowerCase())?.usageCount ?? 0,
  }));
  const unregistered = [...usage.values()]
    .filter((u) => !registered.has(u.name.toLowerCase()))
    .sort(
      (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name),
    );
  return { labels, unregistered };
}

/** Every label a picker should offer: the registry plus unregistered in-use ones. */
export async function listLabelOptions(
  entity: LabelEntity,
): Promise<Array<{ id: number | null; name: string; color: string }>> {
  const { labels, unregistered } = await adminListLabels(entity);
  return [
    ...labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    ...unregistered.map((u) => ({
      id: null,
      name: u.name,
      color: UNREGISTERED_COLOR,
    })),
  ];
}

export async function createLabel(
  entity: LabelEntity,
  name: string,
  color?: string,
): Promise<LabelWithUsage> {
  const trimmed = name.trim();
  if (!trimmed) throw new LabelError(400, "Label name cannot be empty.");
  const [dupe] = await db
    .select({ id: labelsTable.id })
    .from(labelsTable)
    .where(
      and(
        eq(labelsTable.entity, entity),
        sql`lower(${labelsTable.name}) = lower(${trimmed})`,
      ),
    );
  if (dupe) {
    throw new LabelError(409, `The label “${trimmed}” already exists.`);
  }
  const [{ next }] = (
    await db.execute<{ next: number }>(sql`
      select coalesce(max(order_index), 0) + 1 as next
      from ${labelsTable} where ${labelsTable.entity} = ${entity}
    `)
  ).rows;
  const [created] = await db
    .insert(labelsTable)
    .values({
      entity,
      name: trimmed,
      color: normalizeColor(color),
      orderIndex: Number(next),
    })
    .returning();
  const usage = await usageByName(entity);
  return {
    ...created,
    usageCount: usage.get(trimmed.toLowerCase())?.usageCount ?? 0,
  };
}

interface RewriteRow {
  id: number;
  before: string[] | null;
  after: string[] | null;
}

// Log one change_events row per entity actually rewritten by a label registry
// action (fieldKey "labels"), plus one top-level "label" marker event on the
// registry row itself — inside the caller's transaction.
async function logLabelFanout(
  tx: Tx,
  entity: LabelEntity,
  rows: RewriteRow[],
  labelId: number,
  markerFieldKey: "renamed" | "deleted",
  markerLabel: string,
  ctx: ChangeContext,
): Promise<void> {
  const events: EntityEventInput[] = rows.map((r) => ({
    entityType: entity,
    entityId: r.id,
    fieldKey: "labels",
    oldValue: r.before?.length ? { label: r.before.join(", ") } : null,
    newValue: r.after?.length ? { label: r.after.join(", ") } : null,
  }));
  events.push({
    entityType: "label",
    entityId: labelId,
    fieldKey: markerFieldKey,
    oldValue: null,
    newValue: { id: labelId, label: markerLabel },
  });
  await logEntityEvents(tx, events, ctx);
}

// Rewrite every occurrence of `from` (case-insensitive) to `to` in an entity's
// label arrays, deduping in case both spellings coexisted on one record.
// Returns the touched rows' before/after label arrays (the caller uses
// this to log one change_events row per affected entity). The
// unqualified `labels` in SET is safe because every entity table names the
// column identically.
async function rewriteLabel(
  tx: Tx,
  entity: LabelEntity,
  from: string,
  to: string,
): Promise<RewriteRow[]> {
  const table = ENTITY_TABLES[entity];
  // Locks exactly the rows the UPDATE below will touch, in the same order
  // Postgres would lock them for that UPDATE, so the "before" snapshot can't
  // go stale from a concurrent write landing between these two statements.
  const before = await tx.execute<{ id: number; labels: string[] | null }>(sql`
    select id, labels from ${table}
    where exists (
      select 1 from unnest(${table.labels}) as x where lower(x) = lower(${from})
    )
    for update
  `);
  const beforeById = new Map(before.rows.map((r) => [r.id, r.labels]));
  const after = await tx.execute<{ id: number; labels: string[] | null }>(sql`
    update ${table}
    set labels = (
      select array_agg(distinct case when lower(x) = lower(${from}) then ${to} else x end)
      from unnest(${table.labels}) as x
    )
    where exists (
      select 1 from unnest(${table.labels}) as x where lower(x) = lower(${from})
    )
    returning id, labels
  `);
  return after.rows.map((r) => ({
    id: r.id,
    before: beforeById.get(r.id) ?? null,
    after: r.labels,
  }));
}

/**
 * Rename and/or recolor a label. Renaming rewrites the label on every record.
 * Renaming onto another registered label's name merges into it: records are
 * rewritten to the survivor and this row is deleted. Returns the survivor.
 */
export async function updateLabel(
  id: number,
  patch: { name?: string; color?: string; orderIndex?: number },
  ctx: ChangeContext,
): Promise<LabelWithUsage> {
  const survivor = await db.transaction(async (tx) => {
    const [label] = await tx
      .select()
      .from(labelsTable)
      .where(eq(labelsTable.id, id));
    if (!label) throw new LabelError(404, "Label not found.");

    const nextName = patch.name?.trim();
    if (nextName !== undefined && nextName === "") {
      throw new LabelError(400, "Label name cannot be empty.");
    }

    if (nextName && nextName !== label.name) {
      const [existing] = await tx
        .select()
        .from(labelsTable)
        .where(
          and(
            eq(labelsTable.entity, label.entity),
            sql`lower(${labelsTable.name}) = lower(${nextName})`,
          ),
        );
      if (existing && existing.id !== label.id) {
        // Merge: fold this label's records into the existing one.
        const touched = await rewriteLabel(tx, label.entity, label.name, existing.name);
        await tx.delete(labelsTable).where(eq(labelsTable.id, label.id));
        await logLabelFanout(
          tx,
          label.entity,
          touched,
          label.id,
          "renamed",
          `${label.name} → ${existing.name} (merged)`,
          ctx,
        );
        return existing;
      }
      const touched = await rewriteLabel(tx, label.entity, label.name, nextName);
      await logLabelFanout(
        tx,
        label.entity,
        touched,
        label.id,
        "renamed",
        `${label.name} → ${nextName}`,
        ctx,
      );
    }

    const [updated] = await tx
      .update(labelsTable)
      .set({
        ...(nextName ? { name: nextName } : {}),
        ...(patch.color ? { color: normalizeColor(patch.color) } : {}),
        ...(patch.orderIndex !== undefined
          ? { orderIndex: patch.orderIndex }
          : {}),
      })
      .where(eq(labelsTable.id, label.id))
      .returning();
    return updated;
  });

  const usage = await usageByName(survivor.entity);
  return {
    ...survivor,
    usageCount: usage.get(survivor.name.toLowerCase())?.usageCount ?? 0,
  };
}

/** Delete a label and strip it from every record. Returns records touched. */
export async function deleteLabel(
  id: number,
  ctx: ChangeContext,
): Promise<{ removedFrom: number }> {
  return db.transaction(async (tx) => {
    const [label] = await tx
      .select()
      .from(labelsTable)
      .where(eq(labelsTable.id, id));
    if (!label) throw new LabelError(404, "Label not found.");

    const table = ENTITY_TABLES[label.entity];
    // Same locking rationale as rewriteLabel: pins the "before" snapshot
    // against a concurrent write to one of these rows' labels column.
    const before = await tx.execute<{ id: number; labels: string[] | null }>(sql`
      select id, labels from ${table}
      where exists (
        select 1 from unnest(${table.labels}) as x where lower(x) = lower(${label.name})
      )
      for update
    `);
    const beforeById = new Map(before.rows.map((r) => [r.id, r.labels]));
    // array(...) preserves the remaining order; an emptied array becomes NULL.
    const result = await tx.execute<{ id: number; labels: string[] | null }>(sql`
      update ${table}
      set labels = nullif(
        array(select x from unnest(${table.labels}) as x where lower(x) <> lower(${label.name})),
        '{}'
      )
      where exists (
        select 1 from unnest(${table.labels}) as x where lower(x) = lower(${label.name})
      )
      returning id, labels
    `);
    await tx.delete(labelsTable).where(eq(labelsTable.id, label.id));
    const touched: RewriteRow[] = result.rows.map((r) => ({
      id: r.id,
      before: beforeById.get(r.id) ?? null,
      after: r.labels,
    }));
    await logLabelFanout(tx, label.entity, touched, label.id, "deleted", label.name, ctx);
    return { removedFrom: result.rows.length };
  });
}
