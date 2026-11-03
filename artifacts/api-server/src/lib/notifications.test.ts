import { test } from "node:test";
import assert from "node:assert/strict";

// notifications.ts imports `db` from @workspace/db, whose pool construction
// throws synchronously if DATABASE_URL is unset — a placeholder satisfies
// that check without ever opening a connection (node-postgres connects
// lazily), same workaround as assignment.test.ts / notification-subscriptions.test.ts.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const { inAppRowFor, plannedChannelsFor, deliveryVerdict, createBurstLimiter } = await import(
  "./notifications.ts",
);

// inAppRowFor is the pure row-builder behind notify()'s in-app channel. It is
// tested directly (rather than through notify()/a DB harness) because there
// is no DB isolation seam in this suite — see notification-subscriptions.test.ts.

test("deal_assigned builds an in-app row addressed to the deal", () => {
  const row = inAppRowFor({
    type: "deal_assigned",
    dealId: 99,
    dealTitle: "Acme HQ warehouse",
    userId: 7,
  });
  assert.deepEqual(row, {
    type: "assignment",
    message: "“Acme HQ warehouse” was assigned to you",
    entityType: "deal",
    entityId: 99,
  });
});

test("mentioned returns null — mentions.ts already inserts its own row, no duplicate", () => {
  const row = inAppRowFor({
    type: "mentioned",
    userId: 7,
    actorName: "Sara",
    entityLabel: "Acme HQ",
    path: "/deal/1",
  });
  assert.equal(row, null);
});

// deal_assigned reaches its owner in-app and by email only (no shared
// channel post, no DM). These plans pin how preferences gate it.
const assignedEvent = {
  type: "deal_assigned" as const,
  dealId: 1,
  dealTitle: "Acme HQ warehouse",
  userId: 7,
};

test("absent preferences send everything (Constraint 6: missing = on)", () => {
  const plan = plannedChannelsFor(assignedEvent, null);
  assert.deepEqual(plan, {
    email: true,
    inApp: true,
    slackChannel: false,
    slackDm: false,
  });
});

test("absent notifications namespace on an existing preferences doc still sends everything", () => {
  const plan = plannedChannelsFor(assignedEvent, { tables: {} });
  assert.deepEqual(plan, {
    email: true,
    inApp: true,
    slackChannel: false,
    slackDm: false,
  });
});

test("a category suppresses only its own channel — email off leaves in-app alone", () => {
  const plan = plannedChannelsFor(assignedEvent, {
    notifications: { assignment: { email: false } },
  });
  assert.equal(plan.email, false);
  assert.equal(plan.inApp, true);
});

test("a category suppresses only its own channel — inApp off leaves email and Slack alone", () => {
  const plan = plannedChannelsFor(assignedEvent, {
    notifications: { assignment: { inApp: false } },
  });
  assert.equal(plan.email, true);
  assert.equal(plan.inApp, false);
});

test("a suppressed category doesn't affect other categories", () => {
  const plan = plannedChannelsFor(assignedEvent, {
    notifications: { mention: { email: false, inApp: false } },
  });
  assert.deepEqual(plan, {
    email: true,
    inApp: true,
    slackChannel: false,
    slackDm: false,
  });
});

test("all channels off for the category leaves nothing to send", () => {
  const plan = plannedChannelsFor(assignedEvent, {
    notifications: { assignment: { email: false, inApp: false } },
  });
  assert.deepEqual(plan, {
    email: false,
    inApp: false,
    slackChannel: false,
    slackDm: false,
  });
});

test("a malformed stored value (string instead of boolean) reads as on, never silences a notification", () => {
  const plan = plannedChannelsFor(assignedEvent, {
    notifications: { assignment: { email: "off", inApp: 0 } },
  });
  assert.equal(plan.email, true);
  assert.equal(plan.inApp, true);
});

test("deal_assigned: all channels off yields an all-false plan", () => {
  // deal_assigned has no slackText (no channel announcement, see render()),
  // so with every channel off, plannedChannelsFor returns every field false.
  // In notify(), that means `sends` stays empty and it returns `true` early
  // ("nothing to send counts as delivered") — if it returned `false` instead,
  // a caller retrying on failure would retry the same event forever even
  // though the user deliberately muted every channel for this category.
  const dealAssignedEvent = {
    type: "deal_assigned" as const,
    dealId: 1,
    dealTitle: "Acme HQ warehouse",
    userId: 7,
  };
  const plan = plannedChannelsFor(dealAssignedEvent, {
    notifications: { assignment: { email: false, inApp: false } },
  });
  assert.deepEqual(plan, {
    email: false,
    inApp: false,
    slackChannel: false,
    slackDm: false,
  });
});

