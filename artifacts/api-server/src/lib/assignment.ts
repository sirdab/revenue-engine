import { and, asc, eq } from "drizzle-orm";
import {
  db,
  assignmentRulesTable,
  organizationsTable,
  usersTable,
  type AssignmentTriggerEvent,
  type Deal,
} from "@workspace/db";
import {
  evaluate,
  type DealFacts,
} from "@workspace/deals-filter";
import { logDealChanges, type Tx } from "./change-events";
import { logger } from "./logger";
import { currentTimeZone } from "./regional-context";

// Auto-assignment engine. Given a trigger event and a deal, resolve
// the owner from the active rules: evaluate rules in priority order and take the
// first that both matches and yields an assignable owner. Runs INLINE inside the
// caller's transaction (there is no job queue), so ownership and its audit row
// commit atomically with the deal write.
//
// - specific assignee target  -> that user
// - team-only target          -> round-robin = least-loaded active team member
// - no rule matches / no owner -> null (caller keeps the default/existing owner)

// The deal fields the engine reads. The caller passes a draft (create) or the
// effective post-update deal (update); FK values are resolved here into facts.
export interface DealForAssignment {
  title: string | null;
  organizationId: number | null;
  value: number | null;
  pipelineId: number | null;
  stageId: number | null;
  ownerId: number | null;
  createdDate: Date | null;
  wonTime: Date | null;
  status: string | null;
  utmKeyword: string | null;
  lostReason: string | null;
  /** The deal's custom_fields jsonb. */
  customFields: unknown;
}

// The engine reads within the caller's locked context when given a tx, but a few
// helpers also work off the base client.
export type Db = typeof db | Tx;

export async function buildFacts(
  dbc: Db,
  deal: DealForAssignment,
): Promise<DealFacts> {
  let organizationName: string | null = null;
  if (deal.organizationId != null) {
    const [org] = await dbc
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, deal.organizationId));
    organizationName = org?.name ?? null;
  }
  return {
    title: deal.title,
    organizationName,
    value: deal.value,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    ownerId: deal.ownerId,
    createdDate: deal.createdDate,
    wonTime: deal.wonTime,
    status: deal.status,
    utmKeyword: deal.utmKeyword,
    lostReason: deal.lostReason,
  };
}

/**
 * Pure rotation step: given a team's active member ids (any order) and the
 * cursor's last pick, returns the next id cyclically by ascending id. A
 * cursor that's null, or that no longer matches an active member (left the
 * team, deactivated), restarts the rotation from the lowest id. `memberIds`
 * must be non-empty — callers check that first, since "no active members"
 * and "restart the rotation" are different outcomes.
 */
export function nextInRotation(
  memberIds: number[],
  lastAssignedUserId: number | null,
): number {
  const sorted = [...memberIds].sort((a, b) => a - b);
  const lastIdx =
    lastAssignedUserId == null ? -1 : sorted.indexOf(lastAssignedUserId);
  return sorted[(lastIdx + 1) % sorted.length];
}

/**
 * Round-robins `ruleId`'s target team: picks the next active member after
 * `rule.lastAssignedUserId` via `nextInRotation` and persists that pick as
 * the new cursor. Returns null when the team has no active members.
 *
 * Deliberately NOT "whoever currently has the fewest open deals":
 * a live least-loaded computation is starved by a rule with takeoverOwned —
 * a member whose deals keep getting reassigned away downstream (e.g. a
 * manual handoff after a stage-based takeover) never accumulates load, so
 * the same "least loaded" member gets re-picked every time regardless of
 * whose turn it actually is. A persisted rotation has no such blind spot: it
 * advances on every pick and doesn't care what happens to the deal after.
 *
 * Locks the rule row (`for update`) for the duration of the pick-and-advance
 * so two concurrent assignments against the same rule can't both read the
 * same cursor and pick the same "next" member.
 */
