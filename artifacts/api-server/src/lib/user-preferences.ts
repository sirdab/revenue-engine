import { eq, sql } from "drizzle-orm";
import { db, userPreferencesTable } from "@workspace/db";
import type { Tx } from "./change-events";

type JsonObject = { [key: string]: unknown };

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `patch` is attacker-controlled JSON (the raw PATCH body). Zod's fixed-shape
// object schema happens to strip a top-level "__proto__" key today, but this
// function has no such guarantee on its own — assigning into `result[key]`
// for key "__proto__" sets the object's actual prototype instead of an own
// property (JSON.parse gives "__proto__" as a normal own key, but bracket
// assignment still goes through the Object.prototype accessor). Block the
// standard prototype-pollution trio explicitly rather than depend on a
// caller's schema shape to keep this safe.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Deep-merges `patch` into `base`: nested objects merge recursively, arrays
// and scalars replace the existing value, and `null` deletes the key.
export function mergePreferences(base: unknown, patch: unknown): JsonObject {
  const result: JsonObject = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(patch)) return result;

  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (value === null) {
      delete result[key];
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergePreferences(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface PreferencesResult {
  preferences: JsonObject;
  resetEpoch: number;
}

async function selectPreferencesRow(
  executor: Tx | typeof db,
  userId: number,
): Promise<PreferencesResult> {
  const [row] = await executor
    .select({
      preferences: userPreferencesTable.preferences,
      resetEpoch: userPreferencesTable.resetEpoch,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId));
  return {
    preferences: isPlainObject(row?.preferences) ? row.preferences : {},
    resetEpoch: row?.resetEpoch ?? 0,
  };
}

export async function getUserPreferences(
  userId: number,
): Promise<PreferencesResult> {
  return selectPreferencesRow(db, userId);
}

// A PATCH computed before a reset (e.g. a debounced write still in flight on
// another tab/device when the user hits "reset" elsewhere) must not be
// allowed to silently resurrect old data on top of the wipe. mapError() in
// the route layer maps this to 409.
export class PreferencesResetConflictError extends Error {
  status = 409;
  constructor() {
    super(
      "Preferences were reset on another device since this change was computed",
    );
  }
}

// updateUserPreferences/resetUserPreferences both read-then-write the WHOLE
// document, and a fresh user has no row yet (so `.for("update")` can't lock
// anything not there to lock). Distinct advisory-lock namespace so concurrent
// reads/writes to the SAME user's preferences serialize (auto-released at
// txn commit/rollback, and it works the same whether the row exists yet or
// not) — a different user's key never contends. Mirrors the create-race lock
// in lib/pipeline-admin.ts.
const USER_PREFERENCES_LOCK_KEY = 918_273_501;

async function lockUserPreferences(tx: Tx, userId: number): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${USER_PREFERENCES_LOCK_KEY}, ${userId})`,
  );
}

export async function resetUserPreferences(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await lockUserPreferences(tx, userId);
    await tx
      .insert(userPreferencesTable)
      .values({ userId, preferences: {}, resetEpoch: 1 })
      .onConflictDoUpdate({
        target: userPreferencesTable.userId,
        set: {
          preferences: {},
          updated: new Date(),
          resetEpoch: sql`${userPreferencesTable.resetEpoch} + 1`,
        },
      });
  });
}

// `clientEpoch` is the resetEpoch the caller last saw (from a prior GET/PATCH
// response), sent via the X-Preferences-Reset-Epoch request header. Omit it
// (undefined) to skip the check — an older/untracked client that doesn't
// know about epochs still works exactly as before, just without this
// protection.
export async function updateUserPreferences(
  userId: number,
  patch: unknown,
  clientEpoch?: number,
): Promise<PreferencesResult> {
  return db.transaction(async (tx) => {
    await lockUserPreferences(tx, userId);
    const { preferences: current, resetEpoch } = await selectPreferencesRow(
      tx,
      userId,
    );
    if (clientEpoch !== undefined && clientEpoch !== resetEpoch) {
      throw new PreferencesResetConflictError();
    }
    const merged = mergePreferences(current, patch);
    const [row] = await tx
      .insert(userPreferencesTable)
      .values({ userId, preferences: merged })
      .onConflictDoUpdate({
        target: userPreferencesTable.userId,
        set: { preferences: merged, updated: new Date() },
      })
      .returning({
        preferences: userPreferencesTable.preferences,
        resetEpoch: userPreferencesTable.resetEpoch,
      });
    return {
      preferences: isPlainObject(row?.preferences) ? row.preferences : merged,
      resetEpoch: row?.resetEpoch ?? resetEpoch,
    };
  });
}
