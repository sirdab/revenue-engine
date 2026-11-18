import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Copy,
  Filter,
  Info,
  LayoutGrid,
  MoreVertical,
  MoveDown,
  MoveUp,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
} from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  InsightsGlobalFilters,
  InsightsWidget,
  InsightsWidgetSpec,
} from "@workspace/api-client-react";
import type { ExtendedFilterGroup } from "@workspace/deals-filter";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  firstSeriesPoints,
  isMonetarySpec,
  useWidgetData,
} from "./insights-data";
import {
  InsightsFilterEditor,
  countGroupConditions,
  pruneFilters,
  type InsightsField,
} from "./insights-filter-editor";
import {
  buildDealsDrillUrl,
  canDrillSpec,
  type DrillClick,
} from "./insights-drill";
import { isoDay } from "./insights-dates";
import { WidgetChart, readVizOptions, type KpiTrend } from "./widget-chart";
import { WidgetErrorBoundary } from "./widget-error-boundary";
import { useI18n, tStatic } from "@/lib/i18n/i18n";
import { formatNumber, formatRelativeLong } from "@/lib/format";

/** Companion monthly series for KPI tiles: same measure + filters, bucketed
 *  on the widget's date basis. Powers the sparkline and the delta badge
 *  (latest bucket vs the one before). */
function useKpiTrend(
  spec: InsightsWidgetSpec,
  globalFilters: InsightsGlobalFilters | undefined,
  enabled: boolean,
): KpiTrend | null {
  const basis = spec.dateBasis ?? "createdAt";
  // Date-basis enum values ≠ field keys everywhere: the activities scope
  // names the done-time basis "activityDoneAt" but the field "doneAt".
  const trendField =
    spec.scope === "activities" && basis === "activityDoneAt" ? "doneAt" : basis;
  const trendSpec = useMemo<InsightsWidgetSpec>(
    () => ({
      ...spec,
      viewBy: { field: trendField, dateBucket: "month" },
      segmentBy: undefined,
    }),
    [spec, trendField],
  );
  const { data } = useWidgetData(trendSpec, globalFilters, enabled);
  return useMemo(() => {
    if (!data) return null;
    const points = firstSeriesPoints(data);
    const nums = points.filter((p) => p.y != null) as { x: string; y: number }[];
    let deltaPct: number | null = null;
    if (nums.length >= 2) {
      const prev = nums[nums.length - 2].y;
      const last = nums[nums.length - 1].y;
      deltaPct = prev !== 0 ? (last - prev) / Math.abs(prev) : null;
    }
    return { points, deltaPct, periodLabel: tStatic("insights.widget.prevMonth") };
  }, [data]);
}

/** Companion query for the previous-period overlay: the same spec over the
 *  window immediately preceding the board's date range (same length). No
 *  bounded board range → no comparison (there is no "previous" of forever). */
function useCompareData(
  spec: InsightsWidgetSpec,
  globalFilters: InsightsGlobalFilters | undefined,
  enabled: boolean,
): { x: string; y: number | null }[] | null {
  const from = isoDay(globalFilters?.dateRange?.from);
  const to = isoDay(globalFilters?.dateRange?.to);
  const prevFilters = useMemo(() => {
    if (!from || !to) return undefined;
    const fromDate = parseISO(from);
    const toDate = parseISO(to);
    if (!isValid(fromDate) || !isValid(toDate)) return undefined;
    const days = differenceInCalendarDays(toDate, fromDate) + 1;
    if (days <= 0) return undefined;
    return {
      ...globalFilters,
      dateRange: {
        ...(globalFilters?.dateRange?.basis
          ? { basis: globalFilters.dateRange.basis }
          : {}),
        from: format(addDays(fromDate, -days), "yyyy-MM-dd"),
        to: format(addDays(fromDate, -1), "yyyy-MM-dd"),
      },
    } as unknown as InsightsGlobalFilters;
  }, [globalFilters, from, to]);

  const { data } = useWidgetData(spec, prevFilters, enabled && !!prevFilters);
  return useMemo(() => {
    if (!enabled || !prevFilters || !data) return null;
    return firstSeriesPoints(data);
  }, [enabled, prevFilters, data]);
}

