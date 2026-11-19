// Sentry initialization for the SPA. Errors only: no browser tracing, no
// session replay. When VITE_SENTRY_DSN is unset (dev, or DSN not configured)
// this is a complete no-op. The DSN is baked into the client bundle at build
// time via Vite's VITE_ prefix convention — a Sentry DSN is not a secret.
import * as Sentry from "@sentry/react";
import { isChunkLoadError } from "./chunk-reload";
import { isSessionExpiredError, isSessionExpiredEventException } from "./session-expiry";

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Drop stale-deploy chunk-load failures. They fire whenever a user has a
    // tab open across a deploy (the old hashed chunks are gone); the app
    // auto-reloads to recover (see chunk-reload.ts), so they're expected noise,
    // not actionable bugs — and they were paging us as high-priority alerts.
    beforeSend(event, hint) {
      if (isChunkLoadError(hint?.originalException)) return null;
      const value = event.exception?.values?.[0]?.value;
      if (isChunkLoadError(value)) return null;
      // An expired session's 401 is expected: the query/mutation cache sends
      // the user back to sign-in (see App.tsx). A mutateAsync caller that
      // doesn't catch still surfaces it as an unhandled rejection, which was
      // paging us as a high-priority ApiError.
      if (isSessionExpiredError(hint?.originalException)) return null;
      if (isSessionExpiredEventException(event.exception?.values?.[0]?.type, value)) {
        return null;
      }
      return event;
    },
  });
}
