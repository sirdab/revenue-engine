import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type SQL } from "drizzle-orm";

// A workspace's regional settings (Settings › Workspace): time zone, first day
// of the week, default currency, phone calling code and default language.
//
// Each is stored on `tenants` and may be NULL, meaning "the server default":
// APP_TIMEZONE and PHONE_COUNTRY_CODE when set, else UTC, Monday, USD, and
// whatever language the browser asks for. A workspace that never touches
// these therefore behaves exactly as it did before they existed.
//
// Request handling reads them synchronously (SQL builders, the rule
// evaluator, Ask AI's date maths), so they are loaded once when a request is
// bound to its tenant (`runInWorkspace`) and carried in AsyncLocalStorage next
// to the tenant scope. Outside any workspace (tests, system tasks) the server
// defaults apply.
//
// This module imports no database code, so the Ask AI date helpers that
// depend on it keep running in tests without DATABASE_URL. Loading, binding
// and saving live in workspace-settings.ts.

export type WeekStart = 0 | 1 | 6;
export type WorkspaceLocale = "en" | "ar";

export const WEEK_STARTS: readonly WeekStart[] = [6, 0, 1];
export const WORKSPACE_LOCALES: readonly WorkspaceLocale[] = ["en", "ar"];

/** What the workspace stored; null = use the server default. */
export interface StoredRegionalSettings {
  timezone: string | null;
  weekStart: WeekStart | null;
  defaultCurrency: string | null;
  phoneCountryCode: string | null;
  defaultLocale: WorkspaceLocale | null;
}

/** What actually applies: stored values with the server defaults filled in. */
export interface EffectiveRegionalSettings {
  timezone: string;
  weekStart: WeekStart;
  defaultCurrency: string;
  /** Digits only, or null when neither the workspace nor the server sets one. */
  phoneCountryCode: string | null;
  /** null: no workspace default; each member's browser decides. */
  defaultLocale: WorkspaceLocale | null;
  /** The currency the workspace chose itself, or null if it uses the default. */
  chosenCurrency: string | null;
}

export class RegionalSettingsError extends Error {}

// ---- Validation -------------------------------------------------------------

const SUPPORTED_ZONES = new Set<string>(["UTC", ...Intl.supportedValuesOf("timeZone")]);
const SUPPORTED_CURRENCIES = new Set<string>(Intl.supportedValuesOf("currency"));
// Zone names reach SQL as a quoted literal (see timeZoneSql); this shape rules
// out a quote or anything else that could escape it, even if a bad value were
// ever written to the column by hand.
const ZONE_SHAPE = /^[A-Za-z0-9_+\-/]+$/;

export function isValidTimeZone(zone: string): boolean {
  return ZONE_SHAPE.test(zone) && SUPPORTED_ZONES.has(zone);
}

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && SUPPORTED_CURRENCIES.has(code);
}

export function isValidPhoneCountryCode(code: string): boolean {
  return /^[1-9][0-9]{0,3}$/.test(code);
}

function asWeekStart(v: unknown): WeekStart | null {
  return v === 0 || v === 1 || v === 6 ? v : null;
}

function asLocale(v: unknown): WorkspaceLocale | null {
  return v === "en" || v === "ar" ? v : null;
}

// ---- Server defaults -------------------------------------------------------

/** APP_TIMEZONE if it names a real zone, else UTC. Read per call so tests can set it. */
export function serverTimeZone(): string {
  const env = process.env.APP_TIMEZONE?.trim();
  return env && isValidTimeZone(env) ? env : "UTC";
}

export function serverPhoneCountryCode(): string | null {
  const digits = (process.env.PHONE_COUNTRY_CODE ?? "").replace(/[^0-9]/g, "");
  return digits && isValidPhoneCountryCode(digits) ? digits : null;
}

export const DEFAULT_WEEK_START: WeekStart = 1;
export const DEFAULT_CURRENCY = "USD";

export function serverDefaults(): EffectiveRegionalSettings {
  return {
    timezone: serverTimeZone(),
    weekStart: DEFAULT_WEEK_START,
    defaultCurrency: DEFAULT_CURRENCY,
    phoneCountryCode: serverPhoneCountryCode(),
    defaultLocale: null,
    chosenCurrency: null,
  };
}

/**
 * Stored values (from a tenant row) as the API reports them. A value that
 * fails validation, which only a hand edit could produce, reads as unset
 * rather than breaking every query in the workspace.
 */
