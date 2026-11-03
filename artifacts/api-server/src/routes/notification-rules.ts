import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  automationsTable,
  notificationSubscriptionsTable,
  NOTIFICATION_PARAM_KEYS,
  type PostNotificationConfig,
} from "@workspace/db";
import {
  ListNotificationRulesResponse,
  SetNotificationSubscriptionParams,
  SetNotificationSubscriptionBody,
  SetNotificationSubscriptionResponse,
  SetAutomationNotificationsBody,
  SetAutomationNotificationsResponse,
} from "@workspace/api-zod";
import { currentUser } from "../lib/auth";

import { notificationSubscribeRateLimiter } from "../lib/rate-limit";

// Self-serve notification rules.
//
// This router is the ONLY non-admin surface over automations, and it is narrow
// on purpose: read the rules an admin authored, and manage your OWN
// subscription to them. Authoring stays on the admin router — a non-admin can
// never create, edit, delete or reorder a rule here.
//
// SECURITY SHAPE: the subscriber id is read from the session on every request
// and never from the URL or body. There is deliberately no route parameter or
// field that names a user, so there is no shape in which this router can write
// a subscription for someone else. Only rules whose action actually posts a
// notification are listed, so this cannot be used to enumerate the Slack or
// webhook automations a non-admin has no business seeing.

const router: IRouter = Router();

/** The tunable knobs a rule declares, filtered to keys the engine resolves. */
function tunableOf(config: unknown): string[] {
  const raw = (config as PostNotificationConfig | null)?.tunable;
  if (!Array.isArray(raw)) return [];
  return raw.filter((k) =>
    (NOTIFICATION_PARAM_KEYS as readonly string[]).includes(k),
  );
}

function messageOf(config: unknown): string | null {
  const m = (config as PostNotificationConfig | null)?.message;
  return typeof m === "string" ? m : null;
}

// Every notification rule, each merged with THIS user's subscription so the
// settings page renders from one call rather than a list plus an N+1 of
// subscription lookups.
router.get("/notification-rules", async (_req, res): Promise<void> => {
  const user = currentUser(res);

  const rows = await db
    .select({
      id: automationsTable.id,
      name: automationsTable.name,
      triggerEvent: automationsTable.triggerEvent,
      actionConfig: automationsTable.actionConfig,
      subscriptionActive: notificationSubscriptionsTable.active,
      params: notificationSubscriptionsTable.params,
    })
    .from(automationsTable)
    // LEFT join, not inner: a rule nobody has subscribed to must still appear,
    // otherwise the gallery is empty until someone else subscribes first and
    // there is no way to ever subscribe to anything.
    .leftJoin(
      notificationSubscriptionsTable,
      and(
        eq(notificationSubscriptionsTable.automationId, automationsTable.id),
        // Scoping the JOIN (not the WHERE) to this user is what keeps a
        // teammate's subscription row from being returned as if it were mine —
        // in the WHERE it would instead drop rules other people subscribed to.
        eq(notificationSubscriptionsTable.userId, user.id),
      ),
    )
    .where(
      and(
        eq(automationsTable.actionType, "post_notification"),
        // An inactive rule can never fire, so offering it would be a lie.
        eq(automationsTable.active, true),
      ),
    )
    .orderBy(asc(automationsTable.priority), asc(automationsTable.id));

  res.json(
    ListNotificationRulesResponse.parse({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        triggerEvent: r.triggerEvent,
        message: messageOf(r.actionConfig),
        tunable: tunableOf(r.actionConfig),
        subscribed: r.subscriptionActive === true,
        params: r.params ?? null,
      })),
    }),
  );
});

