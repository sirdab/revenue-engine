import { eq } from "drizzle-orm";
import { db, usersTable, notificationsTable, userPreferencesTable } from "@workspace/db";
import { appBaseUrl, sendNotificationEmail, APP_NAME } from "./email";
import { sendSlackMessage, fireSlackMessages, mrkdwnEscape } from "./slack";
import { logger } from "./logger";

// The notification controller (SAI notifications ticket): every event that
// should reach a human goes through notify(), which resolves the recipient,
// renders the content once, and fans out to every configured channel.
// Channels are best-effort — notify() never throws, because a notification
// failure must never break the action that caused it.
//
// Adding a notification elsewhere in the app = one notify() call.
// Adding a channel = one sender module wired here.

export type NotificationEvent =
  | {
      type: "deal_assigned";
      dealId: number;
      dealTitle: string;
      userId: number;
    }
  | {
      // @mention in a note (CS ask: "Slack for announcements, CRM for
      // tagging") — so this one is email + in-app only, never the channel.
      type: "mentioned";
      userId: number;
      actorName: string;
      entityLabel: string;
      /** In-app path, e.g. /deal/42 */
      path: string;
    }
  | {
      // Team announcement — channel only, no individual recipient.
      type: "deal_won";
      dealId: number;
      dealTitle: string;
      value: number;
      currency: string;
      actorName: string;
    };

// The four preference categories a CS member can toggle per channel (see
// task-4-brief.md). `mention` covers the `mentioned` event's EMAIL only — its
// in-app row is written by mentions.ts, not by render()'s `inApp` (Constraint
// 2), so a "mention" category has no effect on the in-app channel at all.
// `deal_won` has no category: it's a team announcement with no recipient, so
// per-user preferences don't apply to it.
export type NotificationCategory = "reminder" | "overdue" | "assignment" | "mention";

interface Rendered {
  recipientId: number | null;
  /** Which preference category gates this event's channels. Omit = unaffected by preferences (deal_won). */
  category?: NotificationCategory;
  subject: string;
  heading: string;
  bodyLines: string[];
  ctaLabel: string;
  ctaUrl: string;
  /** One-liner for the shared Slack channel; omit to keep the event off Slack. */
  slackText?: (recipientName: string | null) => string;
  /**
   * Also DM slackText to the recipient (not only the shared channel). For
   * personal nudges (reminders/overdue) the owner gets a direct ping AND the
   * team keeps its pulse in the channel.
   */
  slackDmRecipient?: boolean;
  /** Channel-only announcement — no recipient expected, email skipped silently. */
  announcementOnly?: boolean;
  /**
   * In-app row to write for the recipient. Omit for events that already
   * insert their own row (mentioned) or have no recipient (deal_won).
   */
  inApp?: {
    type: string;
    message: string;
    entityType: "deal" | "account" | null;
    entityId: number | null;
  };
}

function render(event: NotificationEvent): Rendered {
  const base = appBaseUrl();
  switch (event.type) {
    case "deal_assigned":
      return {
        recipientId: event.userId,
        category: "assignment",
        subject: `Deal assigned to you: ${event.dealTitle}`,
        heading: "A deal was assigned to you",
        bodyLines: [
          `“${event.dealTitle}” is now yours, assigned automatically by the team's assignment rules.`,
        ],
        ctaLabel: "Open the deal",
        ctaUrl: `${base}/deal/${event.dealId}`,
        // No Slack channel announcement (BD request): the shared announcements
        // channel is reserved for won-deal posts, so auto-assignment notifies
        // the new owner by email only — no assignment noise in that channel.
        inApp: {
          type: "assignment",
          message: `“${event.dealTitle}” was assigned to you`,
          entityType: "deal",
          entityId: event.dealId,
        },
      };
    case "mentioned":
      return {
        recipientId: event.userId,
        category: "mention",
        subject: `${event.actorName} mentioned you on ${APP_NAME}`,
        heading: `${event.actorName} mentioned you`,
        bodyLines: [
          `${event.actorName} mentioned you in a note on ${event.entityLabel}.`,
        ],
        ctaLabel: "Open it",
        ctaUrl: `${base}${event.path}`,
        // Tagging stays inside the CRM (in-app + email) — no Slack.
      };
    case "deal_won":
      return {
        recipientId: null,
        announcementOnly: true,
        subject: `Deal won: ${event.dealTitle}`,
        heading: `Deal won: ${event.dealTitle}`,
        bodyLines: [],
        ctaLabel: "Open the deal",
        ctaUrl: `${base}/deal/${event.dealId}`,
        slackText: () =>
          `🎉 *Deal won!* ${mrkdwnEscape(event.dealTitle)}, *${new Intl.NumberFormat("en-US").format(event.value)} ${event.currency}* · closed by ${mrkdwnEscape(event.actorName)} · ${base}/deal/${event.dealId}`,
      };
  }
}

