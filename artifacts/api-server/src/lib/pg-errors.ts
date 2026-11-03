import type { ErrorRequestHandler } from "express";
import { logger } from "./logger";

// Postgres errors that mean the REQUEST was bad, not the server: an id that
// points at nothing, a date that doesn't exist (2026-02-30), a number too big
// for its column, text where a number or enum belongs. Routes validate shapes
// with the generated Zod schemas, but those can't know which ids exist or that
// February has no 30th, so these reach the database and used to come back as
// a generic 500. Mapped here once, in one error handler, instead of a
// try/catch in every route.

export interface ClientDbError {
  status: 400 | 409;
  error: string;
}

// SQLSTATEs (https://www.postgresql.org/docs/current/errcodes-appendix.html).
const INVALID_INPUT: Record<string, string> = {
  "22007": "Invalid date or time.", // invalid_datetime_format
  "22008": "Invalid date or time.", // datetime_field_overflow (e.g. Feb 30)
  "22003": "A number is out of range.", // numeric_value_out_of_range
  "22P02": "A value has the wrong format.", // invalid_text_representation
};

interface PgLike {
  code?: unknown;
  detail?: unknown;
}

// The pg error arrives directly, or wrapped as `cause` by drizzle.
function pgError(err: unknown): PgLike | null {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (e && typeof e === "object" && typeof (e as PgLike).code === "string") {
      return e as PgLike;
    }
  }
  return null;
}

/** The client-facing error a database error stands for, or null for a real server error. */
export function clientErrorFromDb(err: unknown): ClientDbError | null {
  const pg = pgError(err);
  if (!pg) return null;
  const code = pg.code as string;
  const detail = typeof pg.detail === "string" ? pg.detail : "";

  if (code === "23503") {
    // foreign_key_violation, in one of two directions.
    if (detail.includes("is still referenced")) {
      return {
        status: 409,
        error: "This record is still referenced by other records.",
      };
    }
    // `Key (owner_id)=(99999) is not present in table "users".`
    const m = /^Key \(([^)]+)\)=\(([^)]*)\) is not present/.exec(detail);
    return {
      status: 400,
      error: m
        ? `${m[1]} ${m[2]} does not exist.`
        : "A referenced record does not exist.",
    };
  }
  const message = INVALID_INPUT[code];
  return message ? { status: 400, error: message } : null;
}

/**
 * Router-level error handler: answers the client-input database errors above
 * with a 4xx and passes everything else on to the app's 500 handler.
 */
export const dbClientErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const mapped = clientErrorFromDb(err);
  if (!mapped || res.headersSent) return next(err);
  logger.warn(
    { err, method: req.method, path: req.path },
    "Request rejected by a database constraint",
  );
  res.status(mapped.status).json({ error: mapped.error });
};