// Subscribe, unsubscribe, or retune one rule — for the current user only.
//
// PUT rather than POST because it is an upsert keyed on (user, rule): calling it
// twice is the same as calling it once, so a double-click or a retry can never
// hit the unique index and surface as a 500.
router.put(
  "/notification-rules/:id/subscription",
  // Cross-instance cap, loose enough that ordinary use never trips it.
  notificationSubscribeRateLimiter,
  async (req, res): Promise<void> => {
    const params = SetNotificationSubscriptionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = SetNotificationSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const user = currentUser(res);
    const automationId = params.data.id;

    const [rule] = await db
      .select({
        id: automationsTable.id,
        name: automationsTable.name,
        triggerEvent: automationsTable.triggerEvent,
        actionConfig: automationsTable.actionConfig,
      })
      .from(automationsTable)
      .where(
        and(
          eq(automationsTable.id, automationId),
          // Refusing on action type as well as id means this endpoint cannot be
          // used to attach a subscription to a Slack or webhook automation,
          // where it would sit inert and confusing forever.
          eq(automationsTable.actionType, "post_notification"),
          eq(automationsTable.active, true),
        ),
      );
    if (!rule) {
      res.status(404).json({ error: "Notification rule not found." });
      return;
    }

    // Validate tuning against what THIS rule declares. Rejecting an undeclared
    // key (rather than silently dropping it) is the difference between a user
    // learning their input was ignored now and wondering later why their
    // threshold never took effect.
    const tunable = tunableOf(rule.actionConfig);
    const raw = body.data.params ?? null;
    let params_: Record<string, unknown> | null = null;
    if (raw && typeof raw === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!tunable.includes(key)) {
          res.status(400).json({
            error: `This rule does not allow tuning "${key}".`,
          });
          return;
        }
        if (key === "days") {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0) {
            res
              .status(400)
              .json({ error: "days must be a whole number of days." });
            return;
          }
          out[key] = n;
        }
      }
      params_ = Object.keys(out).length > 0 ? out : null;
    }

    const [saved] = await db
      .insert(notificationSubscriptionsTable)
      .values({
        userId: user.id,
        automationId,
        active: body.data.active,
        params: params_,
      })
      .onConflictDoUpdate({
        target: [
          notificationSubscriptionsTable.userId,
          notificationSubscriptionsTable.automationId,
        ],
        set: { active: body.data.active, params: params_ },
      })
      .returning({
        active: notificationSubscriptionsTable.active,
        params: notificationSubscriptionsTable.params,
      });

    res.json(
      SetNotificationSubscriptionResponse.parse({
        id: rule.id,
        name: rule.name,
        triggerEvent: rule.triggerEvent,
        message: messageOf(rule.actionConfig),
        tunable,
        subscribed: saved?.active === true,
        params: saved?.params ?? null,
      }),
    );
  },
);

/**
 * ONE switch for every automation that posts an in-app notification.
 *
 * This replaces the per-rule subscription list, which was the worst part of this
 * feature's design: authoring a rule in Settings looked like finishing, and a
 * second, identical-looking toggle on a different page was what actually made it
 * deliver — with nothing on the first page saying so. One switch, and the lead time belongs to the automation.
 *
 * Implemented over the existing subscription rows rather than replacing them.
 * The claim key is `sub:<subscriptionId>:…`, and live claims exist, so moving to
 * a per-user key would make every one of them unmatchable and re-notify everybody
 * once. Keeping the rows costs nothing and keeps that history intact — the change
 * is that nobody has to see them.
 */
router.put(
  "/notification-rules/automations",
  notificationSubscribeRateLimiter,
  async (req, res): Promise<void> => {
    const body = SetAutomationNotificationsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const user = currentUser(res);
    const { active } = body.data;

    const rules = await db
      .select({
        id: automationsTable.id,
        triggerEvent: automationsTable.triggerEvent,
      })
      .from(automationsTable)
      .where(
        and(
          eq(automationsTable.actionType, "post_notification"),
          eq(automationsTable.active, true),
        ),
      );

    for (const rule of rules) {
      await db
        .insert(notificationSubscriptionsTable)
        .values({
          userId: user.id,
          automationId: rule.id,
          active,
          // No per-subscriber tuning any more: the lead time is the rule's, set
          // where the automation is authored. Cleared rather than left stale so a
          // previously tuned row starts honouring the rule.
          params: null,
        })
        .onConflictDoUpdate({
          target: [
            notificationSubscriptionsTable.userId,
            notificationSubscriptionsTable.automationId,
          ],
          set: { active, params: null },
        });
    }

    res.json(
      SetAutomationNotificationsResponse.parse({ active, ruleCount: rules.length }),
    );
  },
);

export default router;