/**
 * Pure row-builder for the in-app channel — exported separately from
 * notify() so it can be unit-tested without a database. Returns null for
 * events that either already insert their own row (mentioned, see
 * lib/mentions.ts) or have no individual recipient (deal_won).
 */
export function inAppRowFor(
  event: NotificationEvent,
): NonNullable<Rendered["inApp"]> | null {
  return render(event).inApp ?? null;
}

interface CategoryChannelPrefs {
  email: boolean;
  inApp: boolean;
}

// A missing `notifications` namespace, a missing category, or a malformed
// value (a string where a boolean belongs, say) must all read as "on" —
// every existing user has no `notifications` key today, and deploying this
// feature must not silently mute the whole team (Constraint 6). Only an
// explicit `false` turns a channel off.
function channelPrefsFor(
  preferences: unknown,
  category: NotificationCategory | undefined,
): CategoryChannelPrefs {
  const allOn: CategoryChannelPrefs = { email: true, inApp: true };
  if (!category) return allOn;
  if (typeof preferences !== "object" || preferences === null) return allOn;
  const notifications = (preferences as Record<string, unknown>).notifications;
  if (typeof notifications !== "object" || notifications === null) return allOn;
  const cat = (notifications as Record<string, unknown>)[category];
  if (typeof cat !== "object" || cat === null) return allOn;
  const c = cat as Record<string, unknown>;
  return {
    email: c.email !== false,
    inApp: c.inApp !== false,
  };
}

/**
 * Pure planner for which channels a given event + stored preferences
 * document would actually fire, exported so the category/channel gating can
 * be unit-tested without a database — mirrors `inAppRowFor`'s role for the
 * in-app row shape.
 *
 * `mention`'s in-app row is never planned here (mentions.ts owns it, see
 * `inAppRowFor`), so its `inApp` output is always false regardless of the
 * stored "mention.inApp" preference — that preference is honestly inert, and
 * the settings UI must not offer a toggle that does nothing.
 */
export function plannedChannelsFor(
  event: NotificationEvent,
  preferences: unknown,
): { email: boolean; inApp: boolean; slackChannel: boolean; slackDm: boolean } {
  const r = render(event);
  const prefs = channelPrefsFor(preferences, r.category);
  const hasRecipient = r.recipientId != null;
  return {
    email: hasRecipient && prefs.email,
    inApp: !!r.inApp && hasRecipient && prefs.inApp,
    slackChannel: !!r.slackText,
    // Slack is not user-configurable (shared channel = team pulse), except
    // the personal DM, which is the same nudge as email and follows its
    // toggle.
    slackDm: !!r.slackDmRecipient && hasRecipient && prefs.email,
  };
}

