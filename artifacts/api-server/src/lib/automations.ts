import { and, asc, eq } from "drizzle-orm";
import {
  activitiesTable,
  automationsTable,
  dealsTable,
  organizationsTable,
  pipelinesTable,
  stagesTable,
  usersTable,
  type AutomationTriggerEvent,
  type CreateActivityConfig,
  type CreateDealConfig,
  type CallWebhookConfig,
  type SendSlackMessageConfig,
  type PostNotificationConfig,
  type Deal,
} from "@workspace/db";
import {
  countConditions,
  evaluate,
  type DealFacts,
  type FilterGroup,
} from "@workspace/deals-filter";
import { logDealCreated, type Tx } from "./change-events";
import {
  auditAutoAssignedOwner,
  buildFacts,
  isActiveUser,
  resolveAutoAssignment,
} from "./assignment";
import type { WebhookIntent } from "./webhook-dispatch";
import {
  renderAutomationTemplate,
  buildDealCardBlocks,
  type SlackIntent,
} from "./slack";
import { postNotificationAction } from "./notification-subscriptions";
import { logger } from "./logger";
import { appDateInDays } from "./assistant-dates";

// Deal-automations engine. Given a trigger event and the (post-write) deal,
// run every active matching automation in priority order. Runs INLINE inside
// the caller's transaction (same decision as the assignment engine) so
// automation effects commit atomically with the deal write.
//
// depth: 0 = a user/webhook-initiated event. A deal created by an automation
// re-fires deal_added at depth 1 (so it gets its own activities/owner), and
// depth-1 actions never fire further automations — loops are structurally
// impossible.
//
// A failing or stale automation (deleted pipeline, deactivated user, broken
// conditions) logs and skips; it must never abort the deal write it runs in.
// Catching the error is not enough for that: a failed statement aborts the
// caller's whole Postgres transaction, so the COMMIT would quietly become a
// ROLLBACK and the triggering write would be lost behind a 200. Each action
// therefore runs in its own savepoint (`inSavepoint`), and only that action
// rolls back.

const MAX_DEPTH = 1;

export interface AutomationCtx {
  depth: number;
  /**
   * Who made the change that fired this event, when a CRM user did.
   *
   * null means "no CRM user" — an inbound webhook lead, an import, a
   * system-initiated write. That is not the same as "unknown": with a null
   * actor nobody is excluded from notifications, which is correct, because
   * nobody in the CRM performed the change.
   *
   * Only the post_notification action reads it, to avoid notifying a person
   * about their own edit.
   */
  actorId: number | null;
  // Collectors for network-bound actions. Filled during the transaction; the
  // caller fires these AFTER commit (webhook-dispatch.fireWebhooks /
  // slack.fireSlackMessages) so a slow endpoint never holds the tx open.
  webhooks: WebhookIntent[];
  slackMessages: SlackIntent[];
}

/**
 * Run one automation's action in a savepoint (a nested drizzle transaction), so
 * a database error inside it rolls back that action alone and leaves the
 * caller's transaction usable. Errors are logged and swallowed — see the header.
 */
async function inSavepoint(
  tx: Tx,
  log: Record<string, unknown>,
  message: string,
  action: (sp: Tx) => Promise<void>,
): Promise<void> {
  try {
    await tx.transaction(action);
  } catch (err) {
    logger.error({ err, ...log }, message);
  }
}

/**
 * Does a deal automation fire for this event? Pure so the rule is unit-testable
 * (automation-deal-match.test.ts).
 *
 * `before` is the deal as it was before the write, or null when there was no
 * "before" (deal_added). With a before, an automation fires only when the deal
 * ENTERS its conditions: they match now and did not match before. Without that
 * rule "deal_updated + Status is won" re-fired on every later edit of a won
 * deal (a comment, a label), re-posting "X won" and creating another task each
 * time. An automation with no conditions has nothing to enter, so it keeps its
 * meaning of "any change to any deal" and fires on every real change.
 *
 * Throws what `evaluate` throws on broken conditions; the caller logs and skips.
 */
