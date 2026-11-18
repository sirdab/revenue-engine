import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";

// End-to-end guard for the deal_assigned email cap, driving the REAL notify()
// rather than the limiter in isolation — the wiring (does the gate actually sit
// in front of the send?) is where a regression would hide, and the incident
// this cap exists for was caused by a guard that looked correct but never fired.
//
// notify() reaches a database and an SMTP transport, so those modules are
// mocked at the seam. Needs --experimental-test-module-mocks (set in the
// package's test script).

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

/** Subjects passed to sendNotificationEmail, in order. */
const emailed: string[] = [];
/** How many in-app notification rows were written. */
let inAppRows = 0;

before(() => {
  mock.module("drizzle-orm", {
    namedExports: { eq: () => ({}) },
  });

  mock.module("@workspace/db", {
    namedExports: {
      usersTable: { id: {}, email: {}, name: {} },
      userPreferencesTable: { userId: {}, preferences: {} },
      notificationsTable: {},
      db: {
        // notify() does: db.select({...}).from(t).leftJoin(t, on).where(cond)
        // and awaits the result directly (drizzle query builders are thenable).
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: async () => [
                { email: "owner@example.com", name: "Owner", preferences: null },
              ],
            }),
          }),
        }),
        // db.insert(t).values({...}).then(() => true)
        insert: () => ({
          values: async () => {
            inAppRows += 1;
          },
        }),
      },
    },
  });

  mock.module("./email.ts", {
    namedExports: {
      appBaseUrl: () => "https://app.test",
      APP_NAME: "CRM",
      sendNotificationEmail: async (p: { subject: string }) => {
        emailed.push(p.subject);
        return true;
      },
    },
  });

  mock.module("./slack.ts", {
    namedExports: {
      sendSlackMessage: async () => true,
      fireSlackMessages: async () => true,
      mrkdwnEscape: (s: string) => s,
    },
  });

  mock.module("./logger.ts", {
    namedExports: {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    },
  });
});

after(() => {
  mock.reset();
});

test("a 1000-deal import sends 10 assignment emails to a user, not 1000", async () => {
  const { notify } = await import("./notifications.ts");

  emailed.length = 0;
  inAppRows = 0;

  for (let i = 1; i <= 1000; i++) {
    await notify({
      type: "deal_assigned",
      dealId: i,
      dealTitle: `Store ${i} - 0555${i}`,
      userId: 4242,
    });
  }

  assert.equal(
    emailed.length,
    10,
    `expected the cap to hold at 10 emails, got ${emailed.length}`,
  );
  // The assignment is still recorded every time — only the email is capped.
  assert.equal(inAppRows, 1000, "every assignment should still write an in-app row");
});

test("the cap is per recipient — a flooded user does not silence their teammates", async () => {
  const { notify } = await import("./notifications.ts");

  emailed.length = 0;

  const flooded = 5001;
  for (let i = 0; i < 50; i++) {
    await notify({ type: "deal_assigned", dealId: i, dealTitle: "d", userId: flooded });
  }
  const afterFlood = emailed.length;

  await notify({ type: "deal_assigned", dealId: 999, dealTitle: "quiet", userId: 5002 });

  assert.equal(afterFlood, 10, "flooded user capped at 10");
  assert.equal(
    emailed.at(-1),
    "Deal assigned to you: quiet",
    "a different recipient still gets their email through",
  );
});

test("non-assignment notifications are not affected by the assignment cap", async () => {
  const { notify } = await import("./notifications.ts");

  emailed.length = 0;

  // Burn the assignment budget for this user first.
  for (let i = 0; i < 40; i++) {
    await notify({ type: "deal_assigned", dealId: i, dealTitle: "d", userId: 6001 });
  }
  emailed.length = 0;

  // A mention to the same user must still reach them.
  await notify({
    type: "mentioned",
    userId: 6001,
    actorName: "Naif",
    entityLabel: "a deal",
    path: "/deal/1",
  });

  assert.equal(emailed.length, 1, "a mention is not gated by the assignment cap");
});
