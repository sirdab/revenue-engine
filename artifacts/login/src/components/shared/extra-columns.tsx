import type { ColumnDef, RowData } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n, type MessageKey, type Translate } from "@/lib/i18n/i18n";

// Generic "expose every remaining field as a selectable column" helper, shared
// by every table. Each table keeps its curated primary columns exactly as they
// are, then appends `extraColumns(SPECS)` — read-only, default-hidden columns
// (grouped under "More fields" in the column picker) so any field in the data
// structure can be turned on, Pipedrive-style, without touching the defaults.

export type ExtraKind = "text" | "number" | "date" | "datetime" | "bool" | "list";

export interface ExtraColumnSpec {
  /** Key on the row object (also the column id / persisted visibility key). */
  id: string;
  /** Message key of the header — specs are module constants, so the word
   *  is resolved when the columns are built inside a component. */
  header: MessageKey;
  kind?: ExtraKind; // default "text"
  size?: number;
  /** Only set when the server can sort this field (server-mode tables). */
  sortable?: boolean;
  /** Column-picker group heading. */
  group?: MessageKey;
}

const dash = <span className="text-subtle">—</span>;

function YesNo({ value }: { value: boolean }) {
  const { t } = useI18n();
  return <>{t(value ? "common.yes" : "common.no")}</>;
}

function renderValue(kind: ExtraKind | undefined, value: unknown): React.ReactNode {
  if (value == null || value === "") return dash;

  switch (kind) {
    case "number":
      return (
        <span className="tabular-nums text-muted-foreground">
          {formatNumber(Number(value))}
        </span>
      );
    case "date":
    case "datetime":
      return (
        <span className="truncate text-muted-foreground">
          {formatDateTime(String(value))}
        </span>
      );
    case "bool":
      return (
        <Badge
          variant="outline"
          className={
            value
              ? "border-brand-200 bg-brand-subtle px-1.5 py-0 text-[10px] text-brand"
              : "border-border bg-surface-whisper px-1.5 py-0 text-[10px] text-muted-foreground"
          }
        >
          <YesNo value={!!value} />
        </Badge>
      );
    case "list": {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.length === 0) return dash;
      return (
        <span dir="auto" className="truncate text-muted-foreground">
          {arr.map(String).join(", ")}
        </span>
      );
    }
    default:
      return (
        <span dir="auto" className="truncate text-muted-foreground">
          {String(value)}
        </span>
      );
  }
}

export function extraColumns<T extends RowData>(
  t: Translate,
  specs: ExtraColumnSpec[],
  group: MessageKey = "columns.moreFields",
): ColumnDef<T>[] {
  return specs.map((s) => ({
    id: s.id,
    header: t(s.header),
    size: s.size ?? 150,
    enableSorting: s.sortable ?? false,
    accessorFn: (row) => (row as Record<string, unknown>)[s.id] ?? null,
    meta: { pickerGroup: t(s.group ?? group) },
    cell: ({ getValue }) => renderValue(s.kind, getValue()),
  }));
}

/** Column ids for a spec list — for default order + default-hidden maps. */
export function extraColumnIds(specs: ExtraColumnSpec[]): string[] {
  return specs.map((s) => s.id);
}

/** Convenience: `{ id: false, ... }` visibility map to seed default-hidden. */
export function hiddenVisibility(specs: ExtraColumnSpec[]): Record<string, boolean> {
  return Object.fromEntries(specs.map((s) => [s.id, false]));
}