/**
 * The retry verdict, as a pure function so the scheduler's loop condition is
 * testable without a DB or a Slack stub.
 *
 * WHY only the personal channels count: notify()'s boolean exists for exactly
 * one purpose — telling the reminder scheduler whether to keep its claim stamp
 * or release it for another attempt. Retrying is about the RECIPIENT's inbox,
 * so the shared announcements-channel post (a team pulse, sent for everyone,
 * ungated by preferences, and a no-op whenever Slack is simply unconfigured)
 * must not by itself count as "delivered" — that conflation made an
 * all-channels-off recipient re-scan forever. `shared` is accepted only to
 * make that exclusion explicit at the call site.
 *
 * WHY an empty personal set is delivered: no enabled channel means there is
 * nothing left to attempt, so a retry could never do better. A genuine failure
 * of an ENABLED channel still yields false, so failed reminders are still
 * retried rather than silently dropped.
 */
export function deliveryVerdict(
  personal: PromiseSettledResult<boolean>[],
  _shared: PromiseSettledResult<boolean>[],
): boolean {
  if (personal.length === 0) return true;
  return personal.some((x) => x.status === "fulfilled" && x.value);
}

/**
 * A fixed-window burst limiter, as a factory so the counting is unit-testable
 * with an injected clock instead of real time — same reason `plannedChannelsFor`
 * is a pure function. Fixed-window (not sliding) is deliberate: the point is to
 * cut off a runaway burst, and an exact boundary isn't worth a heavier structure.
 *
 * Counting is PER PROCESS. Fly runs multiple machines, so a burst spread across
 * them can exceed the cap by roughly the machine count — still two orders of
 * magnitude below an uncapped flood, and much cheaper than a shared counter for
 * something that only needs to stop a stampede.
 */
export function createBurstLimiter(
  cap: number,
  windowMs: number,
): (key: number, now?: number) => { allowed: boolean; count: number } {
  const counts = new Map<number, { windowKey: number; count: number }>();
  return function claim(key, now = Date.now()) {
    const windowKey = Math.floor(now / windowMs);
    const entry = counts.get(key);
    if (!entry || entry.windowKey !== windowKey) {
      counts.set(key, { windowKey, count: 1 });
      return { allowed: true, count: 1 };
    }
    entry.count += 1;
    return { allowed: entry.count <= cap, count: entry.count };
  };
}

// A bulk lead import assigns deals one at a time, and `deal_assigned` fires per
// deal — so a runaway import turns into one email per deal per owner. (It has:
// a sheet sync posted ~1000 rows to the leads webhook and each teammate got
// ~180 emails.) Past this many assignment emails in an hour, stop emailing that
// person until the window rolls over.
//
// Only the EMAIL channel is capped. The in-app row still gets written every
// time, so the assignment is never lost — the bell is paginated and self-
// clearing, an inbox is neither.
const DEAL_ASSIGNED_EMAIL_CAP = 10;
const claimDealAssignedEmail = createBurstLimiter(DEAL_ASSIGNED_EMAIL_CAP, 60 * 60_000);

/**
 * Fan a notification out to every configured channel. Never throws. Returns
 * whether the recipient's own notification was **delivered** — the reminder
 * scheduler uses this to keep a reminder un-stamped (and retry it next scan)
 * when nothing personal got out, instead of silently dropping it. Events with
 * no enabled personal channel (no recipient, or every channel toggled off)
 * count as delivered (there is nothing to retry).
 *
 * Now that in-app is a channel, a successful in-app insert alone makes this
 * true — a failed email (or missing Slack config) no longer retries once the
 * row is durable and visible in the bell. Retrying would duplicate that row:
 * there is no per-channel delivery state to suppress it on a second pass.
 */
