// Shaping an inbound webhook value for a `set` deal field.
//
// `set` values live in custom_fields as a JSON ARRAY. The webhook writes
// straight into the jsonb via coerceCustomValue and never passes through the
// registry's normalize(), so an inbound scalar "LSC" would land as the bare
// string "LSC". The deal detail renders a set with
// `Array.isArray(v) ? v : []`, so that deal would silently show EMPTY and no
// amount of clicking in the UI repairs the stored shape.
//
// Unknown members are kept, not dropped: SetEditor shows stored values it has
// no option for, so an unrecognised value is a visible problem an admin can
// correct rather than a silent deletion.

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
