import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Deal } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import {
  useDealFieldRegistry,
  type DealFieldRow,
  type DealFieldOptionRow,
} from "@/lib/deal-fields-api";
import { useI18n } from "@/lib/i18n/i18n";

// Turns the deal custom-field registry into read-only table columns so any
// custom field can be surfaced in the deals list via the column picker. Values
// arrive already resolved on `deal.customFields` (the list API projects the
// keys requested through the `columns` param), so these cells only format —
// no per-row fetching. Editing stays on the deal detail page.

function optionLabel(
  options: DealFieldOptionRow[],
  value: unknown,
): { label: string; color: string | null } {
  const opt = options.find((o) => o.value === String(value));
  return { label: opt?.label ?? String(value), color: opt?.color ?? null };
}

function CustomFieldCell({
  field,
  options,
  value,
}: {
  field: DealFieldRow;
  options: DealFieldOptionRow[];
  value: unknown;
}) {
  const { t } = useI18n();
  const empty = <span className="text-slate-400">—</span>;
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return empty;
  }

  switch (field.fieldType) {
    case "monetary": {
      const m = value as { value?: number | null; currency?: string | null };
      if (m.value == null || m.value === undefined) return empty;
      return (
        <span className="tabular-nums text-slate-700">
          {formatCurrency(Number(m.value), m.currency ?? "SAR")}
        </span>
      );
    }
    case "double":
      return (
        <span className="tabular-nums text-slate-700">
          {formatNumber(Number(value))}
        </span>
      );
    case "date":
      return <span className="text-slate-600">{formatDate(String(value))}</span>;
    case "daterange": {
      const r = value as { from?: string | null; to?: string | null };
      if (!r.from && !r.to) return empty;
      return (
        <span className="whitespace-nowrap text-slate-600">
          {r.from ? formatDate(r.from) : "…"} → {r.to ? formatDate(r.to) : "…"}
        </span>
      );
    }
    case "boolean":
      return (
        <Badge
          variant="outline"
          className={cn(
            "px-1.5 py-0 text-[10px]",
            value
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "border-slate-200 bg-slate-50 text-slate-500",
          )}
        >
          {value ? t("common.yes") : t("common.no")}
        </Badge>
      );
    case "enum": {
      const { label, color } = optionLabel(options, value);
      return (
        <Badge
          variant="outline"
          className="px-1.5 py-0 text-[10px]"
          style={
            color
              ? { borderColor: `${color}55`, backgroundColor: `${color}18`, color }
              : undefined
          }
        >
          {label}
        </Badge>
      );
    }
    case "set": {
      const arr = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v) => {
            const { label } = optionLabel(options, v);
            return (
              <Badge
                key={String(v)}
                variant="outline"
                className="border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] text-slate-600"
              >
                {label}
              </Badge>
            );
          })}
        </div>
      );
    }
    default:
      return (
        <span dir="auto" className="truncate text-slate-700">
          {String(value)}
        </span>
      );
  }
}

/**
 * Custom-field columns for the deals table plus their ids. `ids` is the full
 * set of custom-field keys — the caller sends the currently-visible subset to
 * the list API's `columns` param so only shown fields are fetched.
 */
export function useDealCustomColumns(): {
  columns: ColumnDef<Deal>[];
  ids: string[];
} {
  const { data } = useDealFieldRegistry();
  const { t } = useI18n();

  return useMemo(() => {
    // Only fields living in the custom_fields jsonb (custom + Pipedrive-decoded
    // data). Native `column`-storage fields are already handled by the static
    // columns and aren't projected by the API.
    const fields = (data?.fields ?? []).filter(
      (f) => f.active && f.storage !== "column",
    );
    const optionsByField = new Map<number, DealFieldOptionRow[]>();
    for (const o of data?.options ?? []) {
      const arr = optionsByField.get(o.fieldId) ?? [];
      arr.push(o);
      optionsByField.set(o.fieldId, arr);
    }

    const columns: ColumnDef<Deal>[] = fields.map((f) => ({
      id: f.key,
      header: f.label,
      size: 180,
      enableSorting: false, // values live in jsonb; not in the server sort allowlist
      meta: {
        pickerGroup: t("deals.group.customFields"),
        pickerLabel: f.label,
      },
      accessorFn: (row) =>
        (row.customFields as Record<string, unknown> | null | undefined)?.[
          f.key
        ] ?? null,
      cell: ({ row }) => (
        <CustomFieldCell
          field={f}
          options={optionsByField.get(f.id) ?? []}
          value={
            (row.original.customFields as Record<string, unknown> | null | undefined)?.[
              f.key
            ] ?? null
          }
        />
      ),
    }));

    return { columns, ids: fields.map((f) => f.key) };
  }, [data]);
}
