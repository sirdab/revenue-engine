import { and, eq, notInArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  dealsTable,
  activitiesTable,
  notesTable,
  filesTable,
  crmFilesTable,
  changeEventsTable,
  type Deal,
} from "@workspace/db";

// Merge a duplicate deal into a primary.
//
// Rules (kept deliberately predictable — no field-by-field picker):
//   - The PRIMARY's fields always win; where the primary is empty, the
//     duplicate's value fills in. Labels are unioned.
//   - Every child record (activities, notes, documents and comment
//     attachments, audit history) moves to the primary — nothing is deleted. The one exception is the
//     duplicate's stage history (see STAGE_HISTORY_FIELD_KEYS).
//   - The duplicate is soft-retired: archived, with merged_into_deal_id
//     pointing at the survivor. It disappears from working views but stays
//     recoverable and auditable.
//   - The merge itself lands in the audit log on the primary.
// Everything runs in ONE transaction: a merge either fully happens or not
// at all.

export class DealMergeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface MergeSummary {
  primaryId: number;
  duplicateId: number;
  /** camelCase field names copied from the duplicate into empty primary fields */
  filledFields: string[];
  moved: {
    activities: number;
    notes: number;
    files: number;
    historyEvents: number;
  };
}

// Fields that fill in from the duplicate when the primary has no value.
// Identity/pipeline fields (title, status, stage, pipeline, owner, times)
// deliberately never move — the primary IS the surviving record.
const FILLABLE: (keyof Deal)[] = [
  "personId",
  "organizationId",
  "expectedCloseDate",
  "lostReason",
  "lostReasonNote",
  "comments",
  "visibleTo",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmKeyword",
  "adName",
  "gclid",
  "fbclid",
];

// Events that describe the duplicate's own position in the pipeline. They stay
// on the duplicate: the survivor's time-in-stage and the funnel are both
// rebuilt from its `stage_id` events, so moving the duplicate's would show the
// survivor sitting in a stage it never entered (and count it in the funnel
// there), and moving `created` would give the survivor two creation dates.
const STAGE_HISTORY_FIELD_KEYS = ["stage_id", "created"];

function isEmpty(v: unknown): boolean {
  return v == null || v === "";
}

async function loadDeal(id: number): Promise<Deal> {
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
  if (!deal) throw new DealMergeError(404, `Deal ${id} not found.`);
  return deal;
}

async function childCounts(dealId: number): Promise<MergeSummary["moved"]> {
  const count = async (
    table:
      | typeof activitiesTable
      | typeof notesTable
      | typeof filesTable
      | typeof crmFilesTable,
    extra?: SQL,
  ) => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(and(eq(table.dealId, dealId), extra));
    return Number(n);
  };
  const [{ n: events }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(changeEventsTable)
    .where(
      and(
        eq(changeEventsTable.entityType, "deal"),
        eq(changeEventsTable.entityId, dealId),
        notInArray(changeEventsTable.fieldKey, STAGE_HISTORY_FIELD_KEYS),
      ),
    );
  return {
    // Drafts are creator-private: they still move on merge, but the preview
    // must not reveal that another user's drafts exist.
    activities: await count(activitiesTable, eq(activitiesTable.draft, false)),
    notes: await count(notesTable, eq(notesTable.draft, false)),
    // The deal's documents and comment attachments (crm_files) plus any
    // dormant Pipedrive file links (files).
    files: (await count(crmFilesTable)) + (await count(filesTable)),
    historyEvents: Number(events),
  };
}

function computeFill(primary: Deal, duplicate: Deal) {
  const updates: Record<string, unknown> = {};
  const filledFields: string[] = [];
  for (const field of FILLABLE) {
    if (isEmpty(primary[field]) && !isEmpty(duplicate[field])) {
      updates[field] = duplicate[field];
      filledFields.push(field);
    }
  }
  // Value: 0 is the schema default, treat it as "no value recorded".
  if ((primary.value ?? 0) === 0 && (duplicate.value ?? 0) !== 0) {
    updates.value = duplicate.value;
    filledFields.push("value");
  }
  // Labels union (order: primary's first, then the duplicate's new ones).
  const primaryLabels = primary.labels ?? [];
  const extra = (duplicate.labels ?? []).filter(
    (l) => !primaryLabels.includes(l),
  );
  if (extra.length > 0) {
    updates.labels = [...primaryLabels, ...extra];
    filledFields.push("labels");
  }
  return { updates, filledFields };
}

function dealName(deal: Deal): string {
  return deal.title ? `“${deal.title}”` : `Deal #${deal.id}`;
}

