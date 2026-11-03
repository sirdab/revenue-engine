import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  assignmentRulesTable,
  teamsTable,
  usersTable,
  type AssignmentTriggerEvent,
} from "@workspace/db";
import {
  filterGroupSchema,
  maxDepth,
  countConditions,
  evaluate,
  type FilterGroup,
  type DealFacts,
} from "@workspace/deals-filter";
import { type Tx } from "./change-events";

// Assignment-rules service — admin CRUD + priority reorder for the
// auto-assignment engine. Routes stay thin; all DB work and
// validation live here (mirrors the labels/teams service split).
//
// conditions is stored as a typed jsonb FilterGroup. It is re-validated here
// with the shared `filterGroupSchema` (the generated request zod only checks a
// loose shape), enforcing the real field/operator vocabulary plus a shared
// depth/count limit consistent with the SQL list-filter compiler.

// One shared structural limit for rule conditions, matching compileDealFilters
// (queries.ts). The client builder caps depth at 3, well under these.
const MAX_CONDITION_DEPTH = 5;
const MAX_CONDITION_COUNT = 100;

export class AssignmentRuleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// The admin-facing projection: the rule plus the resolved team/assignee display
// names (joins), so the panel renders without extra client fetches.
export interface AssignmentRuleView {
  id: number;
  name: string;
  triggerEvent: AssignmentTriggerEvent;
  conditions: FilterGroup;
  targetTeamId: number | null;
  targetTeamName: string | null;
  targetAssigneeId: number | null;
  targetAssigneeName: string | null;
  takeoverOwned: boolean;
  priority: number;
  active: boolean;
}

export interface AssignmentRuleInput {
  name: string;
  triggerEvent: AssignmentTriggerEvent;
  conditions: unknown;
  targetTeamId: number;
  targetAssigneeId?: number | null;
  takeoverOwned?: boolean;
}

export interface AssignmentRuleUpdate {
  name?: string;
  triggerEvent?: AssignmentTriggerEvent;
  conditions?: unknown;
  targetTeamId?: number;
  targetAssigneeId?: number | null;
  takeoverOwned?: boolean;
  active?: boolean;
}

// Some helpers run against a transaction, others the base client.
type Db = typeof db | Tx;

const ruleColumns = {
  id: assignmentRulesTable.id,
  name: assignmentRulesTable.name,
  triggerEvent: assignmentRulesTable.triggerEvent,
  conditions: assignmentRulesTable.conditions,
  targetTeamId: assignmentRulesTable.targetTeamId,
  targetTeamName: teamsTable.name,
  targetAssigneeId: assignmentRulesTable.targetAssigneeId,
  targetAssigneeName: usersTable.name,
  takeoverOwned: assignmentRulesTable.takeoverOwned,
  priority: assignmentRulesTable.priority,
  active: assignmentRulesTable.active,
};

function ruleQuery(dbc: Db) {
  return dbc
    .select(ruleColumns)
    .from(assignmentRulesTable)
    .leftJoin(teamsTable, eq(assignmentRulesTable.targetTeamId, teamsTable.id))
    .leftJoin(
      usersTable,
      eq(assignmentRulesTable.targetAssigneeId, usersTable.id),
    );
}

async function getRuleById(dbc: Db, id: number): Promise<AssignmentRuleView> {
  const [row] = await ruleQuery(dbc).where(eq(assignmentRulesTable.id, id));
  if (!row) throw new AssignmentRuleError(404, "Rule not found.");
  return row;
}

// All-null facts, used only to dry-run the evaluator at write time (below).
const EMPTY_DEAL_FACTS: DealFacts = {
  title: null,
  organizationName: null,
  value: null,
  pipelineId: null,
  stageId: null,
  ownerId: null,
  createdDate: null,
  wonTime: null,
  status: null,
  utmKeyword: null,
  lostReason: null,
};

/** Validate + normalize the conditions tree (field/operator vocabulary + limits). */
function validateConditions(raw: unknown): FilterGroup {
  const parsed = filterGroupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AssignmentRuleError(400, "Invalid conditions.");
  }
  const group = parsed.data;
  if (maxDepth(group) > MAX_CONDITION_DEPTH) {
    throw new AssignmentRuleError(400, "Conditions are nested too deeply.");
  }
  if (countConditions(group) > MAX_CONDITION_COUNT) {
    throw new AssignmentRuleError(400, "Too many conditions.");
  }
  // filterGroupSchema only checks the tree's SHAPE — it accepts an operator that
  // is invalid for its field, or a missing/blank value for a value-taking
  // operator (e.g. a wizard condition left unfilled). Those slip through here
  // but throw inside the evaluator at deal-write time. Dry-run the evaluator
  // (which is the runtime source of truth) against empty facts so an
  // un-evaluable rule is rejected at 400 now rather than 500-ing every future
  // deal write that reaches it.
  try {
    evaluate(group, EMPTY_DEAL_FACTS);
  } catch {
    throw new AssignmentRuleError(
      400,
      "A condition is missing a value or uses an operator that isn't valid for its field.",
    );
  }
  return group;
}