export async function notify(event: NotificationEvent): Promise<boolean> {
  try {
    const r = render(event);

    let recipient: { email: string; name: string } | null = null;
    let preferences: unknown = null;
    if (r.recipientId != null) {
      // Preferences live in a joined table, not on usersTable itself — a
      // left join so a recipient with no preferences row (the common case:
      // resetUserPreferences never ran, or they've never touched Settings)
      // still resolves the user rather than dropping the notification.
      const [u] = await db
        .select({
          email: usersTable.email,
          name: usersTable.name,
          preferences: userPreferencesTable.preferences,
        })
        .from(usersTable)
        .leftJoin(
          userPreferencesTable,
          eq(userPreferencesTable.userId, usersTable.id),
        )
        .where(eq(usersTable.id, r.recipientId));
      recipient = u ? { email: u.email, name: u.name } : null;
      preferences = u?.preferences ?? null;
    }
    const plan = plannedChannelsFor(event, preferences);

    // Two buckets: `sends` are deliveries to the recipient (they decide the
    // retry verdict), `sharedSends` is the team-pulse channel post (always
    // attempted, never a reason to retry a personal nudge).
    const sends: Promise<boolean>[] = [];
    const sharedSends: Promise<boolean>[] = [];
    if (r.inApp && recipient && plan.inApp) {
      // Gated on the RESOLVED `recipient`, not just r.recipientId != null:
      // notifications.user_id has a FK to users, so inserting for an id that
      // didn't resolve to a row would reject, make this channel's promise
      // reject, and (via deliveryVerdict) tell the reminder scheduler to
      // retry forever — the same infinite-retry shape already fixed for the
      // email channel below.
      sends.push(
        db
          .insert(notificationsTable)
          .values({
            userId: r.recipientId!,
            actorId: null, // scheduler/rule-driven; these events carry no actor
            type: r.inApp.type,
            message: r.inApp.message,
            entityType: r.inApp.entityType,
            entityId: r.inApp.entityId,
          })
          .then(() => true),
      );
    }
    // Burst guard, applied after preferences so it only ever suppresses mail
    // that was otherwise going out. Claimed lazily (&&) so the counter moves
    // only when an email would really have been sent.
    let emailAllowed = recipient != null && plan.email;
    if (emailAllowed && event.type === "deal_assigned") {
      const claim = claimDealAssignedEmail(event.userId);
      emailAllowed = claim.allowed;
      if (claim.count === DEAL_ASSIGNED_EMAIL_CAP + 1) {
        logger.warn(
          { userId: event.userId, cap: DEAL_ASSIGNED_EMAIL_CAP },
          "deal_assigned email cap reached — suppressing further assignment emails to this user this hour",
        );
      }
    }

    if (emailAllowed && recipient) {
      sends.push(
        sendNotificationEmail({
          to: recipient.email,
          subject: r.subject,
          heading: r.heading,
          bodyLines: r.bodyLines,
          ctaLabel: r.ctaLabel,
          ctaUrl: r.ctaUrl,
        }),
      );
    } else if (!recipient && !r.announcementOnly) {
      logger.warn({ event }, "Notification has no resolvable recipient — email skipped");
    }
    if (r.slackText) {
      const text = r.slackText(recipient?.name ?? null);
      // Team pulse: the shared announcements channel is not user-configurable
      // — it's a team pulse, not a personal inbox, so it's never gated by
      // preferences.
      sharedSends.push(sendSlackMessage(text));
      // Personal nudge: also DM the owner directly (reminders/overdue), so it
      // isn't only buried in the team channel. This DM IS the same personal
      // nudge as email, so it follows the email toggle (plan.slackDm), not a
      // separate preference. Needs the bot token to resolve the DM; skipped
      // best-effort otherwise.
      if (plan.slackDm && recipient) {
        sends.push(
          fireSlackMessages([
            { target: { kind: "email", email: recipient.email }, text },
          ]),
        );
      }
    }
    // Both buckets are still awaited together so no send is left dangling
    // (and no promise rejects unhandled); only `personal` feeds the verdict.
    const [personal, shared] = await Promise.all([
      Promise.allSettled(sends),
      Promise.allSettled(sharedSends),
    ]);
    return deliveryVerdict(personal, shared);
  } catch (err) {
    logger.error({ err, event }, "Notification dispatch failed");
    return false;
  }
}