export function dealAutomationMatches(
  conditions: FilterGroup,
  after: DealFacts,
  before: DealFacts | null,
): boolean {
  if (!evaluate(conditions, after)) return false;
  if (before === null || countConditions(conditions) === 0) return true;
  return !evaluate(conditions, before);
}

function dealFacts(tx: Tx, deal: Deal): Promise<DealFacts> {
  return buildFacts(tx, {
    title: deal.title,
    organizationId: deal.organizationId,
    value: deal.value,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    ownerId: deal.ownerId,
    createdDate: deal.addTime,
    wonTime: deal.wonTime,
    status: deal.status,
    utmKeyword: deal.utmKeyword,
    lostReason: deal.lostReason,
    customFields: deal.customFields,
  });
}

/**
 * `before` is the deal row as it was before the write that fired the event.
 * Every deal_updated caller must pass it (see `dealAutomationMatches`);
 * deal_added has no before and omits it.
 */
export async function runAutomations(
  tx: Tx,
  event: AutomationTriggerEvent,
  deal: Deal,
  ctx: AutomationCtx,
  before?: Deal,
): Promise<void> {
  if (ctx.depth > MAX_DEPTH) return;

  const automations = await tx
    .select()
    .from(automationsTable)
    .where(
      and(
        eq(automationsTable.triggerEvent, event),
        eq(automationsTable.active, true),
      ),
    )
    .orderBy(asc(automationsTable.priority), asc(automationsTable.id));
  if (automations.length === 0) return;

  const facts = await dealFacts(tx, deal);
  const beforeFacts = before ? await dealFacts(tx, before) : null;

  for (const automation of automations) {
    let matches: boolean;
    try {
      matches = dealAutomationMatches(
        automation.conditions,
        facts,
        beforeFacts,
      );
    } catch (err) {
      logger.error(
        { err, automationId: automation.id, event },
        "automation failed; skipping",
      );
      continue;
    }
    if (!matches) continue;
    // A chained deal (depth MAX_DEPTH) still gets its own activities, owner
    // and notifications, but never another deal: that would be a follow-on of
    // the follow-on, one level past the chain this engine promises.
    if (automation.actionType === "create_deal" && ctx.depth >= MAX_DEPTH) {
      continue;
    }
    await inSavepoint(
      tx,
      { automationId: automation.id, event },
      "automation failed; skipping",
      async (tx) => {
        if (automation.actionType === "create_activity") {
          await createActivityAction(
            tx,
            automation.actionConfig as CreateActivityConfig,
            deal,
          );
        } else if (automation.actionType === "create_deal") {
          await createDealAction(
            tx,
            automation.actionConfig as CreateDealConfig,
            deal,
            ctx,
          );
        } else if (automation.actionType === "post_notification") {
          // In-app only, so nothing is network-bound and there is no post-commit
          // collector: the row is inserted in this transaction and commits with
          // the deal write that caused it.
          await postNotificationAction(tx, {
            automationId: automation.id,
            automationName: automation.name,
            config: automation.actionConfig as PostNotificationConfig,
            ownerId: deal.ownerId,
            actorId: ctx.actorId,
            entityType: "deal",
            entityId: deal.id,
            scopes: { deal: dealScope(deal, await resolveDealNames(tx, deal)) },
          });
        } else if (automation.actionType === "send_slack_message") {
          // Resolve the destination + render the message now (we have the deal
          // and the tx); collect and fire after commit (see slack.fireSlackMessages).
          const intent = await buildSlackIntent(
            tx,
            automation.actionConfig as SendSlackMessageConfig,
            deal,
          );
          if (intent) ctx.slackMessages.push(intent);
        } else {
          // call_webhook — collect now, fire after commit (see webhook-dispatch).
          ctx.webhooks.push({
            config: automation.actionConfig as CallWebhookConfig,
            event,
            deal,
            automationId: automation.id,
            automationName: automation.name,
          });
        }
      },
    );
  }
}