export interface WidgetShellProps {
  widget: InsightsWidget;
  globalFilters: InsightsGlobalFilters | undefined;
  fields: InsightsField[];
  /** Dashboards the widget can be copied onto (excluding its own). */
  copyTargets: { id: number; name: string }[];
  readOnly?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onCopyTo: (dashboardId: number) => void;
  onRemove: () => void;
  /** Persist the widget with a new spec (inline filter Save). */
  onSaveSpec: (spec: InsightsWidgetSpec) => void;
  /** Duplicate the widget with a new spec (inline filter Save as). */
  onSaveAsSpec: (spec: InsightsWidgetSpec) => void;
  /** Keyboard-accessible reordering (menu items), complementing pointer DnD. */
  onMove?: (direction: "earlier" | "later") => void;
  /** Spread onto the drag handle; the page owns drag-and-drop. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function WidgetShell({
  widget,
  globalFilters,
  fields,
  copyTargets,
  readOnly,
  onEdit,
  onDuplicate,
  onCopyTo,
  onRemove,
  onSaveSpec,
  onSaveAsSpec,
  onMove,
  dragHandleProps,
}: WidgetShellProps) {
  // Inline graph-level filters (ticket §7.3): edits are temporary — the
  // widget re-queries live — until explicitly saved or reverted. Drafts are
  // client-side only and discarded on unmount/navigation by design.
  const { t } = useI18n();
  const [draft, setDraft] = useState<ExtendedFilterGroup | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const savedFilters = widget.spec.filters as unknown as ExtendedFilterGroup;
  const modified = useMemo(
    () =>
      draft !== null &&
      JSON.stringify(pruneFilters(draft)) !==
        JSON.stringify(pruneFilters(savedFilters)),
    [draft, savedFilters],
  );

  const effectiveSpec: InsightsWidgetSpec = useMemo(
    () =>
      modified && draft
        ? {
            ...widget.spec,
            filters: pruneFilters(draft) as unknown as InsightsWidgetSpec["filters"],
          }
        : widget.spec,
    [widget.spec, draft, modified],
  );

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } =
    useWidgetData(effectiveSpec, globalFilters);
  const trend = useKpiTrend(
    effectiveSpec,
    globalFilters,
    widget.viz.type === "singleNumber",
  );

  const compareWanted =
    readVizOptions(widget.viz).compare === true &&
    !!effectiveSpec.viewBy?.dateBucket &&
    !effectiveSpec.segmentBy;
  const compare = useCompareData(effectiveSpec, globalFilters, compareWanted);

  // Drill-through: a click on a mark opens the deals list filtered to
  // exactly the records behind it. Insights-only conditions that cannot be
  // expressed in the deals list are dropped and reported via toast.
  const [, navigate] = useLocation();
  const fieldLabel = (key: string) =>
    fields.find((f) => f.key === key)?.label ?? key.replace(/^cf:/, "");
  const onDrill = canDrillSpec(effectiveSpec)
    ? (click: DrillClick) => {
        const res = buildDealsDrillUrl(effectiveSpec, globalFilters, click);
        if (!res) return;
        if (res.dropped.length > 0) {
          toast({
            title: t("insights.widget.partialFilters"),
            description: t("insights.widget.notApplied", { fields: res.dropped.map(fieldLabel).join(", ") }),
          });
        }
        navigate(res.url);
      }
    : undefined;

  const monetary = isMonetarySpec(widget.spec);

  const filterCount = countGroupConditions(
    pruneFilters(draft ?? savedFilters),
  );

  const appliedBoard = data?.meta.appliedFilters?.board ?? [];
  const appliedWidget = data?.meta.appliedFilters?.widget ?? [];

  return (
    <Card
      className={cn(
        "flex h-full flex-col overflow-hidden p-3 transition-shadow hover:shadow-card-hover",
        modified && "ring-1 ring-warning/30",
      )}
      data-testid={`widget-${widget.id}`}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            dragHandleProps && "cursor-grab active:cursor-grabbing",
          )}
          {...dragHandleProps}
        >
          <h3 className="truncate text-body font-semibold text-foreground">
            {widget.name}
          </h3>
          {modified && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
              title={t("insights.widget.unsavedFilters")}
              data-testid={`widget-${widget.id}-modified`}
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-subtle">
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-72">
                <div className="space-y-1.5 text-caption-quiet">
                  <div>
                    <span className="font-semibold">{t("insights.widget.boardFilters")}</span>{" "}
                    {appliedBoard.length > 0 ? appliedBoard.join("; ") : t("insights.widget.none")}
                  </div>
                  <div>
                    <span className="font-semibold">{t("insights.widget.widgetFilters")}</span>{" "}
                    {appliedWidget.length > 0 ? appliedWidget.join("; ") : t("insights.widget.none")}
                  </div>
                  {dataUpdatedAt > 0 && (
                    <div className="text-subtle">
                      {t("insights.widget.updatedAt", { time: formatRelativeLong(dataUpdatedAt) })}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative h-7 w-7 text-subtle",
                  (filterCount > 0 || modified) && "text-brand",
                )}
                title={t("insights.widget.widgetFiltersTitle")}
                data-testid={`widget-${widget.id}-filters`}
              >
                <Filter className="h-3.5 w-3.5" />
                {filterCount > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">
                    {filterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[560px] max-w-[92vw] p-3">
              <div className="max-h-[50vh] overflow-auto">
                <InsightsFilterEditor
                  group={draft ?? savedFilters}
                  fields={fields}
                  onChange={setDraft}
                />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-caption-quiet text-subtle">
                  {modified ? t("insights.widget.unsavedLive") : t("insights.widget.editsLive")}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!modified}
                    onClick={() => setDraft(null)}
                  >
                    {t("insights.widget.revert")}
                  </Button>
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!modified}
                      onClick={() => {
                        onSaveAsSpec(effectiveSpec);
                        setDraft(null);
                        setFilterOpen(false);
                      }}
                    >
                      {t("insights.widget.saveAsNew")}
                    </Button>
                  )}
                  {!readOnly && (
                    <Button
                      size="sm"
                      disabled={!modified}
                      onClick={() => {
                        onSaveSpec(effectiveSpec);
                        setDraft(null);
                        setFilterOpen(false);
                      }}
                    >
                      {t("common.save")}
                    </Button>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-subtle">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!readOnly && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="me-2 h-4 w-4" /> {t("common.edit")}
                </DropdownMenuItem>
              )}
              {!readOnly && onMove && (
                <>
                  <DropdownMenuItem onClick={() => onMove("earlier")}>
                    <MoveUp className="me-2 h-4 w-4" /> {t("insights.widget.moveUp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onMove("later")}>
                    <MoveDown className="me-2 h-4 w-4" /> {t("insights.widget.moveDown")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="me-2 h-4 w-4" /> {t("common.duplicate")}
              </DropdownMenuItem>
              {copyTargets.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <LayoutGrid className="me-2 h-4 w-4" /> {t("insights.widget.copyToDashboard")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {copyTargets.map((d) => (
                      <DropdownMenuItem key={d.id} onClick={() => onCopyTo(d.id)}>
                        {d.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void refetch()}>
                <RefreshCw className={cn("me-2 h-4 w-4", isFetching && "animate-spin")} />
                {t("common.refresh")}
              </DropdownMenuItem>
              {!readOnly && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onRemove} className="text-destructive">
                    <Trash2 className="me-2 h-4 w-4" /> {t("common.remove")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full flex-col justify-end gap-2 p-2">
            <div className="flex h-full items-end gap-3">
              {[0.45, 0.7, 0.55, 0.9, 0.65].map((h, i) => (
                <Skeleton key={i} className="w-full" style={{ height: `${h * 100}%` }} />
              ))}
            </div>
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-body-quiet text-destructive">{error?.message || t("insights.queryFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="me-1.5 h-3.5 w-3.5" /> {t("common.retry")}
            </Button>
          </div>
        ) : data ? (
          <WidgetErrorBoundary label={widget.name} resetKey={`${widget.updatedAt}`}>
            <WidgetChart
              result={data}
              viz={widget.viz}
              monetary={monetary}
              spec={effectiveSpec}
              trend={trend}
              onDrill={onDrill}
              compare={compare}
            />
          </WidgetErrorBoundary>
        ) : null}
      </div>
      {data?.meta.rowCap != null && (
        <p
          className="mt-1 shrink-0 text-[11px] text-warning"
          title={t("insights.widget.rowCapTitle")}
          data-testid={`widget-${widget.id}-rowcap`}
        >
          {t("insights.widget.rowCap", { count: formatNumber(data.meta.rowCap) })}
        </p>
      )}
    </Card>
  );
}