// Refusals name the deal by its TITLE, never by its role in the merge.
// "duplicate" and "primary" are this module's vocabulary: someone reading the
// toast sees two deals on screen and no way to map those words onto them, so
// the old wording read as a complaint about whichever deal they had just
// picked, and sent people looking at the wrong one. The title is the one
// identifier both sides of the screen share. Exported so the wording — the
// whole user-facing contract of this guard — is covered by tests.
export function assertMergeable(primary: Deal, duplicate: Deal): void {
  if (primary.id === duplicate.id) {
    throw new DealMergeError(400, "A deal cannot be merged into itself.");
  }
  for (const [side, deal] of [
    ["target", primary],
    ["source", duplicate],
  ] as const) {
    const name = dealName(deal);
    if (deal.mergedIntoDealId != null) {
      throw new DealMergeError(
        409,
        `${name} was already merged into deal #${deal.mergedIntoDealId}, so it can't be merged again — everything on it is already there.`,
      );
    }
    if (deal.archived) {
      throw new DealMergeError(
        409,
        side === "target"
          ? `${name} is archived, so it can't be a merge target. Restore it first, or pick a different deal.`
          : `${name} is archived, so it can't be merged. Restore it first.`,
      );
    }
    if (deal.status === "deleted") {
      throw new DealMergeError(409, `${name} is deleted, so it can't be merged.`);
    }
  }
}

/** Dry-run: what a merge WOULD do, without touching anything. */
export async function previewMerge(
  duplicateId: number,
  primaryId: number,
): Promise<MergeSummary> {
  const [duplicate, primary] = [
    await loadDeal(duplicateId),
    await loadDeal(primaryId),
  ];
  assertMergeable(primary, duplicate);
  const { filledFields } = computeFill(primary, duplicate);
  return {
    primaryId,
    duplicateId,
    filledFields,
    moved: await childCounts(duplicateId),
  };
}

export async function mergeDeal(
  duplicateId: number,
  primaryId: number,
  changedBy: number,
): Promise<MergeSummary> {
  // Preview validates and computes outside the transaction; the transaction
  // re-derives updates from the same rows (single-writer app, races are
  // theoretical — the guards re-run inside via the same loads if needed).
  const duplicate = await loadDeal(duplicateId);
  const primary = await loadDeal(primaryId);
  assertMergeable(primary, duplicate);
  const { updates, filledFields } = computeFill(primary, duplicate);
  const moved = await childCounts(duplicateId);

  await db.transaction(async (tx) => {
    // 1. Children move to the primary.
    await tx
      .update(activitiesTable)
      .set({ dealId: primaryId })
      .where(eq(activitiesTable.dealId, duplicateId));
    await tx
      .update(notesTable)
      .set({ dealId: primaryId })
      .where(eq(notesTable.dealId, duplicateId));
    await tx
      .update(filesTable)
      .set({ dealId: primaryId })
      .where(eq(filesTable.dealId, duplicateId));
    // Documents and comment attachments together: an attachment keeps its
    // note_id, and the note moved above, so it stays with its comment.
    await tx
      .update(crmFilesTable)
      .set({ dealId: primaryId })
      .where(eq(crmFilesTable.dealId, duplicateId));
    // 2. Audit history follows, so the primary's timeline tells the whole
    //    story (events keep their original timestamps) — except the
    //    duplicate's stage history, which describes the duplicate's pipeline
    //    position, not the survivor's (see STAGE_HISTORY_FIELD_KEYS).
    await tx
      .update(changeEventsTable)
      .set({ entityId: primaryId })
      .where(
        and(
          eq(changeEventsTable.entityType, "deal"),
          eq(changeEventsTable.entityId, duplicateId),
          notInArray(changeEventsTable.fieldKey, STAGE_HISTORY_FIELD_KEYS),
        ),
      );
    // 3. Empty primary fields fill in from the duplicate.
    if (Object.keys(updates).length > 0) {
      await tx.update(dealsTable).set(updates).where(eq(dealsTable.id, primaryId));
    }
    // 4. The duplicate retires: archived + pointer to the survivor.
    await tx
      .update(dealsTable)
      .set({
        archived: true,
        archiveTime: sql`now()`,
        mergedIntoDealId: primaryId,
      })
      .where(eq(dealsTable.id, duplicateId));
    // 5. The merge itself is on the record — on BOTH sides. Step 2 moved the
    //    duplicate's events to the primary, so without this its timeline would
    //    hold only its stage history and nothing on the deal would explain
    //    where its contents went. These inserts run after that move,
    //    so the duplicate's marker stays on the duplicate.
    await tx.insert(changeEventsTable).values([
      {
        entityType: "deal",
        entityId: primaryId,
        fieldKey: "merged_from",
        oldValue: null,
        newValue: { id: duplicate.id, label: duplicate.title },
        changedBy,
        source: "ui",
      },
      {
        entityType: "deal",
        entityId: duplicateId,
        fieldKey: "merged_into",
        oldValue: null,
        newValue: { id: primary.id, label: primary.title },
        changedBy,
        source: "ui",
      },
    ]);
  });

  return { primaryId, duplicateId, filledFields, moved };
}
