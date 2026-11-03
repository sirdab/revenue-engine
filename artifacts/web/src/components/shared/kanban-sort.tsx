import { useMemo } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreference } from "@/hooks/use-user-preferences";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// Shared, board-agnostic sort for kanban views. Each board declares its own
// sortable fields (a label + a comparable accessor); the hook sorts the loaded
// items and `KanbanSortControl` renders the picker. Sorting is applied before
// grouping, so cards come out ordered within every column.

export type SortDir = "asc" | "desc";

export interface KanbanSortOption<T> {
  id: string;
  label: string;
  /** Comparable value for an item. Strings compare case-insensitively + numerically. */
  value: (item: T) => string | number | null | undefined;
}

export interface KanbanSortState {
  id: string;
  dir: SortDir;
}

// Empties always sort last (regardless of direction); otherwise numbers compare
// numerically and strings via locale-aware, number-aware comparison.
function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  const ae = a == null || a === "";
  const be = b == null || b === "";
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function useKanbanSort<T,>(
  items: T[],
  options: KanbanSortOption<T>[],
  initial: KanbanSortState,
  preferenceKey?: string,
) {
  const [sort, setSort] = usePreference<KanbanSortState>(
    preferenceKey ?? "__kanbanSortFallback__",
    initial,
  );
  const active = options.find((o) => o.id === sort.id) ?? options[0];

  const sorted = useMemo(() => {
    if (!active) return items;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = active.value(a);
      const bv = active.value(b);
      // Keep empties last by short-circuiting before applying direction.
      if ((av == null || av === "") || (bv == null || bv === "")) {
        return compareValues(av, bv);
      }
      return compareValues(av, bv) * dir;
    });
  }, [items, active, sort.dir]);

  return { sorted, sort, setSort };
}

export function KanbanSortControl({
  sort,
  setSort,
  options,
}: {
  sort: KanbanSortState;
  setSort: (next: KanbanSortState) => void;
  options: { id: string; label: string }[];
}) {
  const { t } = useI18n();
  const active = options.find((o) => o.id === sort.id) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <ArrowDownUp className="h-3.5 w-3.5" />
          <span className="text-xs">{t("sort.active", { field: active?.label ?? "" })}</span>
          {sort.dir === "asc" ? (
            <ArrowUp className="h-3 w-3 text-slate-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-slate-400" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t("common.sortBy")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={(e) => {
              e.preventDefault();
              // Switching field defaults to descending; re-selecting keeps dir.
              setSort({ id: o.id, dir: sort.id === o.id ? sort.dir : "desc" });
            }}
            className="flex items-center gap-2"
          >
            <span className="flex-1">{o.label}</span>
            <Check
              className={cn(
                "h-3.5 w-3.5",
                sort.id === o.id ? "text-teal-600" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setSort({ id: sort.id, dir: sort.dir === "asc" ? "desc" : "asc" });
          }}
          className="flex items-center gap-2"
        >
          {sort.dir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-slate-500" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-slate-500" />
          )}
          <span>{sort.dir === "asc" ? t("common.ascending") : t("common.descending")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
