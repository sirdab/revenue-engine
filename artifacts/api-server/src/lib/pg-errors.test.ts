import { test } from "node:test";
import assert from "node:assert/strict";

// pg-errors imports the logger only; no DATABASE_URL needed.
const { clientErrorFromDb } = await import("./pg-errors.ts");

const pg = (code: string, detail?: string) =>
  Object.assign(new Error("db"), { code, detail });

test("an id that points at nothing is a 400 naming the column", () => {
  assert.deepEqual(
    clientErrorFromDb(
      pg("23503", 'Key (owner_id)=(99999) is not present in table "users".'),
    ),
    { status: 400, error: "owner_id 99999 does not exist." },
  );
});

test("deleting a row something still points at is a 409", () => {
  const mapped = clientErrorFromDb(
    pg("23503", 'Key (id)=(7) is still referenced from table "files".'),
  );
  assert.equal(mapped?.status, 409);
});

test("impossible dates, bad formats and out-of-range numbers are 400s", () => {
  for (const code of ["22007", "22008", "22003", "22P02"]) {
    assert.equal(clientErrorFromDb(pg(code))?.status, 400, code);
  }
});

test("drizzle's wrapped error is unwrapped via cause", () => {
  const wrapped = Object.assign(new Error("Failed query"), {
    cause: pg("22008"),
  });
  assert.equal(clientErrorFromDb(wrapped)?.status, 400);
});

test("everything else is left to the 500 handler", () => {
  assert.equal(clientErrorFromDb(pg("40001")), null); // serialization failure
  assert.equal(clientErrorFromDb(pg("23505")), null); // unique violation
  assert.equal(clientErrorFromDb(new Error("boom")), null);
  assert.equal(clientErrorFromDb(null), null);
});
