import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { CalendarDays, ChevronDown, Filter, Users } from "lucide-react";
import {
  EMPTY_EXTENDED_FILTER,
  encodeFilters,
  decodeExtendedFilters,
  type ExtendedFilterGroup,
} from "@workspace/deals-filter";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { MultiSelectFilter } from "@/components/shared/multi-select-filter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  InsightsFilterEditor,
  countGroupConditions,
  pruneFilters,
  type InsightsField,
} from "./insights-filter-editor";
import {
  DATE_BASES,
  DATE_PRESETS,
  EMPTY_BOARD_FILTERS,
  boardFiltersActive,
  type BoardFilters,
  type DatePresetKey,
} from "./insights-data";
import { useI18n } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// Board quick filters + the Add-filter condition group (board ∩ widget).
// Extracted from the insights page so the page stays composition-only.
// ---------------------------------------------------------------------------

const STATUS_CHIPS = ["open", "won", "lost"] as const;

export interface BoardFilterBarProps {
  filters: BoardFilters;
  setFilters: Dispatch<SetStateAction<BoardFilters>>;
  owners: { id: number; name: string }[];
  pipelines: { id: number; name: string }[];
  /** Deals-scope field catalog for the Add-filter builder. */
  fields: InsightsField[];
}

export function BoardFilterBar({
  filters,
  setFilters,
  owners,
  pipelines,
  fields,
}: BoardFilterBarProps) {
  const { t } = useI18n();
  const boardGroup: ExtendedFilterGroup = useMemo(() => {
    if (!filters.filters) return structuredClone(EMPTY_EXTENDED_FILTER);
    try {
      return decodeExtendedFilters(filters.filters);
    } catch {
      return structuredClone(EMPTY_EXTENDED_FILTER);
    }
  }, [filters.filters]);
  const [boardDraft, setBoardDraft] = useState<ExtendedFilterGroup | null>(null);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const boardConditionCount = countGroupConditions(pruneFilters(boardGroup));

  const presetLabel = filters.preset
    ? t(DATE_PRESETS.find((p) => p.key === filters.preset)?.label ?? "common.today")
    : filters.from || filters.to
      ? `${filters.from ?? "…"} → ${filters.to ?? "…"}`
      : null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <MultiSelectFilter
        label={t("common.owner")}
        icon={<Users className="h-3.5 w-3.5 text-slate-400" />}
        items={owners.map((o) => ({ value: String(o.id), label: o.name }))}
        selected={filters.ownerIds.map(String)}
        onChange={(vals) =>
          setFilters((f) => ({ ...f, ownerIds: vals.map(Number) }))
        }
        searchPlaceholder={t("deals.toolbar.searchOwners")}
        emptyLabel={t("insights.noOwners")}
        testId="owner-filter"
      />

      <MultiSelectFilter
        label={t("common.pipeline")}
        items={pipelines.map((p) => ({ value: String(p.id), label: p.name }))}
        selected={filters.pipelineIds.map(String)}
        onChange={(vals) =>
          setFilters((f) => ({ ...f, pipelineIds: vals.map(Number) }))
        }
        searchPlaceholder={t("activities.searchPipelines")}
        emptyLabel={t("insights.noPipelines")}
        testId="pipeline-filter"
      />

      {STATUS_CHIPS.map((s) => (
        <button
          key={s}
          onClick={() =>
            setFilters((f) => ({
              ...f,
              statuses: f.statuses.includes(s)
                ? f.statuses.filter((x) => x !== s)
                : [...f.statuses, s],
            }))
          }
          aria-pressed={filters.statuses.includes(s)}
          data-testid={`status-chip-${s}`}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
            filters.statuses.includes(s)
              ? "border-teal-600 bg-teal-50 text-teal-700"
              : "border-slate-200 text-slate-500 hover:border-slate-300",
          )}
        >
          {s}
        </button>
      ))}

      {/* Date range: presets + custom + basis */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-1.5", presetLabel && "border-teal-500 text-teal-700")}
            data-testid="date-filter"
          >
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            {presetLabel ?? t("common.date")}
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[92vw] p-0">
          <div className="p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t("insights.quickRanges")}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {DATE_PRESETS.map((p) => {
                const active = filters.preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        preset: active ? undefined : (p.key as DatePresetKey),
                        from: undefined,
                        to: undefined,
                      }))
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-start text-xs font-medium transition-colors",
                      active
                        ? "border-teal-600 bg-teal-50 text-teal-700"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    {t(p.label)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-slate-100 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t("insights.customRange")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-slate-500">{t("insights.from")}</span>
                <DatePicker
                  className="h-8 w-full text-xs"
                  value={filters.from ?? ""}
                  onChange={(next) =>
                    setFilters((f) => ({
                      ...f,
                      preset: undefined,
                      from: next || undefined,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-500">{t("insights.to")}</span>
                <DatePicker
                  className="h-8 w-full text-xs"
                  value={filters.to ?? ""}
                  onChange={(next) =>
                    setFilters((f) => ({
                      ...f,
                      preset: undefined,
                      to: next || undefined,
                    }))
                  }
                />
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="shrink-0 text-xs text-slate-500">{t("insights.basedOn")}</span>
              <Select
                value={filters.basis ?? "createdAt"}
                onValueChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    basis: v as BoardFilters["basis"],
                  }))
                }
              >
                <SelectTrigger className="h-8 w-44 text-xs" data-testid="date-basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_BASES.map((b) => (
                    <SelectItem key={b.key} value={b.key}>
                      {t("insights.basisDate", { basis: t(b.label) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(filters.preset || filters.from || filters.to) && (
            <div className="border-t border-slate-100 p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs text-slate-500"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    preset: undefined,
                    from: undefined,
                    to: undefined,
                  }))
                }
              >
                {t("insights.clearDateFilter")}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Add-filter: any allow-listed field, incl. custom fields */}
      <Popover
        open={addFilterOpen}
        onOpenChange={(o) => {
          setAddFilterOpen(o);
          if (o) setBoardDraft(structuredClone(boardGroup));
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-1.5",
              boardConditionCount > 0 && "border-teal-500 text-teal-700",
            )}
            data-testid="board-add-filter"
          >
            <Filter className="h-3.5 w-3.5" />
            {t("common.filter")}
            {boardConditionCount > 0 && (
              <Badge className="bg-teal-600 px-1.5 hover:bg-teal-600">
                {boardConditionCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[560px] max-w-[92vw] p-3">
          <div className="max-h-[min(60vh,480px)] overflow-y-auto overscroll-contain pe-1">
            <InsightsFilterEditor
              group={boardDraft ?? boardGroup}
              fields={fields}
              onChange={setBoardDraft}
            />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBoardDraft(null);
                setFilters((f) => ({ ...f, filters: undefined }));
                setAddFilterOpen(false);
              }}
            >
              {t("common.clearAll")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddFilterOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const pruned = pruneFilters(boardDraft ?? boardGroup);
                  setFilters((f) => ({
                    ...f,
                    filters:
                      countGroupConditions(pruned) > 0
                        ? encodeFilters(pruned)
                        : undefined,
                  }));
                  setAddFilterOpen(false);
                }}
              >
                {t("common.apply")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {boardFiltersActive(filters) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFilters(EMPTY_BOARD_FILTERS)}
        >
          {t("common.clear")}
        </Button>
      )}
    </div>
  );
}
