import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketOf,
  closedUnsuccessful,
  sortOpenFirst,
  statusOf,
} from "./activity-rules.ts";

const today = new Date(2026, 8, 30); // Wed 30 Sep 2026, local

test("status: done, no reply, overdue by date, today, upcoming", () => {
  assert.equal(statusOf({ done: true, dueDate: null }, today), "done");
  assert.equal(statusOf({ done: true, outcome: "successful", dueDate: null }, today), "done");
  assert.equal(statusOf({ done: true, outcome: "no_reply", dueDate: null }, today), "noReply");
  assert.equal(statusOf({ done: false, dueDate: "2026-09-29" }, today), "overdue");
  // Due today reads Today all day, whatever the time (decided: by date).
  assert.equal(statusOf({ done: false, dueDate: "2026-09-30" }, today), "today");
  assert.equal(statusOf({ done: false, dueDate: "2026-10-01" }, today), "planned");
  assert.equal(statusOf({ done: false, dueDate: null }, today), "planned");
});

test("buckets follow the status; a no-reply is done", () => {
  assert.equal(bucketOf({ done: true, outcome: "no_reply", dueDate: null }, today), "done");
  assert.equal(bucketOf({ done: false, dueDate: null }, today), "upcoming");
  assert.equal(bucketOf({ done: false, dueDate: "2026-09-01" }, today), "overdue");
});

test("open first by due date (undated last), then latest done first", () => {
  const rows = [
    { id: 1, done: true, dueDate: null, markedAsDoneTime: "2026-09-01T10:00:00Z" },
    { id: 2, done: false, dueDate: null },
    { id: 3, done: false, dueDate: "2026-10-05" },
    { id: 4, done: true, dueDate: null, markedAsDoneTime: "2026-09-20T10:00:00Z" },
    { id: 5, done: false, dueDate: "2026-09-01" },
  ];
  assert.deepEqual(sortOpenFirst(rows).map((r) => r.id), [5, 3, 2, 4, 1]);
});

test("only a success reads as completed work", () => {
  assert.equal(closedUnsuccessful({ done: true, outcome: "successful" }), false);
  assert.equal(closedUnsuccessful({ done: true, outcome: null }), false);
  assert.equal(closedUnsuccessful({ done: false, outcome: null }), false);
  assert.equal(closedUnsuccessful({ done: true, outcome: "no_reply" }), true);
});
