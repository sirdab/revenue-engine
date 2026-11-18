import { randomBytes, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, appSettingsTable, runAsSystem } from "@workspace/db";

// Key/value helpers over the `app_settings` table (per-tenant config). Every
// read and write is scoped to the current tenant by row-level security.

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

export async function clearSetting(key: string): Promise<void> {
  await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key));
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: [appSettingsTable.tenantId, appSettingsTable.key],
      set: { value, updatedAt: new Date() },
    });
}

const WEBHOOK_SECRET_KEY = "webhook_secret";

export function generateSecret(): string {
  return `whk_${randomBytes(24).toString("base64url")}`;
}

// Current inbound-webhook secret, generating and persisting one on first read
// (so the admin Settings page always has a value to show).
export async function ensureWebhookSecret(): Promise<string> {
  const existing = await getSetting(WEBHOOK_SECRET_KEY);
  if (existing) return existing;
  const secret = generateSecret();
  await setSetting(WEBHOOK_SECRET_KEY, secret);
  return secret;
}

export async function getWebhookSecret(): Promise<string | null> {
  return getSetting(WEBHOOK_SECRET_KEY);
}

/**
 * The tenant whose inbound-webhook secret this is, or null. Inbound webhooks
 * carry no session, so the secret is what identifies the workspace; the
 * lookup runs in the system scope because no tenant is bound yet. Secrets are
 * 24 random bytes, so two workspaces can never share one.
 */
export async function tenantIdForWebhookSecret(
  presented: string,
): Promise<number | null> {
  const rows = await runAsSystem(() =>
    db
      .select({ tenantId: appSettingsTable.tenantId, value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(
        and(
          eq(appSettingsTable.key, WEBHOOK_SECRET_KEY),
          eq(appSettingsTable.value, presented),
        ),
      ),
  );
  const match = rows.find((r) => secretsMatch(presented, r.value));
  return match?.tenantId ?? null;
}

export async function rotateWebhookSecret(): Promise<string> {
  const secret = generateSecret();
  await setSetting(WEBHOOK_SECRET_KEY, secret);
  return secret;
}

/**
 * The shared secret an inbound webhook presented, from either header form.
 *
 * Shared by every unauthenticated-but-secret-checked receiver (the inbound
 * lead webhook in routes/webhooks.ts) so they cannot drift on which headers
 * they honour.
 */
export function presentedSecret(req: {
  headers: Record<string, unknown>;
}): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const x = req.headers["x-webhook-secret"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

// Constant-time comparison so a wrong secret can't be guessed by timing.
export function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
