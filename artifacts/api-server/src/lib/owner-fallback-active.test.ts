import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

// The body of a top-level `async function name(...)`, up to its closing brace
// at column 0.
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start > -1, `${name} should exist`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > -1, `${name} should have a closing brace`);
  return source.slice(start, end);
}

// Every users query in the body: from `.from(usersTable)` to its `.limit(`.
function userQueries(body: string): string[] {
  return body
    .split(".from(usersTable)")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf(".limit(")));
}

const ACTIVE = /eq\(usersTable\.activeFlag, true\)/;

// A long-deactivated admin can still be the lowest-id admin, so a "first
// admin" fallback would hand work to someone who no longer signs in. These
// fallbacks run where nobody is looking at the result, so each one must refuse
// an inactive user. They are DB queries with no seam to inject rows, hence a source-level pin.
describe("owner fallbacks only pick active users", () => {
  it("webhook owner resolution never returns a deactivated user", () => {
    const body = functionBody(read("./webhook-owner.ts"), "resolveOwner");
    const queries = userQueries(body);
    // The by-email lookup (payload ownerEmail and WEBHOOK_DEFAULT_OWNER_EMAIL
    // both go through it) and the last-resort admin.
    assert.equal(queries.length, 2);
    for (const q of queries) assert.match(q, ACTIVE);
    assert.ok(
      queries.some((q) => /eq\(usersTable\.isAdmin, true\)/.test(q)),
      "the last resort should still be an admin",
    );
  });
});
