import { eq, sql } from "drizzle-orm";
import { db, runAsSystem, runWithTenant, tenantsTable } from "@workspace/db";
import {
  isValidCurrency,
  isValidPhoneCountryCode,
  isValidTimeZone,
  regionalStorage,
  RegionalSettingsError,
  resolveEffective,
  serverDefaults,
  storedFromTenant,
  type EffectiveRegionalSettings,
  type StoredRegionalSettings,
  type WeekStart,
  type WorkspaceLocale,
} from "./regional-context";

// Loading, binding and saving a workspace's regional settings. The types,
// validation and the per-request context are in regional-context.ts (no
// database imports there); everything is re-exported from here.
export * from "./regional-context";

// Settings change rarely and every request needs them, so each process keeps
// them for a short while. A change made on one machine reaches the others
// within CACHE_MS; the machine that made it sees it at once.
const CACHE_MS = 30_000;
const cache = new Map<number, { value: EffectiveRegionalSettings; at: number }>();

export async function loadRegionalSettings(tenantId: number): Promise<EffectiveRegionalSettings> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const [row] = await runAsSystem(() =>
    db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)),
  );
  const value = row ? resolveEffective(storedFromTenant(row)) : serverDefaults();
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** Test seam, and what an update calls so its own machine sees the change at once. */
export function forgetRegionalSettings(tenantId?: number): void {
  if (tenantId == null) cache.clear();
  else cache.delete(tenantId);
}

/**
 * Bind `fn` to a workspace: its tenant scope (row-level security) and its
 * regional settings. Use wherever a request or job enters a tenant.
 */
export async function runInWorkspace<T>(tenantId: number, fn: () => T): Promise<T> {
  const settings = await loadRegionalSettings(tenantId);
  return runWithTenant(tenantId, () => regionalStorage.run(settings, fn));
}

// ---- Updates ---------------------------------------------------------------

export type RegionalSettingsUpdate = Partial<{
  timezone: string | null;
  weekStart: number | null;
  defaultCurrency: string | null;
  phoneCountryCode: string | null;
  defaultLocale: string | null;
}>;

/**
 * Validates an update (fields left out stay as they are; null or "" returns
 * a field to the server default) and returns the columns to write. The time
 * zone is also checked against Postgres's own zone list, so a name the
 * browser knows but the database doesn't can never reach a query.
 */
export async function validateRegionalUpdate(
  input: RegionalSettingsUpdate,
): Promise<Partial<StoredRegionalSettings>> {
  const out: Partial<StoredRegionalSettings> = {};
  const blank = (v: unknown) => v === null || v === "";

  if (input.timezone !== undefined) {
    if (blank(input.timezone)) out.timezone = null;
    else {
      const zone = String(input.timezone).trim();
      if (!isValidTimeZone(zone)) throw new RegionalSettingsError("Choose a time zone from the list.");
      const known = await runAsSystem(() =>
        db.execute(sql`select 1 from pg_timezone_names where name = ${zone} limit 1`),
      );
      if (known.rows.length === 0 && zone !== "UTC") {
        throw new RegionalSettingsError("That time zone isn't supported.");
      }
      out.timezone = zone;
    }
  }
  if (input.weekStart !== undefined) {
    if (input.weekStart === null) out.weekStart = null;
    else {
      const w = input.weekStart === 0 || input.weekStart === 1 || input.weekStart === 6 ? (input.weekStart as WeekStart) : null;
      if (w === null) throw new RegionalSettingsError("The week can start on Saturday, Sunday or Monday.");
      out.weekStart = w;
    }
  }
  if (input.defaultCurrency !== undefined) {
    if (blank(input.defaultCurrency)) out.defaultCurrency = null;
    else {
      const code = String(input.defaultCurrency).trim().toUpperCase();
      if (!isValidCurrency(code)) throw new RegionalSettingsError("Choose a currency from the list.");
      out.defaultCurrency = code;
    }
  }
  if (input.phoneCountryCode !== undefined) {
    if (blank(input.phoneCountryCode)) out.phoneCountryCode = null;
    else {
      const code = String(input.phoneCountryCode).trim().replace(/^\+/, "");
      if (!isValidPhoneCountryCode(code)) {
        throw new RegionalSettingsError("A calling code is 1 to 4 digits, like 966.");
      }
      out.phoneCountryCode = code;
    }
  }
  if (input.defaultLocale !== undefined) {
    if (blank(input.defaultLocale)) out.defaultLocale = null;
    else {
      const l = input.defaultLocale === "en" || input.defaultLocale === "ar" ? (input.defaultLocale as WorkspaceLocale) : null;
      if (l === null) throw new RegionalSettingsError("The default language is English or Arabic.");
      out.defaultLocale = l;
    }
  }
  return out;
}

/** Saves validated regional settings and makes this machine see them at once. */
export async function saveRegionalSettings(
  tenantId: number,
  changes: Partial<StoredRegionalSettings>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await runAsSystem(() => db.update(tenantsTable).set(changes).where(eq(tenantsTable.id, tenantId)));
  forgetRegionalSettings(tenantId);
}

/**
 * The workspace as the API returns it (Workspace in openapi.yaml): identity
 * plus the regional settings as stored and as they apply.
 */
export function toWorkspaceDto(t: {
  id: number;
  name: string;
  slug: string;
  timezone: string | null;
  weekStart: number | null;
  defaultCurrency: string | null;
  phoneCountryCode: string | null;
  defaultLocale: string | null;
}) {
  const regional = storedFromTenant(t);
  const { chosenCurrency: _chosen, ...effectiveRegional } = resolveEffective(regional);
  return { id: t.id, name: t.name, slug: t.slug, regional, effectiveRegional };
}
