import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  automationsTable,
  pipelinesTable,
  stagesTable,
  activityTypeEnum,
  NOTIFICATION_PARAM_KEYS,
  type AutomationTriggerEvent,
  type AutomationActionType,
  type AutomationActionConfig,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  filterGroupSchema,
  maxDepth,
  countConditions,
  evaluate,
  type FilterGroup,
  type DealFacts,
} from "@workspace/deals-filter";
import { isActiveUser, type Db } from "./assignment";

// Automations service — admin CRUD + priority reorder for the deal-automations
// engine. Routes stay thin; all DB work and validation live here (mirrors the
// assignment-rules service).
//
// conditions and actionConfig are typed jsonb columns. The generated request
// zod only checks a loose shape, so both are re-validated strictly here:
// conditions with the shared filterGroupSchema + an evaluator dry-run, and
// actionConfig with a per-actionType schema plus live existence checks
// (pipeline / stage / user) since jsonb carries no FK constraints.

const MAX_CONDITION_DEPTH = 5;
const MAX_CONDITION_COUNT = 100;

export class AutomationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AutomationView {
  id: number;
  name: string;
  triggerEvent: AutomationTriggerEvent;
  conditions: FilterGroup;
  actionType: AutomationActionType;
  actionConfig: AutomationActionConfig;
  priority: number;
  active: boolean;
}

export interface AutomationInput {
  name: string;
  triggerEvent: AutomationTriggerEvent;
  conditions: unknown;
  actionType: AutomationActionType;
  actionConfig: unknown;
}

export interface AutomationUpdate {
  name?: string;
  triggerEvent?: AutomationTriggerEvent;
  conditions?: unknown;
  actionType?: AutomationActionType;
  actionConfig?: unknown;
  active?: boolean;
}

const viewColumns = {
  id: automationsTable.id,
  name: automationsTable.name,
  triggerEvent: automationsTable.triggerEvent,
  conditions: automationsTable.conditions,
  actionType: automationsTable.actionType,
  actionConfig: automationsTable.actionConfig,
  priority: automationsTable.priority,
  active: automationsTable.active,
};

async function getAutomationById(
  dbc: Db,
  id: number,
): Promise<AutomationView> {
  const [row] = await dbc
    .select(viewColumns)
    .from(automationsTable)
    .where(eq(automationsTable.id, id));
  if (!row) throw new AutomationError(404, "Automation not found.");
  return row;
}

// All-null facts, used only to dry-run the evaluator at write time.
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

/** Same checks as assignment rules: shape, limits, evaluator dry-run. */
function validateConditions(raw: unknown): FilterGroup {
  const parsed = filterGroupSchema.safeParse(raw);
  if (!parsed.success) throw new AutomationError(400, "Invalid conditions.");
  const group = parsed.data;
  if (maxDepth(group) > MAX_CONDITION_DEPTH) {
    throw new AutomationError(400, "Conditions are nested too deeply.");
  }
  if (countConditions(group) > MAX_CONDITION_COUNT) {
    throw new AutomationError(400, "Too many conditions.");
  }
  try {
    evaluate(group, EMPTY_DEAL_FACTS);
  } catch {
    throw new AutomationError(
      400,
      "A condition is missing a value or uses an operator that isn't valid for its field.",
    );
  }
  return group;
}

const assigneeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deal_owner") }),
  z.object({ kind: z.literal("user"), userId: z.number().int().positive() }),
]);

const dealOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deal_owner") }),
  z.object({ kind: z.literal("user"), userId: z.number().int().positive() }),
  z.object({ kind: z.literal("auto") }),
]);

const createActivityConfigSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  activityType: z.enum(activityTypeEnum.enumValues),
  dueInDays: z.number().int().min(0).max(365),
  assignee: assigneeSchema,
});

const createDealConfigSchema = z.object({
  pipelineId: z.number().int().positive(),
  stageId: z.number().int().positive().nullable(),
  titleTemplate: z.string().max(300).nullable(),
  owner: dealOwnerSchema,
});

const callWebhookConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith("https://"), {
      message: "Webhook URL must use https://",
    }),
  method: z.enum(["POST", "PUT"]),
  includeDeal: z.boolean(),
  secretHeaderName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]+$/, "Invalid header name")
    .nullable(),
});

const slackDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("channel"), channel: z.string().trim().max(120) }),
  z.object({ kind: z.literal("deal_owner") }),
  z.object({ kind: z.literal("user"), userId: z.number().int().positive() }),
]);

const sendSlackMessageConfigSchema = z.object({
  destination: slackDestinationSchema,
  message: z.string().trim().min(1).max(3000),
});

const postNotificationConfigSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  // Which knobs each subscriber may override on their own copy. Closed enum, so
  // a rule can never declare a key the engine would not resolve.
  tunable: z.array(z.enum(NOTIFICATION_PARAM_KEYS)).max(4).optional(),
});

/**
 * Strictly validate actionConfig against its actionType, resolving live refs
 * (pipeline / stage / user). Unknown keys are stripped, so a config edited
 * across an action-type switch never carries stale fields.
 */
async function validateActionConfig(
  dbc: Db,
  actionType: AutomationActionType,
  raw: unknown,
): Promise<AutomationActionConfig> {
  if (actionType === "create_activity") {
    const parsed = createActivityConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AutomationError(400, "Invalid action configuration.");
    }
    const cfg = parsed.data;
    if (
      cfg.assignee.kind === "user" &&
      !(await isActiveUser(dbc, cfg.assignee.userId))
    ) {
      throw new AutomationError(400, "Assignee not found or deactivated.");
    }
    return cfg;
  }

  if (actionType === "call_webhook") {
    const parsed = callWebhookConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AutomationError(
        400,
        "Invalid webhook configuration (check the URL is https and the header name).",
      );
    }
    return parsed.data;
  }

  if (actionType === "send_slack_message") {
    const parsed = sendSlackMessageConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AutomationError(400, "Invalid Slack message configuration.");
    }
    const cfg = parsed.data;
    if (
      cfg.destination.kind === "user" &&
      !(await isActiveUser(dbc, cfg.destination.userId))
    ) {
      throw new AutomationError(400, "Slack recipient not found or deactivated.");
    }
    return cfg;
  }

  if (actionType === "post_notification") {
    const parsed = postNotificationConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AutomationError(400, "Invalid notification configuration.");
    }
    return parsed.data;
  }

  // create_deal — NOTE this is the fall-through, so any action type without a
  // branch above gets validated as a create_deal config and rejected with a
  // misleading message. Add a branch when adding an action type.
  const parsed = createDealConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AutomationError(400, "Invalid action configuration.");
  }
  const cfg = parsed.data;

  // Only {title} may be interpolated in the title template.
  if (cfg.titleTemplate) {
    const leftover = cfg.titleTemplate.replaceAll("{title}", "");
    if (/[{}]/.test(leftover)) {
      throw new AutomationError(
        400,
        "Title template only supports the {title} placeholder.",
      );
    }
  }

  const [pipeline] = await dbc
    .select({ id: pipelinesTable.id })
    .from(pipelinesTable)
    .where(
      and(
        eq(pipelinesTable.id, cfg.pipelineId),
        eq(pipelinesTable.archived, false),
      ),
    );
  if (!pipeline) {
    throw new AutomationError(400, "Target pipeline not found (or archived).");
  }

  if (cfg.stageId != null) {
    const [stage] = await dbc
      .select({ id: stagesTable.id })
      .from(stagesTable)
      .where(
        and(
          eq(stagesTable.id, cfg.stageId),
          eq(stagesTable.pipelineId, cfg.pipelineId),
          eq(stagesTable.archived, false),
        ),
      );
    if (!stage) {
      throw new AutomationError(
        400,
        "Target stage must be a live stage of the target pipeline.",
      );
    }
  }

  if (
    cfg.owner.kind === "user" &&
    !(await isActiveUser(dbc, cfg.owner.userId))
  ) {
    throw new AutomationError(400, "Owner not found or deactivated.");
  }
  return cfg;
}

