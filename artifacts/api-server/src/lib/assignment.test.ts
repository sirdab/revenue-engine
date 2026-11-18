import { test } from "node:test";
import assert from "node:assert/strict";

// assignment.ts imports `db` from @workspace/db, whose pool construction
// throws synchronously if DATABASE_URL is unset — a placeholder satisfies
// that check without ever opening a connection (node-postgres connects
// lazily), same workaround as partner-detail.test.ts.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const { nextInRotation } = await import("./assignment.ts");

// Regression test: "all deals go to the same owner." The
// round-robin used to pick "whoever currently has the fewest open deals"
// (leastLoadedActiveMember), recomputed live on every assignment. A rule with
// takeoverOwned reassigns deals away from whoever the rule just picked as
// soon as their pipeline stage changes again, so that member's open-deal
// count never rises the way their teammates' do — the live computation kept
// re-picking the same person forever. nextInRotation replaces that with a
// persisted cursor: it advances unconditionally on every pick and has no way
// to get stuck re-selecting the same member.

test("nextInRotation cycles through all members before repeating", () => {
  const members = [15, 18, 22, 23];
  let cursor: number | null = null;
  const picks: number[] = [];
  for (let i = 0; i < members.length; i++) {
    cursor = nextInRotation(members, cursor);
    picks.push(cursor);
  }
  assert.deepEqual(picks, [15, 18, 22, 23]);
});

test("nextInRotation keeps advancing even when the same member is repeatedly 'least loaded'", () => {
  // The exact regression shape: member 18 gets picked, then some
  // unrelated process (a manual reassignment) removes his open deal — under
  // the old least-loaded logic he'd look least-loaded again immediately. The
  // rotation doesn't care: it just keeps moving past him regardless.
  const members = [15, 18, 22, 23];
  let cursor: number | null = null;
  const picks: number[] = [];
  for (let i = 0; i < 8; i++) {
    cursor = nextInRotation(members, cursor);
    picks.push(cursor);
  }
  assert.deepEqual(picks, [15, 18, 22, 23, 15, 18, 22, 23]);
});

test("nextInRotation restarts from the lowest id when the cursor is null", () => {
  assert.equal(nextInRotation([22, 15, 23], null), 15);
});

test("nextInRotation restarts from the lowest id when the cursor left the team", () => {
  // A deactivated/removed member's id no longer appears in memberIds — treat
  // like no cursor rather than throwing or getting stuck.
  assert.equal(nextInRotation([15, 22, 23], 18), 15);
});

test("nextInRotation wraps from the highest id back to the lowest", () => {
  assert.equal(nextInRotation([15, 18, 22, 23], 23), 15);
});

test("nextInRotation with a single member always returns that member", () => {
  assert.equal(nextInRotation([18], null), 18);
  assert.equal(nextInRotation([18], 18), 18);
});
