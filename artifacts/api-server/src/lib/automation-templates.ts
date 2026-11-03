import { desc, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  automationTemplatesTable,
  AUTOMATION_TRIGGER_EVENTS,
  AUTOMATION_ACTION_TYPES,
  type AutomationTriggerEvent,
  type AutomationActionType,
  type AutomationActionConfig,
} from "@workspace/db";
import {
  maxDepth,
  countConditions,
  type FilterGroup,
} from "@workspace/deals-filter";
import { AutomationError } from "./automation-admin";

// Saved automation templates — the org-wide gallery behind the wizard. Anyone
// can save an automation's setup here; everyone sees it. Validation is light
// (name + known trigger/action) because the real, strict validation runs when
// a template is applied and a normal automation is created from it.

export interface TemplateView {
  id: number;
  name: string;
  description: string;
  emoji: string | null;
  triggerEvent: AutomationTriggerEvent;
  conditions: FilterGroup;
  actionType: AutomationActionType;
  actionConfig: AutomationActionConfig;
  createdByName: string | null;
}

const viewColumns = {
  id: automationTemplatesTable.id,
  name: automationTemplatesTable.name,
  description: automationTemplatesTable.description,
  emoji: automationTemplatesTable.emoji,
  triggerEvent: automationTemplatesTable.triggerEvent,
  conditions: automationTemplatesTable.conditions,
  actionType: automationTemplatesTable.actionType,
  actionConfig: automationTemplatesTable.actionConfig,
  createdByName: usersTable.name,
};

export async function listAutomationTemplates(): Promise<TemplateView[]> {
  return db
    .select(viewColumns)
    .from(automationTemplatesTable)
    .leftJoin(usersTable, eq(automationTemplatesTable.createdBy, usersTable.id))
    .orderBy(desc(automationTemplatesTable.addTime));
}

export interface TemplateInput {
  name: string;
  description?: string;
  emoji?: string | null;
  triggerEvent: AutomationTriggerEvent;
  conditions: unknown;
  actionType: AutomationActionType;
  actionConfig: unknown;
}

export async function createAutomationTemplate(
  input: TemplateInput,
  userId: number | null,
): Promise<TemplateView> {
  const name = input.name.trim();
  if (!name) throw new AutomationError(400, "Template name cannot be empty.");
  if (
    !(AUTOMATION_TRIGGER_EVENTS as readonly string[]).includes(
      input.triggerEvent,
    )
  ) {
    throw new AutomationError(400, "Unknown trigger event.");
  }
  if (
    !(AUTOMATION_ACTION_TYPES as readonly string[]).includes(input.actionType)
  ) {
    throw new AutomationError(400, "Unknown action type.");
  }
  // Same size caps as real automations (validateConditions) — a template is
  // broadcast to every user's gallery, so keep the stored jsonb bounded. The
  // strict per-action validation still runs when the template is applied.
  const group = input.conditions as FilterGroup;
  try {
    if (maxDepth(group) > 5 || countConditions(group) > 100) {
      throw new AutomationError(400, "Template conditions are too large.");
    }
  } catch (err) {
    if (err instanceof AutomationError) throw err;
    throw new AutomationError(400, "Invalid template conditions.");
  }
  if (JSON.stringify(input.actionConfig ?? {}).length > 10_000) {
    throw new AutomationError(400, "Template action is too large.");
  }

  const [created] = await db
    .insert(automationTemplatesTable)
    .values({
      name,
      description: input.description?.trim() ?? "",
      emoji: input.emoji ?? null,
      triggerEvent: input.triggerEvent,
      conditions: input.conditions as FilterGroup,
      actionType: input.actionType,
      actionConfig: input.actionConfig as AutomationActionConfig,
      createdBy: userId,
    })
    .returning({ id: automationTemplatesTable.id });

  const [row] = await db
    .select(viewColumns)
    .from(automationTemplatesTable)
    .leftJoin(usersTable, eq(automationTemplatesTable.createdBy, usersTable.id))
    .where(eq(automationTemplatesTable.id, created.id));
  return row;
}

export async function updateAutomationTemplate(
  id: number,
  input: TemplateInput,
): Promise<TemplateView> {
  const name = input.name.trim();
  if (!name) throw new AutomationError(400, "Template name cannot be empty.");
  if (
    !(AUTOMATION_TRIGGER_EVENTS as readonly string[]).includes(
      input.triggerEvent,
    )
  ) {
    throw new AutomationError(400, "Unknown trigger event.");
  }
  if (
    !(AUTOMATION_ACTION_TYPES as readonly string[]).includes(input.actionType)
  ) {
    throw new AutomationError(400, "Unknown action type.");
  }
  const group = input.conditions as FilterGroup;
  try {
    if (maxDepth(group) > 5 || countConditions(group) > 100) {
      throw new AutomationError(400, "Template conditions are too large.");
    }
  } catch (err) {
    if (err instanceof AutomationError) throw err;
    throw new AutomationError(400, "Invalid template conditions.");
  }
  if (JSON.stringify(input.actionConfig ?? {}).length > 10_000) {
    throw new AutomationError(400, "Template action is too large.");
  }

  const [updated] = await db
    .update(automationTemplatesTable)
    .set({
      name,
      description: input.description?.trim() ?? "",
      emoji: input.emoji ?? null,
      triggerEvent: input.triggerEvent,
      conditions: input.conditions as FilterGroup,
      actionType: input.actionType,
      actionConfig: input.actionConfig as AutomationActionConfig,
    })
    .where(eq(automationTemplatesTable.id, id))
    .returning({ id: automationTemplatesTable.id });
  if (!updated) throw new AutomationError(404, "Template not found.");

  const [row] = await db
    .select(viewColumns)
    .from(automationTemplatesTable)
    .leftJoin(usersTable, eq(automationTemplatesTable.createdBy, usersTable.id))
    .where(eq(automationTemplatesTable.id, id));
  return row;
}

export async function deleteAutomationTemplate(id: number): Promise<void> {
  const [deleted] = await db
    .delete(automationTemplatesTable)
    .where(eq(automationTemplatesTable.id, id))
    .returning({ id: automationTemplatesTable.id });
  if (!deleted) throw new AutomationError(404, "Template not found.");
}