test("mentioned: email follows the mention preference, but inApp is always false — mentions.ts owns that row, not notify()", () => {
  const mentionEvent = {
    type: "mentioned" as const,
    userId: 7,
    actorName: "Sara",
    entityLabel: "Acme HQ",
    path: "/deal/1",
  };
  const allOn = plannedChannelsFor(mentionEvent, null);
  assert.equal(allOn.email, true);
  assert.equal(allOn.inApp, false);

  const emailOff = plannedChannelsFor(mentionEvent, {
    notifications: { mention: { email: false } },
  });
  assert.equal(emailOff.email, false);
  assert.equal(emailOff.inApp, false);

  // Even explicitly turning "on" the mention in-app toggle changes nothing —
  // that preference is honestly inert for this event.
  const inAppOn = plannedChannelsFor(mentionEvent, {
    notifications: { mention: { inApp: true } },
  });
  assert.equal(inAppOn.inApp, false);
});

test("deal_won is unaffected by preferences — no recipient, no category", () => {
  const dealWonEvent = {
    type: "deal_won" as const,
    dealId: 1,
    dealTitle: "Acme HQ warehouse",
    value: 100000,
    currency: "SAR",
    actorName: "Sara",
  };
  const plan = plannedChannelsFor(dealWonEvent, {
    notifications: {
      reminder: { email: false },
      overdue: { email: false },
      assignment: { email: false },
      mention: { email: false },
    },
  });
  assert.deepEqual(plan, {
    email: false, // no recipient at all, so nothing to gate
    inApp: false,
    slackChannel: true,
    slackDm: false,
  });
});

// deliveryVerdict — the pure retry decision behind notify()'s boolean. The
// reminder scheduler releases its claim stamp (and re-scans every 60s) when
// this is false, so these cases pin the exact loop condition.

const ok = (value: boolean): PromiseSettledResult<boolean> => ({
  status: "fulfilled",
  value,
});
const threw: PromiseSettledResult<boolean> = {
  status: "rejected",
  reason: new Error("boom"),
};

test("every personal channel off + shared channel fails → delivered (no retry loop)", () => {
  // The live bug: prefs {email:false,inApp:false} left only the ungated
  // announcements post, which returns false when Slack is unconfigured —
  // and the reminder re-scanned forever.
  assert.equal(deliveryVerdict([], [ok(false)]), true);
});

test("every personal channel off + shared channel succeeds → delivered", () => {
  assert.equal(deliveryVerdict([], [ok(true)]), true);
});

test("enabled email fails with nothing else enabled → not delivered (still retried)", () => {
  assert.equal(deliveryVerdict([ok(false)], [ok(true)]), false);
  assert.equal(deliveryVerdict([threw], [ok(true)]), false);
});

test("an enabled channel succeeding → delivered even if the others fail", () => {
  assert.equal(deliveryVerdict([ok(false), ok(true)], [ok(false)]), true);
  assert.equal(deliveryVerdict([threw, ok(true)], []), true);
});

test("a successful shared post never rescues a failed personal channel", () => {
  // Guards the over-correction: the team pulse going out is not evidence the
  // recipient was reached.
  assert.equal(deliveryVerdict([ok(false)], [ok(true), ok(true)]), false);
});

// createBurstLimiter backs the deal_assigned email cap — the guard against a
// bulk import turning one-email-per-deal into an inbox flood. Tested with an
// injected clock so the hour boundary is exercised without waiting for one.

test("burst limiter allows exactly cap claims inside one window", () => {
  const claim = createBurstLimiter(3, 1000);
  assert.deepEqual(claim(7, 0), { allowed: true, count: 1 });
  assert.deepEqual(claim(7, 10), { allowed: true, count: 2 });
  assert.deepEqual(claim(7, 20), { allowed: true, count: 3 });
  assert.deepEqual(claim(7, 30), { allowed: false, count: 4 });
});

test("burst limiter keeps counting past the cap so the trip point is detectable", () => {
  // notify() logs exactly once, when count hits cap + 1 — that relies on the
  // count continuing to climb rather than saturating.
  const claim = createBurstLimiter(2, 1000);
  claim(1, 0);
  claim(1, 0);
  assert.equal(claim(1, 0).count, 3);
  assert.equal(claim(1, 0).count, 4);
});

test("burst limiter counts each key independently", () => {
  // One teammate hitting the cap must not silence anyone else's assignments.
  const claim = createBurstLimiter(1, 1000);
  assert.equal(claim(1, 0).allowed, true);
  assert.equal(claim(1, 0).allowed, false);
  assert.equal(claim(2, 0).allowed, true);
});

test("burst limiter resets when the window rolls over", () => {
  const claim = createBurstLimiter(1, 1000);
  assert.equal(claim(5, 0).allowed, true);
  assert.equal(claim(5, 999).allowed, false);
  assert.equal(claim(5, 1000).allowed, true, "next window starts fresh");
});