/** Next priority slot within a trigger event (append to the end). */
async function nextPriority(
  dbc: Db,
  triggerEvent: AutomationTriggerEvent,
): Promise<number> {
  const { rows } = await dbc.execute<{ next: number }>(
    sql`select coalesce(max(priority), -1) + 1 as next from ${automationsTable} where trigger_event = ${triggerEvent}`,
  );
  return Number(rows[0]?.next ?? 0);
}

/** Every automation (both events), ordered by event then priority. */
export async function adminListAutomations(): Promise<AutomationView[]> {
  return db
    .select(viewColumns)
    .from(automationsTable)
    .orderBy(
      asc(automationsTable.triggerEvent),
      asc(automationsTable.priority),
    );
}

export async function createAutomation(
  input: AutomationInput,
): Promise<AutomationView> {
  const name = input.name.trim();
  if (!name) throw new AutomationError(400, "Automation name cannot be empty.");
  const conditions = validateConditions(input.conditions);

  return db.transaction(async (tx) => {
    const actionConfig = await validateActionConfig(
      tx,
      input.actionType,
      input.actionConfig,
    );
    const priority = await nextPriority(tx, input.triggerEvent);
    const [created] = await tx
      .insert(automationsTable)
      .values({
        name,
        triggerEvent: input.triggerEvent,
        conditions,
        actionType: input.actionType,
        actionConfig,
        priority,
      })
      .returning({ id: automationsTable.id });
    return getAutomationById(tx, created.id);
  });
}

export async function updateAutomation(
  id: number,
  patch: AutomationUpdate,
): Promise<AutomationView> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(automationsTable)
      .where(eq(automationsTable.id, id));
    if (!existing) throw new AutomationError(404, "Automation not found.");

    const set: Partial<typeof automationsTable.$inferInsert> = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) {
        throw new AutomationError(400, "Automation name cannot be empty.");
      }
      set.name = name;
    }
    if (patch.conditions !== undefined) {
      set.conditions = validateConditions(patch.conditions);
    }
    if (patch.active !== undefined) set.active = patch.active;

    // The action pair validates together: changing the type requires its config.
    if (
      patch.actionType !== undefined &&
      patch.actionType !== existing.actionType &&
      patch.actionConfig === undefined
    ) {
      throw new AutomationError(
        400,
        "actionConfig is required when changing actionType.",
      );
    }
    if (patch.actionType !== undefined || patch.actionConfig !== undefined) {
      const effType = patch.actionType ?? existing.actionType;
      const effRaw =
        patch.actionConfig !== undefined
          ? patch.actionConfig
          : existing.actionConfig;
      set.actionConfig = await validateActionConfig(tx, effType, effRaw);
      if (patch.actionType !== undefined) set.actionType = patch.actionType;
    }

    // Moving to a different trigger event re-homes the automation at the end
    // of that event's priority list (priority is per-event).
    if (
      patch.triggerEvent !== undefined &&
      patch.triggerEvent !== existing.triggerEvent
    ) {
      set.triggerEvent = patch.triggerEvent;
      set.priority = await nextPriority(tx, patch.triggerEvent);
    }

    if (Object.keys(set).length > 0) {
      await tx
        .update(automationsTable)
        .set(set)
        .where(eq(automationsTable.id, id));
    }
    return getAutomationById(tx, id);
  });
}

export async function deleteAutomation(id: number): Promise<void> {
  const [deleted] = await db
    .delete(automationsTable)
    .where(eq(automationsTable.id, id))
    .returning({ id: automationsTable.id });
  if (!deleted) throw new AutomationError(404, "Automation not found.");
}

/**
 * Reassign priority within one trigger event from an ordered id list (index
 * becomes the new priority). Ids not belonging to that event are ignored.
 */
export async function reorderAutomations(
  triggerEvent: AutomationTriggerEvent,
  orderedIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(automationsTable)
        .set({ priority: i })
        .where(
          and(
            eq(automationsTable.id, orderedIds[i]),
            eq(automationsTable.triggerEvent, triggerEvent),
          ),
        );
    }
  });
}
