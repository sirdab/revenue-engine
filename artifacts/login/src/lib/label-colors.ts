// The label palette. Tokens are stored server-side (labels.color); this maps
// them to theme classes so a design refresh never touches data. Keep in sync
// with LABEL_COLORS in @workspace/db (schema/labels.ts).

export interface LabelColorClasses {
  /** Chip / pill rendering (border + background + text). */
  chip: string;
  /** Solid swatch (color pickers, list dots). */
  swatch: string;
}

export const LABEL_COLOR_TOKENS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

export const LABEL_COLOR_CLASSES: Record<string, LabelColorClasses> = {
  slate: {
    chip: "border-slate-200 bg-slate-100 text-slate-700",
    swatch: "bg-slate-400",
  },
  red: { chip: "border-red-200 bg-red-50 text-red-700", swatch: "bg-red-500" },
  orange: {
    chip: "border-orange-200 bg-orange-50 text-orange-700",
    swatch: "bg-orange-500",
  },
  amber: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    swatch: "bg-amber-500",
  },
  green: {
    chip: "border-green-200 bg-green-50 text-green-700",
    swatch: "bg-green-500",
  },
  teal: {
    chip: "border-teal-200 bg-teal-50 text-teal-700",
    swatch: "bg-teal-500",
  },
  blue: {
    chip: "border-blue-200 bg-blue-50 text-blue-700",
    swatch: "bg-blue-500",
  },
  indigo: {
    chip: "border-indigo-200 bg-indigo-50 text-indigo-700",
    swatch: "bg-indigo-500",
  },
  purple: {
    chip: "border-purple-200 bg-purple-50 text-purple-700",
    swatch: "bg-purple-500",
  },
  pink: {
    chip: "border-pink-200 bg-pink-50 text-pink-700",
    swatch: "bg-pink-500",
  },
};

export function labelColorClasses(
  color: string | null | undefined,
): LabelColorClasses {
  return LABEL_COLOR_CLASSES[color ?? ""] ?? LABEL_COLOR_CLASSES.teal;
}

/** Case-insensitive name → color lookup built from a label option list. */
export function buildLabelColorMap(
  options: Array<{ name: string; color: string }> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const o of options ?? []) map.set(o.name.toLowerCase(), o.color);
  return map;
}
