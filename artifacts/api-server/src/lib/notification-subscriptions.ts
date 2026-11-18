import { and, eq, ne } from "drizzle-orm";
import {
  db,
  automationsTable,
  notificationSubscriptionsTable,
  notificationsTable,
  usersTable,
  NOTIFICATION_PARAM_KEYS,
  type NotificationParamKey,
  type PostNotificationConfig,
} from "@workspace/db";
import { TEMPLATE_FIELDS } from "@workspace/automation-placeholders";
import type { Tx } from "./change-events";
import { logger } from "./logger";

// The post_notification action's recipient resolution and write.
//
// THE WHOLE POINT OF THIS FILE is the filter chain in `recipientsFor`. A
// notification rule is workspace-global, so without these filters a rule like
// "any deal updated" would notify its subscriber about every deal in the
// company — including records they cannot open. Three drops, each of which is
// silent if it regresses, which is why they are tested directly:
//
//   1. NOT the actor. You edit your own deal on every save; notifying yourself
//      about yourself makes the bell useless within a day. Mirrors the change
//      feed's `changed_by is distinct from` predicate in routes/changes.ts.
//   2. ONLY the record's owner/manager. This is a permission boundary, not a
//      nicety: the notification carries an entity link.
//   3. ONLY active users. A deactivated teammate keeps their subscription rows
//      (restoring them on reactivation is the point) but must stop receiving.
//
// Because (2) narrows to the owner, the recipient set for any single record is
// at most one person. The list shape is kept anyway: it is what makes the drops
// testable in isolation, and a future "records my team owns" scope widens it
// without reshaping the caller.

/** A resolved recipient plus the tuning carried by their subscription row. */
export interface NotificationRecipient {
  userId: number;
  params: Record<string, unknown> | null;
}

/**
 * Make sure every active user has an active subscription row for every active
 * notification rule.
 *
 * Automation alerts are not opt-in any more: an admin switching an automation on
 * IS the opt-in, and the second switch that used to live on My notifications is
 * gone. The rows stay, because the scanners' de-duplication claim keys are
 * subscription-scoped (`sub:<subscriptionId>:…`) and live claims exist — moving
 * to a per-user key would make every one of them unmatchable and re-notify
 * everybody once. So the rows are now derived rather than authored: this
 * back-fills what is missing and re-activates anything switched off before the
 * change, and `params` is cleared because the lead time belongs to the rule.
 *
 * Cheap (users x notifying rules, both tiny) and idempotent, so the scanners
 * call it at the top of every run and it self-heals for users added since.
 */
export async function ensureAutomationSubscriptions(): Promise<void> {
  const rules = await db
    .select({ id: automationsTable.id })
    .from(automationsTable)
    .where(
      and(
        eq(automationsTable.actionType, "post_notification"),
        eq(automationsTable.active, true),
      ),
    );
  if (rules.length === 0) return;

  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.activeFlag, true));
  if (users.length === 0) return;

  await db
    .insert(notificationSubscriptionsTable)
    .values(
      users.flatMap((u) =>
        rules.map((r) => ({
          userId: u.id,
          automationId: r.id,
          active: true,
          params: null,
        })),
      ),
    )
    .onConflictDoUpdate({
      target: [
        notificationSubscriptionsTable.userId,
        notificationSubscriptionsTable.automationId,
      ],
      set: { active: true, params: null },
    });
}

/**
 * Who should receive a fire of `automationId` for a record owned by `ownerId`.
 *
 * Returns [] — never throws — for every "nobody" case: no subscribers, an
 * unowned record, the owner being the actor, or the owner being deactivated.
 * An empty result is the normal case, not an error: a rule with no subscribers
 * is inert by design.
 */
export async function recipientsFor(
  tx: Tx,
  automationId: number,
  ownerId: number | null,
  actorId: number | null,
): Promise<NotificationRecipient[]> {
  // An unowned deal has nobody to notify. Returning early also keeps the query
  // below from comparing user_id against NULL, which matches no rows but reads
  // like a bug at a glance.
  if (ownerId == null) return [];
  // The actor owning the record they just changed is the single most common
  // case in the app; short-circuit it before touching the database.
  if (actorId != null && ownerId === actorId) return [];

  // No subscription lookup: automation alerts are on for everyone, so the only
  // questions left are the three drops above. `params` is always null here —
  // per-subscriber tuning is gone and the lead time belongs to the rule.
  const rows = await tx
    .select({ userId: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, ownerId),
        // Drop 3: deactivated users stop receiving.
        eq(usersTable.activeFlag, true),
        // Drop 1 again, in SQL. The early return above covers it for the
        // owner-is-actor case; this keeps the guarantee if the ownership scope
        // is ever widened past "owner only" and the early return stops being
        // sufficient.
        ...(actorId == null ? [] : [ne(usersTable.id, actorId)]),
      ),
    );

  return rows.map((r) => ({ userId: r.userId, params: null }));
}