export async function nextRoundRobinMember(
  dbc: Db,
  ruleId: number,
  teamId: number,
): Promise<number | null> {
  const [rule] = await dbc
    .select({ lastAssignedUserId: assignmentRulesTable.lastAssignedUserId })
    .from(assignmentRulesTable)
    .where(eq(assignmentRulesTable.id, ruleId))
    .for("update");

  const members = await dbc
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.teamId, teamId), eq(usersTable.activeFlag, true)));
  if (members.length === 0) return null;

  const next = nextInRotation(
    members.map((m) => m.id),
    rule?.lastAssignedUserId ?? null,
  );

  await dbc
    .update(assignmentRulesTable)
    .set({ lastAssignedUserId: next })
    .where(eq(assignmentRulesTable.id, ruleId));

  return next;
}

/** Is this user present and still active (not deactivated)? */
export async function isActiveUser(dbc: Db, userId: number): Promise<boolean> {
  const [row] = await dbc
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.activeFlag, true)));
  return row != null;
}

/**
 * Resolve the owner for `deal` under `event` from the active rules. Returns the
 * owner id of the first rule that matches and resolves to an assignable user, or
 * null when nothing matches (caller keeps the default/existing owner). Never
 * throws on "no match".
 */
export async function resolveAutoAssignment(
  dbc: Db,
  event: AssignmentTriggerEvent,
  deal: DealForAssignment,
  opts: { dealOwned?: boolean } = {},
): Promise<number | null> {
  const rules = await dbc
    .select({
      id: assignmentRulesTable.id,
      conditions: assignmentRulesTable.conditions,
      targetTeamId: assignmentRulesTable.targetTeamId,
      targetAssigneeId: assignmentRulesTable.targetAssigneeId,
      takeoverOwned: assignmentRulesTable.takeoverOwned,
    })
    .from(assignmentRulesTable)
    .where(
      and(
        eq(assignmentRulesTable.triggerEvent, event),
        eq(assignmentRulesTable.active, true),
      ),
    )
    .orderBy(asc(assignmentRulesTable.priority), asc(assignmentRulesTable.id));

  if (rules.length === 0) return null;

  const facts = await buildFacts(dbc, deal);

  for (const rule of rules) {
    // An owned deal may only be re-routed by a rule that explicitly opted in
    // ("may take over owned deals", e.g. a handover between teams). All other
    // rules keep the original never-overwrite behavior.
    if (opts.dealOwned && !rule.takeoverOwned) continue;
    // The evaluator throws on an un-evaluable condition (a value-less operator,
    // a field/operator mismatch). Rules are validated at write time, but a
    // pre-existing bad row or future vocabulary drift must never abort the deal
    // write this runs inside — treat a throwing rule as a non-match and log it.
    let matches: boolean;
    try {
      matches = evaluate(rule.conditions, facts, { timeZone: currentTimeZone() });
    } catch (err) {
      logger.error(
        { err, event },
        "assignment rule failed to evaluate; skipping",
      );
      continue;
    }
    if (!matches) continue;

    // Fixed assignee wins outright — but only if still active; a deactivated
    // assignee falls back to the team's round-robin (mirrors the active filter
    // the round-robin path already applies), then to the next rule.
    if (rule.targetAssigneeId != null) {
      if (await isActiveUser(dbc, rule.targetAssigneeId)) {
        return rule.targetAssigneeId;
      }
    }
    // Team target → round-robin. If the team has no active member to receive the
    // deal, fall through to the next matching rule rather than stranding it.
    if (rule.targetTeamId != null) {
      const owner = await nextRoundRobinMember(dbc, rule.id, rule.targetTeamId);
      if (owner != null) return owner;
    }
  }
  return null;
}

/**
 * Audit an engine-driven owner assignment as its own owner_id change_events row
 * — actor-less and attributed to the "automation" source, kept separate from any
 * user edit in the same request so the two never conflate. `before` carries the
 * pre-assignment owner (the diff's old value).
 */
export async function auditAutoAssignedOwner(
  tx: Tx,
  before: Deal,
  newOwnerId: number,
  changedAt: Date,
): Promise<void> {
  await logDealChanges(
    tx,
    [{ before, patch: { ownerId: newOwnerId } }],
    { changedBy: null, source: "automation", changedAt },
  );
}
