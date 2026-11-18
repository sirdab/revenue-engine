import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AreaChart,
  BarChart3,
  BarChartHorizontalBig,
  Calendar,
  CircleDot,
  Filter as FilterIcon,
  GitBranch,
  Hash,
  LineChart,
  List,
  Loader2,
  Milestone,
  PieChart,
  Settings2,
  Table as TableIcon,
  Tag,
  TrendingDown,
  Type,
  User,
} from "lucide-react";
import {
  useListInsightsFields,
  type InsightsField,
  type InsightsWidget,
  type InsightsWidgetSpec,
  type InsightsWidgetViz,
} from "@workspace/api-client-react";
import { EMPTY_EXTENDED_FILTER, type ExtendedFilterGroup } from "@workspace/deals-filter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "./insights-filter-editor";
import {
  ACTIVITY_DATE_BASES,
  DATE_BASES,
  isMonetarySpec,
  useWidgetData,
} from "./insights-data";
import { WidgetChart, ACCENT_CHOICES } from "./widget-chart";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// Builder (ticket §5.6), readability-first: pick a chart shape from icon
// tiles, describe the data in plain language, and read back what you built as
// a sentence. The preview runs the exact spec that saves.
// ---------------------------------------------------------------------------

const VIZ_TILES: {
  value: string;
  label: MessageKey;
  icon: ComponentType<{ className?: string }>;
  hint: MessageKey;
}[] = [
  { value: "bar", label: "insights.builder.viz.bar", icon: BarChart3, hint: "insights.builder.viz.barHint" },
  { value: "horizontalBar", label: "insights.builder.viz.barList", icon: List, hint: "insights.builder.viz.barListHint" },
  { value: "line", label: "insights.builder.viz.line", icon: LineChart, hint: "insights.builder.viz.lineHint" },
  { value: "area", label: "insights.builder.viz.area", icon: AreaChart, hint: "insights.builder.viz.areaHint" },
  { value: "pie", label: "insights.builder.viz.pie", icon: PieChart, hint: "insights.builder.viz.pieHint" },
  { value: "funnel", label: "insights.builder.viz.funnel", icon: TrendingDown, hint: "insights.builder.viz.funnelHint" },
  { value: "singleNumber", label: "insights.builder.viz.kpi", icon: Hash, hint: "insights.builder.viz.kpiHint" },
  { value: "table", label: "common.view.table", icon: TableIcon, hint: "insights.builder.viz.tableHint" },
];

// Plain-language aggregations — "median" alone reads as jargon.
const AGG_OPTIONS = [
  { value: "count", label: "insights.builder.agg.count" },
  { value: "sum", label: "insights.builder.agg.sum" },
  { value: "avg", label: "insights.builder.agg.avg" },
  { value: "median", label: "insights.builder.agg.median" },
  { value: "p25", label: "insights.builder.agg.p25" },
  { value: "p75", label: "insights.builder.agg.p75" },
  { value: "min", label: "insights.builder.agg.min" },
  { value: "max", label: "insights.builder.agg.max" },
] as const satisfies readonly { value: string; label: MessageKey }[];

// `label` is the picker word ("Monthly"), `noun` the unit for sentences
// ("per month"): they are different words in every language.
const BUCKETS = [
  { value: "day", label: "insights.builder.bucket.day", noun: "insights.builder.bucketNoun.day" },
  { value: "week", label: "insights.builder.bucket.week", noun: "insights.builder.bucketNoun.week" },
  { value: "month", label: "insights.builder.bucket.month", noun: "insights.builder.bucketNoun.month" },
  { value: "quarter", label: "insights.builder.bucket.quarter", noun: "insights.builder.bucketNoun.quarter" },
] as const satisfies readonly { value: string; label: MessageKey; noun: MessageKey }[];

const NONE = "__none__";

type BuilderScope = "deals" | "activities";

const SCOPES: { value: BuilderScope; label: MessageKey; hint: MessageKey }[] = [
  { value: "deals", label: "common.deals", hint: "insights.builder.scope.dealsHint" },
  { value: "activities", label: "common.activities", hint: "insights.builder.scope.activitiesHint" },
];

