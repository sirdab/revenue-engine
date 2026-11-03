// Sentry initialization. This module is imported for its side effect as the
// FIRST line of src/index.ts — before Express/HTTP modules load — so Sentry's
// OpenTelemetry-based auto-instrumentation can patch them. ES import hoisting
// makes a plain initSentry() call in index.ts run too late, hence a
// side-effect module.
//
// Errors only: tracesSampleRate 0, no profiling, no replay. When SENTRY_DSN is
// unset (e.g. local dev) this is a complete no-op.
import * as Sentry from "@sentry/node";
import { logger } from "./logger";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
  logger.info("Sentry initialized");
} else {
  logger.debug("SENTRY_DSN not set; Sentry disabled");
}