// Resolve a Slack action's destination against the triggering deal and render
// its message (with friendly owner/stage/pipeline/organization names), then
// attach the Block Kit card. Returns null (skip) when the destination can't
// be resolved — e.g. DM the deal owner but the deal has none. Never throws.
/**
 * The `{{deal.*}}` placeholder scope: the deal's own columns plus the friendly
 * names that only exist after a lookup (owner, stage, pipeline, organization).
 *
 * Shared by the Slack and post_notification actions so the two can never
 * disagree about what a placeholder resolves to. The named lookups are also
 * what the Slack card's field grid needs, so `resolveDealNames` is exposed
 * separately for that caller.
 */
async function resolveDealNames(
  tx: Tx,
  deal: Deal,
): Promise<{
  owner: string | null;
  stage: string | null;
  pipeline: string | null;
  organization: string | null;
}> {
  const [owner, stage, pipeline, organization] = await Promise.all([
    deal.ownerId == null
      ? null
      : tx
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, deal.ownerId))
          .then((r) => r[0]?.name ?? null),
    deal.stageId == null
      ? null
      : tx
          .select({ name: stagesTable.name })
          .from(stagesTable)
          .where(eq(stagesTable.id, deal.stageId))
          .then((r) => r[0]?.name ?? null),
    deal.pipelineId == null
      ? null
      : tx
          .select({ name: pipelinesTable.name })
          .from(pipelinesTable)
          .where(eq(pipelinesTable.id, deal.pipelineId))
          .then((r) => r[0]?.name ?? null),
    deal.organizationId == null
      ? null
      : tx
          .select({ name: organizationsTable.name })
          .from(organizationsTable)
          .where(eq(organizationsTable.id, deal.organizationId))
          .then((r) => r[0]?.name ?? null),
  ]);
  return { owner, stage, pipeline, organization };
}

/**
 * The `{{deal.*}}` scope. Pure — takes names already resolved by
 * `resolveDealNames` so a caller that also needs them for a Slack card does not
 * pay for the four lookups twice.
 */
function dealScope(
  deal: Deal,
  names: Awaited<ReturnType<typeof resolveDealNames>>,
): Record<string, unknown> {
  return {
    ...(deal as unknown as Record<string, unknown>),
    value:
      deal.value == null ? null : Number(deal.value).toLocaleString("en-US"),
    owner: names.owner ?? "",
    stage: names.stage ?? "",
    pipeline: names.pipeline ?? "",
    organization: names.organization ?? "",
  };
}

async function buildSlackIntent(
  tx: Tx,
  config: SendSlackMessageConfig,
  deal: Deal,
): Promise<SlackIntent | null> {
  const names = await resolveDealNames(tx, deal);
  const { owner, pipeline, organization } = names;
  const text = renderAutomationTemplate(config.message, {
    deal: dealScope(deal, names),
  });
  const blocks = buildDealCardBlocks(text, {
    valueText:
      deal.value == null
        ? null
        : `${Number(deal.value).toLocaleString("en-US")} ${deal.currency ?? ""}`.trim(),
    ownerName: owner,
    pipelineName: pipeline,
    organizationName: organization,
    dealId: deal.id,
  });
  const dest = config.destination;

  if (dest.kind === "channel") {
    return { target: { kind: "channel", channel: dest.channel }, text, blocks };
  }

  // DM paths resolve a CRM user → email; slack.ts maps email → Slack id.
  const userId = dest.kind === "deal_owner" ? deal.ownerId : dest.userId;
  const email = await userEmail(tx, userId);
  if (!email) return null; // e.g. deal_owner on an unowned deal
  return { target: { kind: "email", email }, text, blocks };
}

async function userEmail(tx: Tx, userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const [user] = await tx
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user?.email ?? null;
}

async function createActivityAction(
  tx: Tx,
  config: CreateActivityConfig,
  deal: Deal,
): Promise<void> {
  // A configured-but-deactivated user degrades to an unassigned activity
  // rather than skipping — the activity is the point, the owner is a detail.
  let ownerId: number | null = null;
  if (config.assignee.kind === "user") {
    if (await isActiveUser(tx, config.assignee.userId)) {
      ownerId = config.assignee.userId;
    }
  } else {
    ownerId = deal.ownerId;
  }

  await tx.insert(activitiesTable).values({
    subject: config.subject,
    type: config.activityType,
    // "Due in N days" counts from the team's calendar day, not UTC's: between
    // midnight in the app time zone and midnight UTC the dates differ.
    dueDate: appDateInDays(config.dueInDays),
    dealId: deal.id,
    personId: deal.personId,
    orgId: deal.organizationId,
    ownerId,
    creatorUserId: null,
  });
}