/** Icon per catalog field type, so the dropdowns read at a glance. */
function fieldIcon(f: InsightsField): ComponentType<{ className?: string }> {
  switch (f.type) {
    case "user":
      return User;
    case "date":
      return Calendar;
    case "pipeline":
      return GitBranch;
    case "stage":
      return Milestone;
    case "status":
      return CircleDot;
    case "double":
    case "monetary":
      return Hash;
    case "enum":
    case "set":
    case "boolean":
      return Tag;
    default:
      return Type;
  }
}

function FieldItem({ field }: { field: InsightsField }) {
  const Icon = fieldIcon(field);
  return (
    <span className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-subtle" />
      {field.label}
    </span>
  );
}

/** Date-basis dropdown (default = created) — shared by the KPI trend picker
 *  and the chart date-basis control so their options can't diverge. */
function DateBasisSelect({
  value,
  onChange,
  bases,
}: {
  value: string;
  onChange: (v: string) => void;
  bases: readonly { key: string; label: MessageKey }[];
}) {
  const { t } = useI18n();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("insights.builder.createdDefault")}</SelectItem>
        {bases.map((b) => (
          <SelectItem key={b.key} value={b.key}>
            {t("insights.basisDate", { basis: t(b.label) })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface BuilderResult {
  name: string;
  spec: InsightsWidgetSpec;
  viz: InsightsWidgetViz;
}

/** Everything the builder edits, as one value — the reset paths (open fresh,
 *  open for editing) construct a draft instead of each hand-calling every
 *  setter, so a new control can't be forgotten in one of them. */
interface BuilderDraft {
  name: string;
  scope: BuilderScope;
  agg: string;
  measureField: string;
  viewBy: string;
  bucket: string;
  segmentBy: string;
  vizType: string;
  filters: ExtendedFilterGroup;
  goal: string;
  topN: string;
  dateBasis: string;
  showValues?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  color?: string;
  compare: boolean;
}

function defaultDraft(): BuilderDraft {
  return {
    name: "",
    scope: "deals",
    agg: "count",
    measureField: "value",
    viewBy: "owner",
    bucket: "month",
    segmentBy: NONE,
    vizType: "bar",
    filters: structuredClone(EMPTY_EXTENDED_FILTER),
    goal: "",
    topN: "",
    dateBasis: NONE,
    compare: false,
  };
}

function draftFromWidget(widget: InsightsWidget): BuilderDraft {
  const options = (widget.spec.options ?? {}) as { goal?: unknown; topN?: unknown };
  const viz = (widget.viz.options ?? {}) as Record<string, unknown>;
  return {
    name: widget.name,
    scope: widget.spec.scope === "activities" ? "activities" : "deals",
    agg: widget.spec.measure.agg,
    measureField: widget.spec.measure.field,
    viewBy: widget.spec.viewBy?.field ?? NONE,
    bucket: widget.spec.viewBy?.dateBucket ?? "month",
    segmentBy: widget.spec.segmentBy?.field ?? NONE,
    vizType: widget.viz.type,
    filters:
      (widget.spec.filters as unknown as ExtendedFilterGroup) ??
      structuredClone(EMPTY_EXTENDED_FILTER),
    goal: typeof options.goal === "number" ? String(options.goal) : "",
    topN: typeof options.topN === "number" ? String(options.topN) : "",
    dateBasis: widget.spec.dateBasis ?? NONE,
    showValues: typeof viz.showValues === "boolean" ? viz.showValues : undefined,
    showLegend: typeof viz.showLegend === "boolean" ? viz.showLegend : undefined,
    showGrid: typeof viz.showGrid === "boolean" ? viz.showGrid : undefined,
    color: typeof viz.color === "string" ? viz.color : undefined,
    compare: viz.compare === true,
  };
}

function SectionTitle({
  step,
  icon: Icon,
  children,
}: {
  step: number;
  icon: ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border pb-1.5">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-caption text-foreground">
        {step}
      </span>
      <Icon className="h-3.5 w-3.5 text-subtle" />
      <span className="text-label text-foreground">
        {children}
      </span>
    </div>
  );
}

export function WidgetBuilder({
  open,
  initial,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  /** Present when editing; the builder opens pre-loaded. */
  initial?: InsightsWidget | null;
  onClose: () => void;
  onSave: (result: BuilderResult) => void;
  saving?: boolean;
}) {
  const { t, tPlural } = useI18n();
  const [scope, setScope] = useState<BuilderScope>("deals");
  const { data: fieldList } = useListInsightsFields({ scope });
  const fields = useMemo(() => fieldList?.fields ?? [], [fieldList]);
  const groupable = fields.filter((f) => f.groupable);
  const measurable = fields.filter((f) => f.measurable);
  const dateFieldKeys = useMemo(
    () => new Set(fields.filter((f) => f.type === "date").map((f) => f.key)),
    [fields],
  );
  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;

  const [name, setName] = useState("");
  const [agg, setAgg] = useState<string>("count");
  const [measureField, setMeasureField] = useState<string>("value");
  const [viewBy, setViewBy] = useState<string>("owner");
  const [bucket, setBucket] = useState<string>("month");
  const [segmentBy, setSegmentBy] = useState<string>(NONE);
  const [vizType, setVizType] = useState<string>("bar");
  const [filters, setFilters] = useState<ExtendedFilterGroup>(EMPTY_EXTENDED_FILTER);
  const [goal, setGoal] = useState<string>("");
  const [topN, setTopN] = useState<string>("");
  const [dateBasis, setDateBasis] = useState<string>(NONE);
  const [showValues, setShowValues] = useState<boolean | undefined>(undefined);
  const [showLegend, setShowLegend] = useState<boolean | undefined>(undefined);
  const [showGrid, setShowGrid] = useState<boolean | undefined>(undefined);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [compare, setCompare] = useState(false);

  /** Scope switch: the vocabularies don't overlap, so dependent choices
   *  reset to that scope's defaults. */
  const changeScope = (next: BuilderScope) => {
    if (next === scope) return;
    setScope(next);
    setAgg("count");
    setMeasureField("value");
    setViewBy(next === "activities" ? "type" : "owner");
    setSegmentBy(NONE);
    setFilters(structuredClone(EMPTY_EXTENDED_FILTER));
    setDateBasis(NONE);
    setTopN("");
    if (next === "activities" && vizType === "funnel") setVizType("bar");
  };

  useEffect(() => {
    if (!open) return;
    const d = initial ? draftFromWidget(initial) : defaultDraft();
    setName(d.name);
    setScope(d.scope);
    setAgg(d.agg);
    setMeasureField(d.measureField);
    setViewBy(d.viewBy);
    setBucket(d.bucket);
    setSegmentBy(d.segmentBy);
    setVizType(d.vizType);
    setFilters(d.filters);
    setGoal(d.goal);
    setTopN(d.topN);
    setDateBasis(d.dateBasis);
    setShowValues(d.showValues);
    setShowLegend(d.showLegend);
    setShowGrid(d.showGrid);
    setColor(d.color);
    setCompare(d.compare);
  }, [open, initial]);

  const viewByIsDate = dateFieldKeys.has(viewBy);
  // The funnel owns its axis (pipeline stages) and reads count or sum(value);
  // grouping/segmenting controls don't apply.
  const isFunnel = vizType === "funnel";
  const isKpi = vizType === "singleNumber";
  const funnelAgg = agg === "sum" ? "sum" : "count";
  // Splitting works on any x-axis, dates included ("weekly deals by stage").
  const canSegment = !isFunnel && !isKpi && viewBy !== NONE;
  const hasSegment = canSegment && segmentBy !== NONE;

  const noun = t(scope === "activities" ? "insights.builder.noun.activities" : "insights.builder.noun.deals");
  // Scopes without numeric fields (activities) can only count.
  const aggOptions =
    fieldList && measurable.length === 0
      ? AGG_OPTIONS.filter((a) => a.value === "count")
      : AGG_OPTIONS;
  const dateBases = scope === "activities" ? ACTIVITY_DATE_BASES : DATE_BASES;

  const canCompare =
    !isFunnel &&
    !isKpi &&
    viewByIsDate &&
    !hasSegment &&
    (vizType === "bar" || vizType === "line" || vizType === "area");

  const buildViz = (): InsightsWidgetViz => {
    const options: Record<string, unknown> = {};
    if (showValues !== undefined) options.showValues = showValues;
    if (showLegend !== undefined) options.showLegend = showLegend;
    if (showGrid !== undefined) options.showGrid = showGrid;
    if (color !== undefined) options.color = color;
    if (compare && canCompare) options.compare = true;
    return {
      type: vizType as InsightsWidgetViz["type"],
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  };

  const buildSpec = (): InsightsWidgetSpec => {
    const goalNum = Number(goal);
    const topNNum = Number(topN);
    const options = {
      ...(goal.trim() !== "" && Number.isFinite(goalNum) ? { goal: goalNum } : {}),
      ...(!isFunnel && topN.trim() !== "" && Number.isInteger(topNNum) && topNNum > 0
        ? { topN: Math.min(100, topNNum) }
        : {}),
    };
    return {
      version: 1,
      scope,
      reportType: isFunnel ? "conversionFunnel" : "performance",
      measure: isFunnel
        ? { agg: funnelAgg, field: funnelAgg === "sum" ? "value" : "id" }
        : {
            agg: agg as InsightsWidgetSpec["measure"]["agg"],
            field: agg === "count" ? "id" : measureField,
          },
      ...(!isFunnel && !isKpi && viewBy !== NONE
        ? {
            viewBy: {
              field: viewBy,
              ...(viewByIsDate
                ? { dateBucket: bucket as "day" | "week" | "month" | "quarter" }
                : {}),
            },
          }
        : {}),
      ...(canSegment && segmentBy !== NONE ? { segmentBy: { field: segmentBy } } : {}),
      filters: pruneFilters(filters) as unknown as InsightsWidgetSpec["filters"],
      ...(dateBasis !== NONE
        ? { dateBasis: dateBasis as InsightsWidgetSpec["dateBasis"] }
        : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  };

  // What the widget MEANS, as a sentence — the single best defense against
  // building a chart you can't interpret.
  const summary = useMemo(() => {
    if (isFunnel) {
      return t(funnelAgg === "sum" ? "insights.builder.summary.funnelValue" : "insights.builder.summary.funnelCount");
    }
    const aggOption = AGG_OPTIONS.find((a) => a.value === agg);
    const aggLabel =
      agg === "count"
        ? t("insights.builder.summary.numberOf", { noun })
        : t("insights.builder.summary.aggOf", { agg: aggOption ? t(aggOption.label) : agg, field: labelOf(measureField).toLowerCase() });
    const parts = [aggLabel];
    if (isKpi) {
      parts.push(t("insights.builder.summary.singleFigure"));
    } else if (viewBy !== NONE) {
      const bucketOption = BUCKETS.find((b) => b.value === bucket);
      parts.push(
        viewByIsDate
          ? t("insights.builder.summary.perBucket", { bucket: bucketOption ? t(bucketOption.noun) : bucket, field: labelOf(viewBy).toLowerCase() })
          : t("insights.builder.summary.byField", { field: labelOf(viewBy).toLowerCase() }),
      );
      if (hasSegment) parts.push(t("insights.builder.summary.splitBy", { field: labelOf(segmentBy).toLowerCase() }));
    } else {
      parts.push(t("insights.builder.summary.oneTotal"));
    }
    const filterCount = countGroupConditions(pruneFilters(filters));
    if (filterCount > 0) parts.push(tPlural("insights.builder.summary.withFilters", filterCount));
    return parts.join(", ") + ".";
  }, [isFunnel, isKpi, funnelAgg, agg, measureField, viewBy, viewByIsDate, bucket, hasSegment, segmentBy, filters, noun, t, tPlural]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview: debounce the draft so keystrokes in the filter rows don't
  // fire a query each; the preview runs the exact spec that would be saved.
  const [previewSpec, setPreviewSpec] = useState<InsightsWidgetSpec | null>(null);
  const draftKey = JSON.stringify({
    scope, agg, measureField, viewBy, bucket, segmentBy, vizType, filters, goal, topN, dateBasis,
  });
  useEffect(() => {
    if (!open) {
      setPreviewSpec(null);
      return;
    }
    const timer = setTimeout(() => setPreviewSpec(buildSpec()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey]);

  const preview = useWidgetData(
    previewSpec ?? { version: 1, scope: "deals", reportType: "performance", measure: { field: "id", agg: "count" }, filters: EMPTY_EXTENDED_FILTER as unknown as InsightsWidgetSpec["filters"] },
    undefined,
    open && previewSpec !== null,
  ); // placeholder spec above never runs: `enabled` gates on previewSpec

  const save = () => {
    onSave({
      name: name.trim() || t("insights.builder.untitledWidget"),
      spec: buildSpec(),
      viz: buildViz(),
    });
  };

  // Shared between the two layouts: categorical x-axes show it beside
  // "Group by"; date x-axes (whose slot holds Granularity) show it below.
  const segmentSelect = (
    <Select
      value={segmentBy}
      onValueChange={setSegmentBy}
      disabled={viewBy === NONE}
    >
      <SelectTrigger data-testid="segment-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("insights.builder.noSplit")}</SelectItem>
        {groupable
          .filter((f) => f.key !== viewBy && !dateFieldKeys.has(f.key))
          .map((f) => (
            <SelectItem key={f.key} value={f.key}>
              <FieldItem field={f} />
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{initial ? t("insights.builder.editWidget") : t("insights.builder.newWidget")}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[360px_1fr]">
          {/* Config column */}
          <div className="min-h-0 space-y-5 overflow-y-auto pe-1">
            <div className="space-y-1.5">
              <Label htmlFor="widget-name">{t("common.name")}</Label>
              <Input
                id="widget-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("insights.builder.namePlaceholder")}
              />
            </div>

            {/* 1 — chart shape */}
            <div className="space-y-2.5">
              <SectionTitle step={1} icon={BarChartHorizontalBig}>
                {t("insights.builder.chartType")}
              </SectionTitle>
              <div className="grid grid-cols-4 gap-1.5" data-testid="viz-tiles">
                {VIZ_TILES.map((v) => {
                  const Icon = v.icon;
                  const active = vizType === v.value;
                  // The funnel reads pipeline stages — deals only.
                  const unavailable = scope === "activities" && v.value === "funnel";
                  return (
                    <button
                      key={v.value}
                      type="button"
                      disabled={unavailable}
                      title={unavailable ? t("insights.builder.dealsOnly") : t(v.hint)}
                      data-testid={`viz-tile-${v.value}`}
                      onClick={() => setVizType(v.value)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors",
                        active
                          ? "border-gray-alpha-400 bg-gray-alpha-100 text-foreground"
                          : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                        unavailable && "cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-brand" : "text-subtle")} />
                      {t(v.label)}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const hint = VIZ_TILES.find((v) => v.value === vizType)?.hint;
                return hint ? (
                  <p className="text-caption-quiet text-subtle">{t(hint)}</p>
                ) : null;
              })()}
            </div>

            {/* 2 — data */}
            <div className="space-y-3">
              <SectionTitle step={2} icon={Hash}>
                {t("insights.builder.data")}
              </SectionTitle>
              <div className="space-y-1.5">
                <Label>{t("insights.builder.dataSource")}</Label>
                <div className="grid grid-cols-2 gap-1.5" data-testid="scope-toggle">
                  {SCOPES.map((s) => {
                    const active = scope === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        title={t(s.hint)}
                        data-testid={`scope-${s.value}`}
                        onClick={() => changeScope(s.value)}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-caption transition-colors",
                          active
                            ? "border-gray-alpha-400 bg-gray-alpha-100 text-foreground"
                            : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                        )}
                      >
                        {t(s.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {isFunnel ? (
                <>
                  <div className="space-y-1.5">
                    <Label>{t("insights.builder.measureStagesBy")}</Label>
                    <Select value={funnelAgg} onValueChange={setAgg}>
                      <SelectTrigger data-testid="agg-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="count">{t("insights.builder.numberOfDeals")}</SelectItem>
                        <SelectItem value="sum">{t("insights.builder.totalDealValue")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-caption-quiet leading-5 text-muted-foreground">
                    {t("insights.builder.stagesHint")}
                  </p>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>{t("insights.builder.measure")}</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={agg} onValueChange={setAgg}>
                        <SelectTrigger data-testid="agg-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {aggOptions.map((a) => (
                            <SelectItem key={a.value} value={a.value}>
                              {a.value === "count" ? t("insights.builder.countOf", { noun }) : t(a.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={agg === "count" ? "id" : measureField}
                        onValueChange={setMeasureField}
                        disabled={agg === "count"}
                      >
                        <SelectTrigger data-testid="measure-select">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {agg === "count" ? (
                            <SelectItem value="id">{noun}</SelectItem>
                          ) : (
                            measurable.map((f) => (
                              <SelectItem key={f.key} value={f.key}>
                                <FieldItem field={f} />
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] leading-4 text-subtle">
                      {agg === "count"
                        ? t("insights.builder.howMany", { noun })
                        : t("insights.builder.measureHint")}
                    </p>
                  </div>

                  {!isKpi && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>{t("insights.builder.groupBy")}</Label>
                        <Select value={viewBy} onValueChange={setViewBy}>
                          <SelectTrigger data-testid="viewby-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t("insights.builder.nothingOneTotal")}</SelectItem>
                            {groupable.map((f) => (
                              <SelectItem key={f.key} value={f.key}>
                                <FieldItem field={f} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{viewByIsDate ? t("insights.builder.granularity") : t("insights.builder.splitIntoSeries")}</Label>
                        {viewByIsDate ? (
                          <Select value={bucket} onValueChange={setBucket}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {BUCKETS.map((b) => (
                                <SelectItem key={b.value} value={b.value}>
                                  {t(b.label)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          segmentSelect
                        )}
                      </div>
                    </div>
                  )}
                  {!isKpi && viewByIsDate && (
                    <div className="space-y-1.5">
                      <Label>{t("insights.builder.splitIntoSeries")}</Label>
                      {segmentSelect}
                      <p className="text-[11px] leading-4 text-subtle">
                        {t("insights.builder.stackHint", { bucket: t(BUCKETS.find((b) => b.value === bucket)?.noun ?? "insights.builder.bucketNoun.month") })}
                      </p>
                    </div>
                  )}
                  {isKpi && (
                    <div className="space-y-1.5">
                      <Label>{t("insights.builder.trendBasedOn")}</Label>
                      <DateBasisSelect
                        value={dateBasis}
                        onChange={setDateBasis}
                        bases={dateBases}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 3 — customize */}
            {!isFunnel && (
              <div className="space-y-3">
                <SectionTitle step={3} icon={Settings2}>
                  {t("insights.builder.customize")}
                </SectionTitle>
                {!isKpi && vizType !== "table" && (
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <Label className="flex cursor-pointer items-center gap-2 text-body-quiet font-normal">
                      <Checkbox
                        checked={
                          showValues ??
                          (vizType === "bar" || vizType === "horizontalBar" || vizType === "pie")
                        }
                        onCheckedChange={(c) => setShowValues(c === true)}
                        data-testid="opt-show-values"
                      />
                      {t("insights.builder.numbersOnChart")}
                    </Label>
                    {hasSegment && (
                      <Label className="flex cursor-pointer items-center gap-2 text-body-quiet font-normal">
                        <Checkbox
                          checked={showLegend ?? true}
                          onCheckedChange={(c) => setShowLegend(c === true)}
                        />
                        {t("insights.builder.legend")}
                      </Label>
                    )}
                    {vizType !== "pie" && vizType !== "horizontalBar" && (
                      <Label className="flex cursor-pointer items-center gap-2 text-body-quiet font-normal">
                        <Checkbox
                          checked={showGrid ?? true}
                          onCheckedChange={(c) => setShowGrid(c === true)}
                        />
                        {t("insights.builder.gridLines")}
                      </Label>
                    )}
                    {canCompare && (
                      <Label className="flex cursor-pointer items-center gap-2 text-body-quiet font-normal">
                        <Checkbox
                          checked={compare}
                          onCheckedChange={(c) => setCompare(c === true)}
                          data-testid="opt-compare"
                        />
                        {t("insights.builder.comparePrevious")}
                      </Label>
                    )}
                  </div>
                )}
                {canCompare && compare && (
                  <p className="text-[11px] leading-4 text-subtle">
                    {t("insights.builder.comparePreviousHint")}
                  </p>
                )}
                {!hasSegment && vizType !== "table" && vizType !== "pie" && (
                  <div className="space-y-1.5">
                    <Label>{t("insights.builder.color")}</Label>
                    <div className="flex gap-1.5">
                      {ACCENT_CHOICES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={t("insights.builder.colorAria", { name: c })}
                          onClick={() => setColor(color === c ? undefined : c)}
                          className={cn(
                            "h-6 w-6 rounded-full border-2 transition-transform",
                            (color ?? ACCENT_CHOICES[0]) === c
                              ? "scale-110 border-gray-900"
                              : "border-transparent hover:scale-105",
                          )}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t("insights.builder.goal")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      placeholder="e.g. 100000"
                      data-testid="goal-input"
                    />
                  </div>
                  {!isKpi && !viewByIsDate && viewBy !== NONE ? (
                    <div className="space-y-1.5">
                      <Label>{t("insights.builder.showTopN")}</Label>
                      <Input
                        type="number"
                        min={2}
                        max={100}
                        value={topN}
                        onChange={(e) => setTopN(e.target.value)}
                        placeholder="all"
                      />
                    </div>
                  ) : !isKpi ? (
                    <div className="space-y-1.5">
                      <Label>{t("insights.builder.dateBasis")}</Label>
                      <DateBasisSelect
                        value={dateBasis}
                        onChange={setDateBasis}
                        bases={dateBases}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* 4 — filters */}
            <div className="space-y-2">
              <SectionTitle step={isFunnel ? 3 : 4} icon={FilterIcon}>
                {t("common.filters")}
              </SectionTitle>
              <p className="text-[11px] leading-4 text-subtle">
                {t("insights.builder.filtersHint")}
              </p>
              <InsightsFilterEditor
                group={filters}
                fields={fields}
                onChange={setFilters}
                inModal
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="flex min-h-72 flex-col rounded-lg border border-border bg-surface-whisper/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-caption text-subtle">
                {t("common.preview")}
              </span>
              {preview.isFetching && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" />
              )}
            </div>
            <div className="min-h-0 flex-1 rounded-md bg-background p-2">
              {preview.isError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-body-quiet text-destructive">
                  {preview.error?.message || t("insights.queryFailed")}
                </div>
              ) : preview.data && previewSpec ? (
                <WidgetChart
                  result={preview.data}
                  viz={buildViz()}
                  monetary={isMonetarySpec(previewSpec)}
                  spec={previewSpec}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-body-quiet text-subtle">
                  <Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("insights.builder.loadingPreview")}
                </div>
              )}
            </div>
            {/* The sentence: what this widget means, in words. */}
            <div
              className="mt-2.5 rounded-md bg-surface-whisper px-3 py-2 text-caption-quiet leading-5 text-brand"
              data-testid="builder-summary"
            >
              {summary}
            </div>
            <p className="mt-2 text-[11px] text-subtle">
              {t("insights.builder.previewHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving} data-testid="save-widget">
            {initial ? t("common.save") : t("insights.builder.addWidget")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
