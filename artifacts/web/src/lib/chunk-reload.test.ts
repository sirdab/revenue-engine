import { test } from "node:test";
import assert from "node:assert/strict";

import { isChunkLoadError, shouldReloadForChunkError } from "./chunk-reload";

// isChunkLoadError — recognizes the "stale deploy" dynamic-import failures that
// browsers throw when a hashed chunk no longer exists on the server.
test("isChunkLoadError matches Chrome/Vite dynamic-import failure", () => {
  const err = new TypeError(
    "Failed to fetch dynamically imported module: https://crm.example.com/assets/deals-jOecISwL.js",
  );
  assert.equal(isChunkLoadError(err), true);
});

test("isChunkLoadError matches Firefox wording", () => {
  const err = new TypeError(
    "error loading dynamically imported module: https://x/assets/a.js",
  );
  assert.equal(isChunkLoadError(err), true);
});

test("isChunkLoadError matches Safari 'Importing a module script failed'", () => {
  const err = new TypeError("Importing a module script failed.");
  assert.equal(isChunkLoadError(err), true);
});

test("isChunkLoadError ignores unrelated errors", () => {
  assert.equal(isChunkLoadError(new TypeError("x is not a function")), false);
  assert.equal(isChunkLoadError(new Error("Network request failed")), false);
});

test("isChunkLoadError tolerates non-Error values", () => {
  assert.equal(isChunkLoadError(undefined), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError("Failed to fetch dynamically imported module"), true);
});

// shouldReloadForChunkError — guards the one-shot reload so a genuinely broken
// chunk (missing even on the newest build) cannot loop the page forever.
test("shouldReloadForChunkError reloads when no prior reload recorded", () => {
  assert.equal(shouldReloadForChunkError(null, 10_000), true);
});

test("shouldReloadForChunkError does not reload again within the cooldown", () => {
  // reloaded 5s ago, cooldown is 10s -> still cooling down
  assert.equal(shouldReloadForChunkError(5_000, 10_000), false);
});

test("shouldReloadForChunkError reloads again once cooldown has elapsed", () => {
  // reloaded 20s ago, cooldown is 10s -> a fresh deploy later is allowed to recover
  assert.equal(shouldReloadForChunkError(20_000, 30_000), true);
});

test("shouldReloadForChunkError ignores a garbage timestamp", () => {
  assert.equal(shouldReloadForChunkError(Number.NaN, 10_000), true);
});

// Regression: REVENUE-ENGINE-7 / REVENUE-ENGINE-P. When a stale chunk request
// was answered with index.html, Safari rejected the module on its MIME type
// rather than reporting a fetch failure. That wording wasn't recognized, so the
// error skipped the one-shot reload and crashed to the error boundary instead.
test("isChunkLoadError matches Safari's MIME-type rejection", () => {
  assert.equal(
    isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type.")),
    true,
  );
});

test("isChunkLoadError matches Chrome's MIME-type wording", () => {
  assert.equal(
    isChunkLoadError(
      new TypeError(
        'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
      ),
    ),
    true,
  );
});