async function createDealAction(
  tx: Tx,
  config: CreateDealConfig,
  source: Deal,
  ctx: AutomationCtx,
): Promise<void> {
  // Config refs live in jsonb (no FKs) — re-verify at run time; a target
  // deleted or archived since save skips the action instead of failing.
  const [pipeline] = await tx
    .select({ id: pipelinesTable.id })
    .from(pipelinesTable)
    .where(
      and(
        eq(pipelinesTable.id, config.pipelineId),
        eq(pipelinesTable.archived, false),
      ),
    );
  if (!pipeline) {
    logger.warn(
      { pipelineId: config.pipelineId },
      "automation target pipeline missing or archived; skipping",
    );
    return;
  }

  let stageId: number | null = null;
  if (config.stageId != null) {
    const [stage] = await tx
      .select({ id: stagesTable.id })
      .from(stagesTable)
      .where(
        and(
          eq(stagesTable.id, config.stageId),
          eq(stagesTable.pipelineId, config.pipelineId),
          eq(stagesTable.archived, false),
        ),
      );
    stageId = stage?.id ?? null;
  }
  if (stageId == null) {
    // No stage configured (or it's gone) → first live stage of the pipeline.
    const [first] = await tx
      .select({ id: stagesTable.id })
      .from(stagesTable)
      .where(
        and(
          eq(stagesTable.pipelineId, config.pipelineId),
          eq(stagesTable.archived, false),
        ),
      )
      .orderBy(asc(stagesTable.orderIndex), asc(stagesTable.id))
      .limit(1);
    stageId = first?.id ?? null;
  }
  if (stageId == null) {
    logger.warn(
      { pipelineId: config.pipelineId },
      "automation target pipeline has no live stages; skipping",
    );
    return;
  }

  const template = config.titleTemplate?.trim() || "{title}";
  const title = template.replaceAll("{title}", source.title);
  const now = new Date();

  let ownerId: number | null = null;
  if (config.owner.kind === "user") {
    if (await isActiveUser(tx, config.owner.userId)) {
      ownerId = config.owner.userId;
    }
  } else if (config.owner.kind === "deal_owner") {
    ownerId = source.ownerId;
  }
  // Ownerless here — kind "auto", a deactivated configured user, or an
  // ownerless source deal — lets the deal_added assignment rules pick,
  // exactly like an ownerless POST /deals.
  let autoAssignedOwner: number | null = null;
  if (ownerId == null) {
    autoAssignedOwner = await resolveAutoAssignment(tx, "deal_added", {
      title,
      organizationId: source.organizationId,
      value: source.value,
      pipelineId: config.pipelineId,
      stageId,
      ownerId: null,
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
      title,
      value: source.value,
      currency: source.currency,
      pipelineId: config.pipelineId,
      stageId,
      ownerId,
      creatorUserId: null,
      personId: source.personId,
      organizationId: source.organizationId,
      stageChangeTime: now,
    })
    .returning();

  await logDealCreated(tx, row, { changedBy: null, source: "automation" });
  if (autoAssignedOwner != null) {
    await auditAutoAssignedOwner(
      tx,
      { ...row, ownerId: null },
      autoAssignedOwner,
      now,
    );
  }

  // One-level chain: the new deal fires its own deal_added automations (the
  // call no-ops when this action was itself already a chained one). The same
  // webhooks collector is shared so chained webhooks also fire post-commit.
  // The actor carries down the chain: the person whose edit cascaded into this
  // deal is still the actor for it, so a follow-on deal assigned back to them
  // does not notify them about their own action.
  await runAutomations(tx, "deal_added", row, {
    depth: ctx.depth + 1,
    actorId: ctx.actorId,
    webhooks: ctx.webhooks,
    slackMessages: ctx.slackMessages,
  });
}
