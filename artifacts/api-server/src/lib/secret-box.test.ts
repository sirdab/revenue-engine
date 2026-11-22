import test from "node:test";
import assert from "node:assert/strict";
import { openSecret, sealSecret } from "./secret-box";

process.env.SESSION_SECRET = "test-session-secret";

test("a sealed secret opens to the original and does not contain it", () => {
  const sealed = sealSecret("sk-test-1234567890");
  assert.ok(!sealed.includes("sk-test"));
  assert.equal(openSecret(sealed), "sk-test-1234567890");
});

test("sealing twice gives different ciphertexts", () => {
  assert.notEqual(sealSecret("same"), sealSecret("same"));
});

test("a tampered or foreign value opens to null", () => {
  const sealed = sealSecret("sk-test");
  const parts = sealed.split(".");
  parts[3] = Buffer.from("other").toString("base64url");
  assert.equal(openSecret(parts.join(".")), null);
  assert.equal(openSecret("sk-plain-text"), null);

  process.env.SESSION_SECRET = "a-rotated-secret";
  try {
    assert.equal(openSecret(sealed), null);
  } finally {
    process.env.SESSION_SECRET = "test-session-secret";
  }
});
