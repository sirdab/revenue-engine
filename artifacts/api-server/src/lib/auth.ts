import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction, CookieOptions } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days

// Reset links are short-lived and single-use.
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

// In production the app and API are served same-origin, so `SameSite=Lax` gives
// CSRF protection on the mutating auth endpoints. In development the workspace
// preview embeds the app in a cross-site iframe, which only sends cookies marked
// `SameSite=None; Secure` — without that the browser drops the session cookie on
// every request after login.
const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  signed: true,
  sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
  secure: true,
  path: "/",
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, "hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  if (keyBuffer.length !== derived.length) return false;
  return timingSafeEqual(keyBuffer, derived);
}

// A well-formed hash no password matches, verified against when the account is
// missing or inactive so that login pays for scrypt either way and its timing
// does not reveal which emails have accounts. The salt and key are the same
// shape hashPassword writes, so the comparison runs the identical path.
const DUMMY_PASSWORD_HASH = `${"0".repeat(32)}:${"0".repeat(KEY_LENGTH * 2)}`;

/** verifyPassword for a user row that may be absent; always runs scrypt. */
export async function verifyPasswordOrDummy(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const ok = await verifyPassword(password, stored ?? DUMMY_PASSWORD_HASH);
  return ok && Boolean(stored);
}

/**
 * Enforces a baseline production password policy. Returns an error message when
 * the password is too weak, or null when it is acceptable.
 */
export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must contain at least one letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sessions
//
// The session cookie carries `${userId}.${passwordChangedEpoch}`. Baking the
// password-change timestamp into the cookie lets us revoke every existing
// session the moment a password is reset or changed by an admin: any cookie
// minted before the change no longer matches the user's current epoch.
// ---------------------------------------------------------------------------

function sessionEpoch(passwordChangedAt: Date | null | undefined): number {
  // Millisecond precision so a password change in the same second as a freshly
  // minted session still invalidates that older session.
  return passwordChangedAt ? passwordChangedAt.getTime() : 0;
}

export function setSessionCookie(
  res: Response,
  userId: number,
  passwordChangedAt: Date | null | undefined,
): void {
  const value = `${userId}.${sessionEpoch(passwordChangedAt)}`;
  res.cookie(SESSION_COOKIE, value, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
}

interface SessionData {
  id: number;
  epoch: number;
}

function getSession(req: Request): SessionData | null {
  const raw = req.signedCookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const [idStr, epochStr] = String(raw).split(".");
  const id = parseInt(idStr ?? "", 10);
  if (Number.isNaN(id)) return null;
  const epoch = parseInt(epochStr ?? "", 10);
  return { id, epoch: Number.isNaN(epoch) ? 0 : epoch };
}

// ---------------------------------------------------------------------------
// Password reset tokens
//
// Only the SHA-256 hash of a token is ever stored, so a leak of the database
// cannot be used to reset passwords. The raw token is emailed to the user once.
// ---------------------------------------------------------------------------

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function createResetToken(): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(32).toString("hex");
  return {
    raw,
    hash: hashResetToken(raw),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  };
}

// A readable, strong temporary password. Excludes ambiguous characters and is
// guaranteed to satisfy validatePasswordStrength (contains a letter and a digit).
export function generateTempPassword(length = 14): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = randomBytes(length);
  const chars = Array.from(bytes, (b) => all[b % all.length]);
  // Force the first char to a letter and the last to a digit.
  const fix = randomBytes(2);
  chars[0] = letters[fix[0] % letters.length];
  chars[chars.length - 1] = digits[fix[1] % digits.length];
  return chars.join("");
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export type SafeUser = Omit<User, "passwordHash" | "passwordChangedAt">;

export function toSafeUser(user: User): SafeUser {
  const {
    passwordHash: _passwordHash,
    passwordChangedAt: _passwordChangedAt,
    ...safe
  } = user;
  return safe;
}

export async function loadUser(id: number): Promise<User | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  return user ?? null;
}

export function currentUser(res: Response): SafeUser {
  return res.locals.user as SafeUser;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const session = getSession(req);
  if (session == null) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await loadUser(session.id);
  if (!user || !user.activeFlag) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (sessionEpoch(user.passwordChangedAt) !== session.epoch) {
    // Password changed since this session was issued: force re-auth.
    clearSessionCookie(res);
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.locals.user = toSafeUser(user);
  next();
}

export function requireAdmin(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = res.locals.user as SafeUser | undefined;
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
