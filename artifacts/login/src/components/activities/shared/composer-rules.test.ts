import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultType,
  missingForLog,
  retryInput,
  typeAfterSwitch,
  typesFor,
} from "./composer-rules.ts";

const DEAL = {
  all: ["call", "meeting", "email", "task", "deadline", "whatsapp"],
  contact: ["call", "meeting", "email", "whatsapp"],
};

test("logging offers contact types; planning offers every type", () => {
  assert.deepEqual(typesFor("log", DEAL), ["call", "meeting", "email", "whatsapp"]);
  assert.deepEqual(typesFor("plan", DEAL), DEAL.all);
});

test("each mode starts where it usually starts, unless the caller prefers", () => {
  assert.equal(defaultType("log", DEAL), "call");
  assert.equal(defaultType("plan", DEAL), "task");
  assert.equal(defaultType("log", DEAL, "whatsapp"), "whatsapp");
  // A preference the mode doesn't offer is ignored.
  assert.equal(defaultType("log", DEAL, "task"), "call");
});

test("switching mode keeps a type both modes offer", () => {
  assert.equal(typeAfterSwitch("call", "plan", DEAL), "call");
  assert.equal(typeAfterSwitch("task", "log", DEAL), "call");
});

test("a log needs its answer, and Replied needs text", () => {
  assert.equal(missingForLog({ contact: true, reply: null, noteEmpty: true, subjectTyped: false }), "reply");
  assert.equal(missingForLog({ contact: true, reply: "no_reply", noteEmpty: true, subjectTyped: false }), null);
  assert.equal(missingForLog({ contact: true, reply: "successful", noteEmpty: true, subjectTyped: false }), "response");
  assert.equal(missingForLog({ contact: true, reply: "successful", noteEmpty: false, subjectTyped: false }), null);
  assert.equal(missingForLog({ contact: false, reply: null, noteEmpty: true, subjectTyped: false }), "response");
  assert.equal(missingForLog({ contact: false, reply: null, noteEmpty: false, subjectTyped: false }), null);
  // A typed subject is enough of a response; it doesn't stand in for a note's text.
  assert.equal(missingForLog({ contact: true, reply: "successful", noteEmpty: true, subjectTyped: true }), null);
  assert.equal(missingForLog({ contact: false, reply: null, noteEmpty: true, subjectTyped: true }), "response");
});

test("a retry copies the job and its links, due on the chosen day", () => {
  assert.deepEqual(
    retryInput(
      {
        subject: "Call",
        type: "call",
        ownerId: 3,
        links: { deal: { id: 7, label: "Acme Foods" }, person: { id: 9, label: "Faisal" }, orgId: 2 },
      },
      "2026-10-04",
    ),
    { subject: "Call", type: "call", dueDate: "2026-10-04", ownerId: 3, dealId: 7, personId: 9, orgId: 2 },
  );
  assert.deepEqual(
    retryInput({ subject: "Meet", type: "meeting", ownerId: null }, "2026-10-05"),
    { subject: "Meet", type: "meeting", dueDate: "2026-10-05" },
  );
});