export function storedFromTenant(t: {
  timezone: string | null;
  weekStart: number | null;
  defaultCurrency: string | null;
  phoneCountryCode: string | null;
  defaultLocale: string | null;
}): StoredRegionalSettings {
  return {
    timezone: t.timezone && isValidTimeZone(t.timezone) ? t.timezone : null,
    weekStart: asWeekStart(t.weekStart),
    defaultCurrency: t.defaultCurrency && isValidCurrency(t.defaultCurrency) ? t.defaultCurrency : null,
    phoneCountryCode:
      t.phoneCountryCode && isValidPhoneCountryCode(t.phoneCountryCode) ? t.phoneCountryCode : null,
    defaultLocale: asLocale(t.defaultLocale),
  };
}

export function resolveEffective(stored: StoredRegionalSettings): EffectiveRegionalSettings {
  const d = serverDefaults();
  return {
    timezone: stored.timezone ?? d.timezone,
    weekStart: stored.weekStart ?? d.weekStart,
    defaultCurrency: stored.defaultCurrency ?? d.defaultCurrency,
    phoneCountryCode: stored.phoneCountryCode ?? d.phoneCountryCode,
    defaultLocale: stored.defaultLocale ?? d.defaultLocale,
    chosenCurrency: stored.defaultCurrency,
  };
}

// ---- Per-request context ----------------------------------------------------

export const regionalStorage = new AsyncLocalStorage<EffectiveRegionalSettings>();

/** The settings of the workspace this request is for (server defaults outside one). */
export function currentRegionalSettings(): EffectiveRegionalSettings {
  return regionalStorage.getStore() ?? serverDefaults();
}

export const currentTimeZone = (): string => currentRegionalSettings().timezone;
export const currentWeekStart = (): WeekStart => currentRegionalSettings().weekStart;
export const currentCurrency = (): string => currentRegionalSettings().defaultCurrency;
/**
 * The currency for a new amount that names none. The workspace's own choice
 * wins; until it makes one, the creating user's legacy default (a per-user
 * API field, USD unless set) applies, exactly as before workspace settings.
 */
export function currencyForNewAmount(userDefault: string | null | undefined): string {
  return currentRegionalSettings().chosenCurrency ?? userDefault ?? DEFAULT_CURRENCY;
}

export const currentPhoneCountryCode = (): string | null =>
  currentRegionalSettings().phoneCountryCode;

/**
 * The current workspace's time zone as a SQL string literal, for
 * `AT TIME ZONE`. Built raw (not a bound parameter) so Postgres can use it
 * inside expressions that appear in GROUP BY; safe because a zone always
 * passes isValidTimeZone first, and ZONE_SHAPE cannot contain a quote.
 */
export function timeZoneSql(): SQL {
  const zone = currentTimeZone();
  if (!ZONE_SHAPE.test(zone)) throw new Error(`Not a time zone name: ${zone}`);
  return sql.raw(`'${zone}'`);
}

/** Run `fn` with explicit settings, for tests. */
export function runWithRegionalSettings<T>(settings: EffectiveRegionalSettings, fn: () => T): T {
  return regionalStorage.run(settings, fn);
}

// ---- Sign-up presets -------------------------------------------------------

/**
 * What a new workspace starts with when the browser reports one of these
 * zones. Only places where the currency, calling code and working week are
 * unambiguous; every other zone sets the time zone alone. Admins change any
 * of it in Settings › Workspace.
 */
const REGION_PRESETS: Record<string, Omit<StoredRegionalSettings, "timezone" | "defaultLocale">> = {
  "Asia/Riyadh": { defaultCurrency: "SAR", phoneCountryCode: "966", weekStart: 0 },
  "Asia/Kuwait": { defaultCurrency: "KWD", phoneCountryCode: "965", weekStart: 0 },
  "Asia/Qatar": { defaultCurrency: "QAR", phoneCountryCode: "974", weekStart: 0 },
  "Asia/Bahrain": { defaultCurrency: "BHD", phoneCountryCode: "973", weekStart: 0 },
  "Asia/Muscat": { defaultCurrency: "OMR", phoneCountryCode: "968", weekStart: 0 },
  "Asia/Amman": { defaultCurrency: "JOD", phoneCountryCode: "962", weekStart: 0 },
  "Asia/Dubai": { defaultCurrency: "AED", phoneCountryCode: "971", weekStart: 1 },
};

/**
 * Regional settings for a new workspace from the sign-up page's language and
 * the browser's zone. Anything unknown is left unset (the server default),
 * never an error: sign-up must not fail over a browser quirk.
 */
export function signupRegionalSettings(input: {
  locale?: string | null;
  timezone?: string | null;
}): StoredRegionalSettings {
  const zone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  const known = zone !== "" && isValidTimeZone(zone);
  const preset = known ? REGION_PRESETS[zone] : undefined;
  return {
    timezone: known ? zone : null,
    weekStart: preset?.weekStart ?? null,
    defaultCurrency: preset?.defaultCurrency ?? null,
    phoneCountryCode: preset?.phoneCountryCode ?? null,
    defaultLocale: input.locale === "ar" ? "ar" : null,
  };
}
