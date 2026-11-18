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
    chip: "border-border bg-muted text-foreground",
    swatch: "bg-gray-400",
  },
  red: { chip: "border-destructive/30 bg-destructive-subtle text-destructive", swatch: "bg-destructive" },
  orange: {
    chip: "border-warning/30 bg-warning-subtle text-warning",
    swatch: "bg-warning",
  },
  amber: {
    chip: "border-warning/30 bg-warning-subtle text-warning",
    swatch: "bg-warning",
  },
  green: {
    chip: "border-success/30 bg-success-subtle text-success",
    swatch: "bg-success",
  },
  teal: {
    chip: "border-brand-200 bg-brand-subtle text-brand",
    swatch: "bg-brand-500",
  },
  blue: {
    chip: "border-attention/30 bg-attention-subtle text-attention",
    swatch: "bg-attention",
  },
  indigo: {
    chip: "border-attention/30 bg-attention-subtle text-attention",
    swatch: "bg-attention",
  },
  purple: {
    chip: "border-attention/30 bg-attention-subtle text-attention",
    swatch: "bg-attention",
  },
  pink: {
    chip: "border-destructive/30 bg-destructive-subtle text-destructive",
    swatch: "bg-destructive",
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
