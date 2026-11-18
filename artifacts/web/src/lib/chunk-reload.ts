// Recovering from stale-deploy chunk failures.
//
// Route chunks are lazy-loaded with content-hashed filenames. When a new build
// ships, the old hashed files are removed from the server, so a browser tab
// opened before the deploy throws "Failed to fetch dynamically imported module"
// the moment it tries to load a not-yet-downloaded route. The user isn't hitting
// a bug — their page just points at files that no longer exist.
//
// A single full-page reload fixes it: the fresh index.html references the new
// hashes. We guard the reload against a genuinely-broken chunk (missing even on
// the newest build) so a hard failure can't loop the page forever.

import { lazy, type ComponentType } from "react";

const RELOAD_MARKER_KEY = "chunk-reload-at";

// Don't reload more than once inside this window. If a fresh load still can't
// fetch the chunk, it's a real failure — surface the error boundary instead of
// looping. A later deploy (past the cooldown) is allowed to recover again.
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * True when `err` is a dynamic-import ("chunk load") failure — the stale-deploy
 * symptom, not an app bug. Wording varies by browser, so match the known
 * phrasings loosely. Shared by the lazy wrapper and Sentry's beforeSend.
 */
export function isChunkLoadError(err: unknown): boolean {
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : "";
  if (!message) return false;
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    // A stale chunk request that reaches the SPA fallback comes back as
    // index.html with a 200 rather than a 404, so the browser rejects it on
    // content type instead of reporting a failed fetch. The server no longer
    // does that (see shouldServeSpaShell), but a CDN or proxy in front of it
    // can produce the same shape, and tabs opened before that fix ships still
    // hit it — this keeps such a load a recoverable reload, not a crash.
    /is not a valid javascript mime type/i.test(message) ||
    /expected a javascript.*module script but the server responded with a mime type of/i.test(
      message,
    )
  );
}

/**
 * Decide whether to trigger the one-shot reload, given when we last reloaded
 * (epoch ms, or null if never) and the current time (epoch ms). Pure so the
 * guard is unit-testable without touching window/storage.
 */
export function shouldReloadForChunkError(
  lastReloadAt: number | null,
  now: number,
): boolean {
  if (lastReloadAt === null || Number.isNaN(lastReloadAt)) return true;
  return now - lastReloadAt >= RELOAD_COOLDOWN_MS;
}

function readLastReloadAt(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_MARKER_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    // sessionStorage can throw (privacy mode, disabled). Treat as "never".
    return null;
  }
}

/**
 * If `err` is a chunk-load failure and we haven't just reloaded, reload the
 * page once and return true (caller should stop). Otherwise return false and
 * let the error propagate to the error boundary. Never reloads when we can't
 * persist the marker — reloading without a way to remember it would loop.
 */
export function reloadOnChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;

  const now = Date.now();
  const lastReloadAt = readLastReloadAt();
  if (!shouldReloadForChunkError(lastReloadAt, now)) return false;

  // Bail if storage is unavailable — we couldn't remember the reload, so we'd
  // reload forever.
  let persisted = false;
  try {
    window.sessionStorage.setItem(RELOAD_MARKER_KEY, String(now));
    persisted = true;
  } catch {
    persisted = false;
  }
  if (!persisted) return false;

  window.location.reload();
  return true;
}

/**
 * Drop-in for React.lazy that auto-recovers from stale-deploy chunk failures:
 * on a chunk-load error it reloads the page once instead of falling through to
 * the error boundary. Any other error propagates unchanged.
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    loader().catch((err) => {
      if (reloadOnChunkError(err)) {
        // Reload is underway; hand back a never-resolving promise so React
        // keeps showing the Suspense fallback until the navigation happens.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }),
  );
}
