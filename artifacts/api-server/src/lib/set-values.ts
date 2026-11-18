// Shaping an inbound webhook value for a `set` deal field. `set` values live
// in custom_fields as a JSON ARRAY, and the webhook writes straight into the
// jsonb without the registry's normalize(), so a scalar must be wrapped or the
// deal detail (which renders `Array.isArray(v) ? v : []`) shows it EMPTY.
// Members are trimmed and de-duplicated; unknown ones are kept, not dropped.

/** Coerce an inbound webhook value into a canonical `set` array. */
export function coerceSetValue(v: unknown): string[] {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const member of raw) {
    if (member == null) continue;
    const s = String(member).replace(/\s+/g, " ").trim();
    if (s === "") continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