/**
 * Keep only the tuning keys this rule actually declared tunable, coercing each
 * to the type its key promises.
 *
 * Subscriber params are jsonb, so nothing about their shape is guaranteed by
 * the database — the API layer validates on write and this re-checks at run
 * time, the same belt-and-braces the engine applies to `action_config`. A key
 * the rule no longer declares is dropped rather than rendered, so narrowing a
 * rule's `tunable` list cannot leak a stale value into a message.
 */
export function resolveParams(
  config: PostNotificationConfig,
  params: Record<string, unknown> | null,
): Record<string, unknown> {
  const tunable = config.tunable ?? [];
  if (!params || tunable.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const key of tunable) {
    if (!(NOTIFICATION_PARAM_KEYS as readonly string[]).includes(key)) continue;
    const value = params[key];
    if (value == null) continue;
    // `days` is the only key today and it is numeric. A non-numeric value is
    // dropped rather than rendered as "NaN" in someone's notification.
    if (key === "days") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      out[key] = n;
    }
  }
  return out;
}

/**
 * Render a notification body against named scopes.
 *
 * Deliberately NOT `slack.renderAutomationTemplate`: that one mrkdwn-escapes
 * substituted values, which is right for Slack and wrong here — an in-app
 * notification is rendered as React text, so escaping would show a deal named
 * "A & B" as "A &amp; B". The placeholder allowlist is shared
 * (`TEMPLATE_FIELDS`) so the two renderers can never disagree about which
 * fields resolve; only the escaping differs.
 *
 * NEVER FEED ITS OUTPUT TO SLACK. A scanner building Slack text goes through
 * the Slack card, which renders the same template escaped.
 */
export function renderNotificationMessage(
  template: string,
  scopes: Record<string, Record<string, unknown>>,
): string {
  return template.replace(
    /\{\{\s*(\w+)\.(\w+)\s*\}\}/g,
    (_, scope: string, field: string) => {
      if (!TEMPLATE_FIELDS[scope]?.includes(field)) return "";
      const v = scopes[scope]?.[field];
      return v == null ? "" : String(v);
    },
  );
}

export interface PostNotificationInput {
  automationId: number;
  automationName: string;
  config: PostNotificationConfig;
  /** The record's owner (deal owner). */
  ownerId: number | null;
  /** Who made the change. null for inbound-webhook writes (no CRM user). */
  actorId: number | null;
  /** Where clicking the notification goes. */
  entityType: "deal" | "person" | "organization";
  entityId: number;
  /** Placeholder scopes for the message, minus `params` (resolved per user). */
  scopes: Record<string, Record<string, unknown>>;
}

/**
 * Resolve recipients and insert one in-app notification row each.
 *
 * Runs INSIDE the caller's transaction so the notification commits atomically
 * with the change it describes — a rolled-back deal write must not leave a
 * notification claiming it happened. Nothing here is network-bound, so unlike
 * the Slack and webhook actions there is no post-commit collector.
 *
 * Returns the recipient ids so the caller can fan out to opt-in channels after
 * commit. Never throws: a notification failure must not abort the write.
 */
export async function postNotificationAction(
  tx: Tx,
  input: PostNotificationInput,
): Promise<number[]> {
  const recipients = await recipientsFor(
    tx,
    input.automationId,
    input.ownerId,
    input.actorId,
  );
  if (recipients.length === 0) return [];

  const rows = recipients.map((r) => ({
    userId: r.userId,
    actorId: input.actorId,
    type: "automation" as const,
    message:
      renderNotificationMessage(input.config.message, {
        ...input.scopes,
        params: resolveParams(input.config, r.params),
      }).trim() ||
      // A template that renders empty (every placeholder blank, or a rule saved
      // with a whitespace-only message) would surface as a blank row in the
      // bell with no way to tell what fired. Fall back to the rule's name.
      input.automationName,
    entityType: input.entityType,
    entityId: input.entityId,
  }));

  await tx.insert(notificationsTable).values(rows);
  logger.info(
    {
      automationId: input.automationId,
      recipients: recipients.map((r) => r.userId),
    },
    "post_notification: delivered in-app",
  );
  return recipients.map((r) => r.userId);
}

/** The tuning keys a rule may declare, for API-layer validation. */
export function isNotificationParamKey(k: string): k is NotificationParamKey {
  return (NOTIFICATION_PARAM_KEYS as readonly string[]).includes(k);
}
