// Pure helpers for reading/writing dotted paths into the user-preferences
// JSON document, plus the one-time legacy localStorage -> server migration
// table. Kept dependency-free (no React) so it's trivial to unit-reason-about
// and reuse from both the hook layer and the migration effect.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// No legitimate preference path segment is ever "__proto__"/"constructor"/
// "prototype" — every real path in this file is a developer-written literal.
// Guarded anyway since these are shared, exported utilities operating on the
// server's jsonb document: bracket-assigning into one of these keys sets an
// object's actual prototype rather than an own property (see the matching
// guard in the backend's mergePreferences), and a utility this general
// shouldn't rely on every future caller happening to pass a safe path.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Reads a dotted path (e.g. "tables.deals.visibility") out of a JSON object. */
export function getAtPath<T>(obj: unknown, path: string): T | undefined {
  let cursor: unknown = obj;
  for (const key of path.split(".")) {
    if (UNSAFE_KEYS.has(key) || !isPlainObject(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor as T | undefined;
}

/**
 * Returns a copy of `obj` with `value` set at the dotted `path`, cloning only
 * the objects along that path so sibling namespaces are left untouched.
 */
export function setAtPath(
  obj: unknown,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  if (keys.some((key) => UNSAFE_KEYS.has(key))) {
    throw new Error(`Refusing to set unsafe preference path "${path}"`);
  }
  const root: Record<string, unknown> = isPlainObject(obj) ? { ...obj } : {};
  let cursor = root;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    const existing = cursor[key];
    const next = isPlainObject(existing) ? { ...existing } : {};
    cursor[key] = next;
    cursor = next;
  });
  return root;
}

// Column widths are a server-backed preference with no bound enforced by the
// API (unlike table pagination's pageSize, which IS re-validated against
// PAGE_SIZE_OPTIONS on every read in table-pagination.tsx) — clamp on read so
// a corrupted/garbage stored value (e.g. from a hand-crafted API call) can't
// render a column at an unusable literal pixel width. Matches
// @tanstack/table-core's own minSize default; MAX_COLUMN_WIDTH is generous
// but finite. Centralized here (rather than per data-table.tsx /
// *-list-view.tsx call site) since every table reads this preference through
// useTableLayoutPreference.
const MIN_COLUMN_WIDTH = 20;
const MAX_COLUMN_WIDTH = 2000;

export function sanitizeColumnSizing(
  sizing: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, width] of Object.entries(sizing)) {
    result[id] = Number.isFinite(width)
      ? Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width))
      : MIN_COLUMN_WIDTH;
  }
  return result;
}

/** Validates a resolved `layout.theme` preference value (defense-in-depth on
 * READ: respondWithPreferences falls back to the raw stored document as-is
 * when it fails schema validation, e.g. an old/corrupted document, so the
 * client can in principle receive a garbage value at this path). */
export function sanitizeTheme(value: unknown): "light" | "dark" | null {
  return value === "light" || value === "dark" ? value : null;
}

const RECENTLY_VIEWED_TYPES = ["deal", "organization", "person"] as const;

export interface RecentlyViewedEntry {
  type: (typeof RECENTLY_VIEWED_TYPES)[number];
  href: string;
  title: string;
  viewedAt: string;
}

const RECENTLY_VIEWED_LIMIT = 15;

function isRecentlyViewedEntry(value: unknown): value is RecentlyViewedEntry {
  return (
    isPlainObject(value) &&
    typeof value.type === "string" &&
    (RECENTLY_VIEWED_TYPES as readonly string[]).includes(value.type) &&
    typeof value.href === "string" &&
    typeof value.title === "string" &&
    typeof value.viewedAt === "string"
  );
}

/** Drops any malformed entries (e.g. from a hand-crafted API call, or a
 *  record type that no longer exists). */
export function sanitizeRecentlyViewed(value: unknown): RecentlyViewedEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecentlyViewedEntry);
}

/**
 * Moves `entry` to the front of `current` (de-duped by `href`), stamping a
 * fresh `viewedAt`, and caps the list so it can't grow without bound.
 */
export function withRecentlyViewed(
  current: unknown,
  entry: Omit<RecentlyViewedEntry, "viewedAt">,
): RecentlyViewedEntry[] {
  const rest = sanitizeRecentlyViewed(current).filter(
    (e) => e.href !== entry.href,
  );
  return [
    { ...entry, viewedAt: new Date().toISOString() },
    ...rest,
  ].slice(0, RECENTLY_VIEWED_LIMIT);
}