/** The target team must exist; a fixed assignee (if any) must be in that team. */
async function validateTarget(
  dbc: Db,
  teamId: number,
  assigneeId: number | null,
): Promise<void> {
  const [team] = await dbc
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  if (!team) throw new AssignmentRuleError(400, "Target team not found.");

  if (assigneeId != null) {
    const [member] = await dbc
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, assigneeId), eq(usersTable.teamId, teamId)));
    if (!member) {
      throw new AssignmentRuleError(
        400,
        "Assignee must be a member of the target team.",
      );
    }
  }
}

/** Next priority slot within a trigger event (append to the end of that list). */
async function nextPriority(
  dbc: Db,
  triggerEvent: AssignmentTriggerEvent,
): Promise<number> {
  const { rows } = await dbc.execute<{ next: number }>(
    sql`select coalesce(max(priority), -1) + 1 as next from ${assignmentRulesTable} where trigger_event = ${triggerEvent}`,
  );
  return Number(rows[0]?.next ?? 0);
}

/** Every rule (both events) with resolved names, ordered by event then priority. */
export async function adminListAssignmentRules(): Promise<AssignmentRuleView[]> {
  return ruleQuery(db).orderBy(
    asc(assignmentRulesTable.triggerEvent),
    asc(assignmentRulesTable.priority),
  );
}

export async function createAssignmentRule(
  input: AssignmentRuleInput,
): Promise<AssignmentRuleView> {
  const name = input.name.trim();
  if (!name) throw new AssignmentRuleError(400, "Rule name cannot be empty.");
  const conditions = validateConditions(input.conditions);
  const assigneeId = input.targetAssigneeId ?? null;

  return db.transaction(async (tx) => {
    await validateTarget(tx, input.targetTeamId, assigneeId);
    const priority = await nextPriority(tx, input.triggerEvent);
    const [created] = await tx
      .insert(assignmentRulesTable)
      .values({
        name,
        triggerEvent: input.triggerEvent,
        conditions,
        targetTeamId: input.targetTeamId,
        targetAssigneeId: assigneeId,
        takeoverOwned: input.takeoverOwned ?? false,
        priority,
      })
      .returning({ id: assignmentRulesTable.id });
    return getRuleById(tx, created.id);
  });
}

export async function updateAssignmentRule(
  id: number,
  patch: AssignmentRuleUpdate,
): Promise<AssignmentRuleView> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(assignmentRulesTable)
      .where(eq(assignmentRulesTable.id, id));
    if (!existing) throw new AssignmentRuleError(404, "Rule not found.");

    const set: Partial<typeof assignmentRulesTable.$inferInsert> = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new AssignmentRuleError(400, "Rule name cannot be empty.");
      set.name = name;
    }
    if (patch.conditions !== undefined) {
      set.conditions = validateConditions(patch.conditions);
    }
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.takeoverOwned !== undefined) {
      set.takeoverOwned = patch.takeoverOwned;
    }

    // Validate the effective target whenever team or assignee changes.
    if (patch.targetTeamId !== undefined || patch.targetAssigneeId !== undefined) {
      const effTeam =
        patch.targetTeamId !== undefined
          ? patch.targetTeamId
          : existing.targetTeamId;
      const effAssignee =
        patch.targetAssigneeId !== undefined
          ? patch.targetAssigneeId
          : existing.targetAssigneeId;
      if (effTeam == null) {
        throw new AssignmentRuleError(400, "Target team is required.");
      }
      await validateTarget(tx, effTeam, effAssignee);
      if (patch.targetTeamId !== undefined) set.targetTeamId = patch.targetTeamId;
      if (patch.targetAssigneeId !== undefined) {
        set.targetAssigneeId = patch.targetAssigneeId;
      }
    }

    // Moving to a different trigger event re-homes the rule at the end of that
    // event's priority list (priority is per-event).
    if (
      patch.triggerEvent !== undefined &&
      patch.triggerEvent !== existing.triggerEvent
    ) {
      set.triggerEvent = patch.triggerEvent;
      set.priority = await nextPriority(tx, patch.triggerEvent);
    }

    if (Object.keys(set).length > 0) {
      await tx
        .update(assignmentRulesTable)
        .set(set)
        .where(eq(assignmentRulesTable.id, id));
    }
    return getRuleById(tx, id);
  });
}

export async function deleteAssignmentRule(id: number): Promise<void> {
  const [deleted] = await db
    .delete(assignmentRulesTable)
    .where(eq(assignmentRulesTable.id, id))
    .returning({ id: assignmentRulesTable.id });
  if (!deleted) throw new AssignmentRuleError(404, "Rule not found.");
}

/**
 * Reassign priority within one trigger event from an ordered id list (index
 * becomes the new priority). Ids not belonging to that event are ignored, so a
 * stale/foreign id can't disturb the other event's ordering.
 */
export async function reorderAssignmentRules(
  triggerEvent: AssignmentTriggerEvent,
  orderedIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(assignmentRulesTable)
        .set({ priority: i })
        .where(
          and(
            eq(assignmentRulesTable.id, orderedIds[i]),
            eq(assignmentRulesTable.triggerEvent, triggerEvent),
          ),
        );
    }
  });
}
