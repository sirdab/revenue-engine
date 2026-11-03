import { useMemo, useState } from "react";
import type { Table as TanstackTable, RowData } from "@tanstack/react-table";
import { Check, Columns3, Eye, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// Extend column meta so any table can give a column a picker label (when its
// header isn't a plain string) and a group heading (e.g. "Custom fields").
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Label shown in the column picker when `header` isn't a string. */
    pickerLabel?: string;
    /** Group heading in the column picker (e.g. "Custom fields"). */
    pickerGroup?: string;
  }
}

interface PickerColumn {
  id: string;
  label: string;
  group: string;
  visible: boolean;
  toggle: (next: boolean) => void;
}

// A searchable, scrollable column picker shared by every table (the shared
// DataTable and the bespoke list views). Replaces the old fixed dropdown of
// checkboxes — type to filter, scroll long lists, columns grouped by origin
// (native vs. custom fields). Toggling keeps the popover open.
export function ColumnPicker<T>({
  table,
  onReset,
  align = "end",
}: {
  table: TanstackTable<T>;
  /** Restore the table's default column order/visibility/sizing. */
  onReset: () => void;
  align?: "start" | "center" | "end";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const columns: PickerColumn[] = useMemo(() => {
    return table
      .getAllLeafColumns()
      .filter((col) => col.getCanHide())
      .map((col) => {
        const header = col.columnDef.header;
        const label =
          col.columnDef.meta?.pickerLabel ??
          (typeof header === "string" ? header : col.id);
        return {
          id: col.id,
          label,
          group: col.columnDef.meta?.pickerGroup ?? t("columns.defaultGroup"),
          visible: col.getIsVisible(),
          toggle: (next: boolean) => col.toggleVisibility(next),
        };
      });
    // getIsVisible() changes are driven by table state; recompute each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, table.getState().columnVisibility]);

  const grouped = useMemo(() => {
    const map = new Map<string, PickerColumn[]>();
    for (const c of columns) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return [...map.entries()];
  }, [columns]);

  const shownCount = columns.filter((c) => c.visible).length;

  const setAll = (visible: boolean) => {
    for (const c of columns) c.toggle(visible);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="me-1.5 h-4 w-4" />
          {t("common.columns")}
          <span className="ms-1.5 rounded bg-slate-100 px-1.5 text-[11px] font-medium tabular-nums text-slate-500">
            {shownCount}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <Command
          // Each item's cmdk value is its unique column id (so same-labeled
          // columns — e.g. a native and a custom "Status" — never collide),
          // while search matches the human label carried in `keywords`.
          filter={(_value, search, keywords) =>
            (keywords ?? [])
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase())
              ? 1
              : 0
          }
        >
          <CommandInput placeholder={t("columns.search")} />
          <CommandList className="max-h-[min(60vh,340px)]">
            <CommandEmpty>{t("columns.none")}</CommandEmpty>
            {grouped.map(([group, cols]) => (
              <CommandGroup key={group} heading={group}>
                {cols.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    keywords={[c.label]}
                    onSelect={() => c.toggle(!c.visible)}
                    className="cursor-pointer"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        c.visible
                          ? "border-teal-500 bg-teal-500 text-white"
                          : "border-slate-300",
                      )}
                    >
                      {c.visible && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{c.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center justify-between border-t border-slate-100 p-1.5">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-slate-500"
                onClick={() => setAll(true)}
              >
                <Eye className="h-3.5 w-3.5" /> {t("common.all")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-slate-500"
                onClick={() => setAll(false)}
              >
                <EyeOff className="h-3.5 w-3.5" /> {t("columns.hideAll")}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-slate-500"
              onClick={onReset}
            >
              <RotateCcw className="h-3.5 w-3.5" /> {t("common.reset")}
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
