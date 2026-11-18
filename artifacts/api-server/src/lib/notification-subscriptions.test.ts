import { test } from "node:test";
import assert from "node:assert/strict";

// notification-subscriptions.ts imports `db` from @workspace/db, whose pool
// construction throws synchronously if DATABASE_URL is unset — a placeholder
// satisfies that check without ever opening a connection (node-postgres
// connects lazily), same workaround as assignment.test.ts.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const {
  recipientsFor,
  resolveParams,
  renderNotificationMessage,
  isNotificationParamKey,
} = await import("./notification-subscriptions.ts");

// A minimal stand-in for the drizzle query builder: enough chaining to satisfy
// recipientsFor, returning whatever rows the test hands it, and recording
// whether it was reached at all. `queried` is the interesting assertion for the
// short-circuit cases — a stub that is never touched proves the function
// decided "nobody" without a round trip.
function txStub(rows: Array<{ userId: number; params: unknown }> = []) {
  const state = { queried: false };
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => {
      state.queried = true;
      return Promise.resolve(rows);
    },
  };
  return { tx: chain as never, state };
}

// ---------------------------------------------------------------------------
// The filter chain. Every drop here is silent if it regresses: a notification
// simply arrives that should not have, or fails to arrive, with no error
// anywhere. That is why they are asserted directly rather than left to the
// integration surface.
// ---------------------------------------------------------------------------

test("an unowned record notifies nobody, without querying", async () => {
  const { tx, state } = txStub([{ userId: 7, params: null }]);
  const out = await recipientsFor(tx, 1, null, 42);
  assert.deepEqual(out, []);
  assert.equal(
    state.queried,
    false,
    "an unowned deal has no possible recipient — it must not hit the database",
  );
});

test("the actor is never notified about a record they own", async () => {
  // The single most common shape in the app: you edit your own deal. Notifying
  // yourself here makes the bell worthless within a day of shipping.
  const { tx, state } = txStub([{ userId: 42, params: null }]);
  const out = await recipientsFor(tx, 1, 42, 42);
  assert.deepEqual(out, []);
  assert.equal(state.queried, false, "owner-is-actor short-circuits");
});

test("an owner who is not the actor is a recipient", async () => {
  // No subscription is involved any more: automation alerts are on for
  // everyone, so params are always null and the owner is the recipient.
  const { tx, state } = txStub([{ userId: 7, params: { days: 30 } }]);
  const out = await recipientsFor(tx, 1, 7, 42);
  assert.equal(state.queried, true);
  assert.deepEqual(out, [{ userId: 7, params: null }]);
});

test("a deactivated owner is nobody", async () => {
  // The query filters on active_flag, so a deactivated owner comes back as no
  // rows — the one remaining way an owned record notifies nobody.
  const { tx } = txStub([]);
  assert.deepEqual(await recipientsFor(tx, 1, 7, 42), []);
});

test("a null actor excludes nobody", async () => {
  // Inbound webhook / import writes have no CRM user behind them, so there is
  // no one to exclude. The owner still gets notified.
  const { tx } = txStub([{ userId: 7, params: null }]);
  assert.deepEqual(await recipientsFor(tx, 1, 7, null), [
    { userId: 7, params: null },
  ]);
});

test("absent params normalize to null rather than undefined", async () => {
  // The row shape reaches the message renderer; undefined would spread into the
  // params scope and render "undefined" into someone's notification.
  const { tx } = txStub([{ userId: 7, params: undefined }]);
  const out = await recipientsFor(tx, 1, 7, 42);
  assert.deepEqual(out, [{ userId: 7, params: null }]);
});

// ---------------------------------------------------------------------------
// Per-user tuning. jsonb carries no constraints, so the run-time re-check is
// the only thing standing between a stale or malformed subscription and a
// nonsense notification.
// ---------------------------------------------------------------------------

test("only keys the rule declares tunable survive", async () => {
  // Narrowing a rule's tunable list must not leak the value a subscriber set
  // while it was still tunable.
  const out = resolveParams(
    { message: "x", tunable: [] },
    { days: 30 },
  );
  assert.deepEqual(out, {}, "rule declares nothing tunable");

  const kept = resolveParams({ message: "x", tunable: ["days"] }, { days: 14 });
  assert.deepEqual(kept, { days: 14 });
});

test("a non-numeric days value is dropped, not rendered as NaN", async () => {
  const out = resolveParams(
    { message: "x", tunable: ["days"] },
    { days: "soon" },
  );
  assert.deepEqual(out, {});
});

test("a numeric string days value is coerced", async () => {
  // A JSON body can legitimately carry "30"; coercing beats rejecting.
  assert.deepEqual(
    resolveParams({ message: "x", tunable: ["days"] }, { days: "30" }),
    { days: 30 },
  );
});

test("a null days value is dropped", async () => {
  assert.deepEqual(
    resolveParams({ message: "x", tunable: ["days"] }, { days: null }),
    {},
  );
});

test("absent params with a tunable rule yields no params", async () => {
  assert.deepEqual(resolveParams({ message: "x", tunable: ["days"] }, null), {});
});

test("isNotificationParamKey gates unknown keys", () => {
  assert.equal(isNotificationParamKey("days"), true);
  assert.equal(isNotificationParamKey("weeks"), false);
});

// ---------------------------------------------------------------------------
// Message rendering. Shares the placeholder allowlist with the Slack renderer
// but must NOT share its mrkdwn escaping.
// ---------------------------------------------------------------------------

test("placeholders resolve from their scope", () => {
  const out = renderNotificationMessage("{{deal.title}} moved to {{deal.stage}}", {
    deal: { title: "Northwind", stage: "Negotiation" },
  });
  assert.equal(out, "Northwind moved to Negotiation");
});

test("a subscriber's own tuning renders from the params scope", () => {
  const out = renderNotificationMessage("Follow up in {{params.days}} days", {
    params: { days: 14 },
  });
  assert.equal(out, "Follow up in 14 days");
});

test("values are NOT mrkdwn-escaped", () => {
  // The Slack renderer escapes & < > so a deal titled "<!channel>" cannot
  // inject a broadcast ping. In-app notifications render as React text, which
  // escapes on its own, so escaping here would show "A &amp; B" to the user.
  const out = renderNotificationMessage("{{deal.title}}", {
    deal: { title: "A & B <Ltd>" },
  });
  assert.equal(out, "A & B <Ltd>");
});

test("unknown placeholders render blank rather than leaking a column", () => {
  // The allowlist is the reason a template can never surface an arbitrary
  // column; `password` is not in TEMPLATE_FIELDS.deal so it must not resolve
  // even when the scope object happens to carry it.
  const out = renderNotificationMessage("[{{deal.password}}]", {
    deal: { password: "hunter2" },
  });
  assert.equal(out, "[]");
});

test("an unknown scope renders blank", () => {
  assert.equal(renderNotificationMessage("[{{secret.key}}]", {}), "[]");
});

test("whitespace inside braces is tolerated", () => {
  assert.equal(
    renderNotificationMessage("{{ deal.title }}", { deal: { title: "X" } }),
    "X",
  );
});

test("a null value renders blank, not the string null", () => {
  assert.equal(
    renderNotificationMessage("[{{deal.title}}]", { deal: { title: null } }),
    "[]",
  );
});
