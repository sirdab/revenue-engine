import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response } from "express";
import { PgRateLimitStore } from "./rate-limit-store-pg";

const TOO_MANY = {
  error: "Too many attempts. Please wait a few minutes and try again.",
};

function emailIpKey(req: Request): string {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.toLowerCase().trim()
      : "";
  // ipKeyGenerator normalizes IPv6 addresses to a /64 subnet so attackers
  // cannot bypass limits by rotating through addresses in the same block.
  // The email is hashed because it is caller-supplied and the key is a
  // Postgres primary key: an oversized key fails the insert, and the store
  // fails open on error.
  const emailHash = createHash("sha256").update(email).digest("hex");
  return `${ipKeyGenerator(req.ip ?? "unknown")}:${emailHash}`;
}

// Brute-force protection per (IP + email) so a single account/IP pair cannot be
// hammered, while legitimate users sharing a network are not locked out.
// The three auth limiters keep their counters in Postgres (PgRateLimitStore):
// with the in-memory default the real limit is multiplied by the number of
// machines and reset by every deploy or idle stop.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore("login:"),
  keyGenerator: emailIpKey,
  message: TOO_MANY,
});

// Coarser per-IP cap to blunt password spraying across many accounts.
export const loginIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore("login-ip:"),
  message: TOO_MANY,
});

// Reset requests are far rarer than logins, so keep this tight.
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore("forgot:"),
  keyGenerator: emailIpKey,
  message: TOO_MANY,
});

// Uploads buffer the whole file in process memory (multer memoryStorage, up
// to MAX_FILE_SIZE_BYTES) before it ever reaches object storage, on a
// resource-constrained host -- cap concurrent/rapid uploads per user so one
// authenticated session cannot exhaust process memory. Keyed by user id
// (route is mounted below requireAuth) with an IP fallback for safety.
export const fileUploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request, res: Response) => {
    const user = res.locals.user as { id: number } | undefined;
    return user ? `user:${user.id}` : ipKeyGenerator(req.ip ?? "unknown");
  },
  message: { error: "Too many uploads. Please wait a few minutes and try again." },
});

// Analytics queries are the most expensive endpoint per call (aggregate scans
// over deals). A dashboard load fires one batched request, so the budget
// allows many full board loads per minute per user while blunting scripted
// hammering. Keyed by user id (mounted below requireAuth), IP fallback for
// safety. Counters live in Postgres (PgRateLimitStore) so the limit holds
// across autoscale instances and deploys — the in-memory default silently
// multiplies by the instance count.
export const insightsQueryRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore("insights:"),
  keyGenerator: (req: Request, res: Response) => {
    const user = res.locals.user as { id: number } | undefined;
    return user ? `user:${user.id}` : ipKeyGenerator(req.ip ?? "unknown");
  },
  message: { error: "Too many analytics queries. Please wait a moment and try again." },
});

// The assistant sits behind requireAuth, so key per authenticated user
// (falling back to IP if that's ever missing) rather than per-IP — one
// person's usage shouldn't throttle everyone else on the same network.
// Caps how fast one user can toggle notification subscriptions. Postgres-backed
// so the cap holds across instances. Sized loosely on purpose: saving a
// subscription must not 429 during ordinary use, so this only has to stop a
// loop.
export const notificationSubscribeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore("notif-subscribe:"),
  keyGenerator: (req: Request, res: Response) => {
    const user = res.locals.user as { id: number } | undefined;
    return user ? `user:${user.id}` : ipKeyGenerator(req.ip ?? "unknown");
  },
  message: {
    error: "Too many subscription changes. Please wait a minute.",
  },
});
