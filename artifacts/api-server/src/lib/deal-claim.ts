import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { activitiesTable, dealsTable, notesTable } from "@workspace/db";
import { logDealChanges, type Tx } from "./change-events";

// First to act claims the deal. Deals always arrive with an owner (the inbound
// default owner, an assignment rule's pick, or the creator), but that owner is
// often a placeholder nobody is working. So the first PERSON to log an activity
// on a deal nobody has touched becomes its owner, instead of having to reassign
// it to themselves by hand.
//
// "Nobody has touched it" means no person has logged a (posted) activity or a
// (posted) note on it. Automation-created activities have no creator and do not
// count; Pipedrive-imported ones carry a pipedrive_id and DO count, since a
// person wrote them there. Only logging an activity claims — a note marks the
// deal as touched but does not move it.

export interface ClaimableDeal {
  ownerId: number | null;
  archived: boolean;
}

/** Pure decision, exported for tests. */
export function shouldClaimDeal(
  deal: ClaimableDeal,
  actorId: number,
  touchedByAPerson: boolean,
): boolean {
  if (deal.archived) return false;
  if (deal.ownerId === actorId) return false;
  return !touchedByAPerson;
}

/**
 * Hand the deal to `actorId` when this activity is the first anything a person
 * has logged on it. Call inside the transaction that posts the activity, and
 * BEFORE inserting it: the deal row is locked first, so two people logging the
 * first activity at once serialize here and the second sees the first's
 * activity (inserting first would take a key-share lock on the deal through
 * the foreign key, and two of those upgrading to FOR UPDATE deadlock).
 *
 * `postingActivityId` is the draft being published, excluded from the check.
 * Returns whether the deal changed hands.
 */
export async function claimUntouchedDeal(
  tx: Tx,
  dealId: number,
  actorId: number,
  postingActivityId: number | null = null,
): Promise<boolean> {
  const [deal] = await tx
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.id, dealId))
    .for("update");
  if (!deal) return false;

  const [activity] = await tx
    .select({ one: sql`1` })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.dealId, dealId),
        eq(activitiesTable.draft, false),
        or(
          isNotNull(activitiesTable.creatorUserId),
          isNotNull(activitiesTable.pipedriveId),
        ),
        postingActivityId != null
          ? ne(activitiesTable.id, postingActivityId)
          : undefined,
      ),
    )
    .limit(1);
  const [note] = activity
    ? [undefined]
    : await tx
        .select({ one: sql`1` })
        .from(notesTable)
        .where(
          and(
            eq(notesTable.dealId, dealId),
            eq(notesTable.draft, false),
            or(isNotNull(notesTable.userId), isNotNull(notesTable.pipedriveId)),
          ),
        )
        .limit(1);

  if (!shouldClaimDeal(deal, actorId, Boolean(activity ?? note))) return false;

  await tx
    .update(dealsTable)
    .set({ ownerId: actorId })
    .where(eq(dealsTable.id, dealId));
  // Recorded as the actor's change, flagged automation: they didn't pick the
  // owner field themselves, the first-to-act rule did on their behalf.
  await logDealChanges(tx, [{ before: deal, patch: { ownerId: actorId } }], {
    changedBy: actorId,
    source: "automation",
  });
  return true;
}
