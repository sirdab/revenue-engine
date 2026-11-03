import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetUserPreferencesResponse,
  UpdateUserPreferencesBody,
  UpdateUserPreferencesResponse,
} from "@workspace/api-zod";
import { currentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  getUserPreferences,
  resetUserPreferences,
  updateUserPreferences,
  PreferencesResetConflictError,
  type PreferencesResult,
} from "../lib/user-preferences";

const router: IRouter = Router();

// Namespaces are additive-only by convention (see the UserPreferences schema
// doc) — old stored documents are never rewritten on deploy — so a document
// saved under an earlier shape can, in principle, no longer match the
// current response schema. Responding with a raw `.parse()` would throw and
// 500 the request (with no error-handling middleware registered in app.ts to
// catch it); safeParse + fall back to the raw stored value instead, so one
// stale/incompatible field can't permanently break that user's read (GET) or
// every future write (PATCH re-validates the WHOLE merged document, not just
// the touched keys).
function respondWithPreferences(
  res: Response,
  userId: number,
  result: PreferencesResult,
  schema: typeof GetUserPreferencesResponse,
): void {
  const body = { ...result.preferences, resetEpoch: result.resetEpoch };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logger.error(
      { err: parsed.error, userId },
      "Stored preferences don't match the current schema (returning as-is)",
    );
    res.json(body);
    return;
  }
  res.json(parsed.data);
}

const RESET_EPOCH_HEADER = "x-preferences-reset-epoch";

// Missing/malformed header => undefined => updateUserPreferences skips the
// check entirely, so an older/untracked client that doesn't send this header
// keeps working exactly as before.
function parseClientResetEpoch(req: Request): number | undefined {
  const raw = req.header(RESET_EPOCH_HEADER);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function mapError(err: unknown, res: Response, log: string): void {
  if (err instanceof PreferencesResetConflictError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err }, log);
  res.status(500).json({ error: "Something went wrong." });
}

router.get("/user-preferences", async (_req, res): Promise<void> => {
  const user = currentUser(res);
  try {
    const result = await getUserPreferences(user.id);
    respondWithPreferences(res, user.id, result, GetUserPreferencesResponse);
  } catch (err) {
    mapError(err, res, "Failed to load user preferences");
  }
});

router.patch("/user-preferences", async (req, res): Promise<void> => {
  const parsed = UpdateUserPreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  try {
    const result = await updateUserPreferences(
      user.id,
      parsed.data,
      parseClientResetEpoch(req),
    );
    respondWithPreferences(
      res,
      user.id,
      result,
      UpdateUserPreferencesResponse,
    );
  } catch (err) {
    mapError(err, res, "Failed to update user preferences");
  }
});

router.delete("/user-preferences", async (_req, res): Promise<void> => {
  const user = currentUser(res);
  await resetUserPreferences(user.id);
  res.sendStatus(204);
});

export default router;
