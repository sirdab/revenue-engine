import { useEffect, useState } from "react";
import {
  useListStages,
  useListDealOwners,
  useListLostReasons,
  useListPipelines,
} from "@workspace/api-client-react";
import type { Stage, DealOwner, Pipeline } from "@workspace/api-client-react";
import {
  FILTER_FIELDS,
  FILTER_FIELD_MAP,
  EMPTY_FILTER,
  encodeFilters,
  decodeFilters,
  isFilterGroup,
  countConditions,
  maxDepth,
  operatorTakesValue,
  type FilterGroup,
  type FilterNode,
  type FilterCondition,
  type FilterFieldDef,
  type FilterFieldName,
  type FilterOperator,
} from "@workspace/deals-filter";
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
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Filter, Plus, X, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";
import { filterFieldLabel, filterGroupLabel, filterOperatorLabel } from "@/lib/deals-filter-labels";

const MAX_DEPTH = 3;
const STATUS_OPTIONS = ["open", "won", "lost", "deleted"];

function LostReasonValue({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const { data: reasons } = useListLostReasons();
  const items = (reasons ?? []).map((r) => ({ value: r.name, label: r.name }));
  // Historical free-text reasons (or reasons renamed since the filter was
  // saved) still render and stay selectable instead of blanking out.
  if (value && !items.some((i) => i.value === value)) {
    items.push({ value, label: `${value} (unmanaged)` });
  }
  return (
    <Combobox
      items={items}
      value={value}
      onChange={(v) => onChange(v)}
      placeholder={t("deals.filter.selectReason")}
      triggerClassName="h-8 w-44 px-2"
    />
  );
}

export interface BuilderCtx {
  stages: Stage[];
  users: DealOwner[];
  pipelines?: Pipeline[];
  pipelineId?: number;
  /** Field vocabulary offered by the picker. Defaults to the full deals-list
   *  set; the assignment-rule/automation wizards pass RULE_FILTER_FIELDS. */
  fields?: FilterFieldDef[];
}

function decodeSafe(encoded?: string): FilterGroup {
  if (!encoded) return structuredClone(EMPTY_FILTER);
  try {
    return decodeFilters(encoded);
  } catch {
    return structuredClone(EMPTY_FILTER);
  }
}

function newCondition(): FilterCondition {
  return { field: "title", operator: "contains", value: "" };
}

// ---------------------------------------------------------------------------
// Value editor — shape depends on field type + operator.
// ---------------------------------------------------------------------------

function ValueEditor({
  condition,
  onChange,
  ctx,
}: {
  condition: FilterCondition;
  onChange: (value: FilterCondition["value"]) => void;
  ctx: BuilderCtx;
}) {
  const { t } = useI18n();
  const def = FILTER_FIELD_MAP[condition.field];
  if (!operatorTakesValue(condition.operator)) return null;

  if (condition.operator === "between") {
    const arr = Array.isArray(condition.value)
      ? condition.value
      : [null, null];
    if (def.type === "date") {
      // Date range still stores a `[yyyy-mm-dd, yyyy-mm-dd]` tuple in the DSL;
      // clearing a bound emits "" which we map back to null. disablePortal
      // because the builder itself lives inside a Popover.
      return (
        <div className="flex items-center gap-1">
          <DatePicker
            className="h-8 w-40"
            value={typeof arr[0] === "string" ? arr[0] : ""}
            onChange={(next) => onChange([next === "" ? null : next, arr[1] ?? null])}
          />
          <span className="text-xs text-slate-400">and</span>
          <DatePicker
            className="h-8 w-40"
            value={typeof arr[1] === "string" ? arr[1] : ""}
            onChange={(next) => onChange([arr[0] ?? null, next === "" ? null : next])}
          />
        </div>
      );
    }
    const parse = (raw: string) => (raw === "" ? null : Number(raw));
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          className="h-8 w-28"
          value={arr[0] == null ? "" : String(arr[0])}
          onChange={(e) => onChange([parse(e.target.value), arr[1] ?? null])}
        />
        <span className="text-xs text-slate-400">and</span>
        <Input
          type="number"
          className="h-8 w-28"
          value={arr[1] == null ? "" : String(arr[1])}
          onChange={(e) => onChange([arr[0] ?? null, parse(e.target.value)])}
        />
      </div>
    );
  }

  switch (def.type) {
    case "number":
      return (
        <Input
          type="number"
          className="h-8 w-40"
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    case "date":
      return (
        <DatePicker
          className="h-8 w-40"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(next) => onChange(next)}
        />
      );
    case "pipeline":
      return (
        <Combobox
          items={(ctx.pipelines ?? []).map((p) => ({
            value: p.id.toString(),
            label: p.name,
          }))}
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(v) => onChange(Number(v))}
          placeholder={t("deals.selectPipeline")}
          triggerClassName="h-8 w-40 px-2"
        />
      );
    case "stage": {
      // Scoped (deals page passes pipelineId): flat list of that pipeline's
      // stages. Unscoped (rule/automation wizards): every stage, grouped
      // under its pipeline — folder/files style — so same-named stages
      // across pipelines are unambiguous.
      const scoped = ctx.pipelineId != null;
      const pipelineName = new Map(
        (ctx.pipelines ?? []).map((p) => [p.id, p.name]),
      );
      const pipelineOrder = new Map(
        (ctx.pipelines ?? []).map((p, i) => [p.id, i]),
      );
      const options = ctx.stages
        .filter((s) => (scoped ? s.pipelineId === ctx.pipelineId : true))
        .sort((a, b) =>
          scoped
            ? a.orderIndex - b.orderIndex
            : (pipelineOrder.get(a.pipelineId) ?? 0) -
                (pipelineOrder.get(b.pipelineId) ?? 0) ||
              a.orderIndex - b.orderIndex,
        );
      return (
        <Combobox
          items={options.map((s) => ({
            value: s.id.toString(),
            label: s.name,
            ...(scoped
              ? {}
              : {
                  group:
                    pipelineName.get(s.pipelineId) ?? t("deals.filter.pipelineFallback", { id: s.pipelineId }),
                }),
          }))}
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(v) => onChange(Number(v))}
          placeholder={t("deals.selectStage")}
          triggerClassName="h-8 w-40 px-2"
          renderCap={scoped ? undefined : 1000}
        />
      );
    }
    case "owner":
      return (
        <Combobox
          items={ctx.users.map((u) => ({
            value: u.id.toString(),
            label: u.name,
          }))}
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(v) => onChange(Number(v))}
          placeholder={t("deals.filter.selectOwner")}
          triggerClassName="h-8 w-40 px-2"
        />
      );
    case "lostReason":
      return (
        <LostReasonValue
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(v) => onChange(v)}
        />
      );
    case "status":
      return (
        <Combobox
          options={STATUS_OPTIONS}
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(v) => onChange(v)}
          renderLabel={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
          placeholder={t("deals.filter.selectStatus")}
          triggerClassName="h-8 w-40 px-2"
        />
      );
    case "bool":
      return (
        <Select
          value={
            condition.value === true
              ? "true"
              : condition.value === false
                ? "false"
                : ""
          }
          onValueChange={(v) => onChange(v === "true")}
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder={t("common.selectEllipsis")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t("common.yes")}</SelectItem>
            <SelectItem value="false">{t("common.no")}</SelectItem>
          </SelectContent>
        </Select>
      );
    default:
      return (
        <Input
          dir="auto"
          className="h-8 w-40"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  ctx,
}: {
  condition: FilterCondition;
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
  ctx: BuilderCtx;
}) {
  const { t } = useI18n();
  const def = FILTER_FIELD_MAP[condition.field];

  const setField = (field: FilterFieldName) => {
    const d = FILTER_FIELD_MAP[field];
    const operator = d.operators.includes(condition.operator)
      ? condition.operator
      : d.operators[0];
    // Bool fields render a Yes/No select with no empty state — seed `true` so a
    // condition is valid the moment the field is chosen (otherwise Apply would
    // send value:undefined and the server rejects it with a 400).
    const value = d.type === "bool" ? true : undefined;
    onChange({ field, operator, value });
  };

  const setOperator = (operator: FilterOperator) => {
    const value =
      operator === "between"
        ? [null, null]
        : operatorTakesValue(operator)
          ? undefined
          : undefined;
    onChange({ ...condition, operator, value });
  };

  const fields = ctx.fields ?? FILTER_FIELDS;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Combobox
        items={fields.map((f) => ({
          value: f.field,
          // Disambiguate the long tail by its column-picker section.
          label: f.group ? `${filterFieldLabel(t, f)} · ${filterGroupLabel(t, f.group)}` : filterFieldLabel(t, f),
        }))}
        value={condition.field}
        onChange={(v) => setField(v as FilterFieldName)}
        placeholder={t("filter.searchFields")}
        triggerClassName="h-8 w-40 px-2"
      />

      <Select
        value={condition.operator}
        onValueChange={(v) => setOperator(v as FilterOperator)}
      >
        <SelectTrigger className="h-8 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {def.operators.map((op) => (
            <SelectItem key={op} value={op}>
              {filterOperatorLabel(t, op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ValueEditor
        condition={condition}
        onChange={(value) => onChange({ ...condition, value })}
        ctx={ctx}
      />

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-400 hover:text-red-600"
        onClick={onRemove}
        aria-label={t("filter.removeCondition")}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Exported for reuse by the assignment-rules wizard, which renders the same
// recursive condition builder inline (without the deals-page popover/URL-state
// wrapper). The MAX_DEPTH cap (3) is well under the assignment-rules service
// limit (5), so anything built here is always accepted.
export function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
  ctx,
}: {
  group: FilterGroup;
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
  depth: number;
  ctx: BuilderCtx;
}) {
  const { t } = useI18n();
  const updateChild = (i: number, node: FilterNode) =>
    onChange({
      ...group,
      conditions: group.conditions.map((c, idx) => (idx === i ? node : c)),
    });
  const removeChild = (i: number) =>
    onChange({
      ...group,
      conditions: group.conditions.filter((_, idx) => idx !== i),
    });

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3",
        depth === 1 ? "border-slate-200 bg-card" : "border-slate-200 bg-slate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <Select
          value={group.combinator}
          onValueChange={(v) =>
            onChange({ ...group, combinator: v as "and" | "or" })
          }
        >
          <SelectTrigger className="h-7 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">AND</SelectItem>
            <SelectItem value="or">OR</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400">
          match {group.combinator === "and" ? "all" : "any"} of
        </span>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="ms-auto h-7 w-7 text-slate-400 hover:text-red-600"
            onClick={onRemove}
            aria-label={t("filter.removeGroup")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2 ps-2">
        {group.conditions.length === 0 && (
          <p className="text-xs text-slate-400">{t("filter.noConditions")}</p>
        )}
        {group.conditions.map((node, i) =>
          isFilterGroup(node) ? (
            <GroupEditor
              key={i}
              group={node}
              depth={depth + 1}
              ctx={ctx}
              onChange={(n) => updateChild(i, n)}
              onRemove={() => removeChild(i)}
            />
          ) : (
            <ConditionRow
              key={i}
              condition={node}
              ctx={ctx}
              onChange={(n) => updateChild(i, n)}
              onRemove={() => removeChild(i)}
            />
          ),
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() =>
            onChange({
              ...group,
              conditions: [...group.conditions, newCondition()],
            })
          }
        >
          <Plus className="me-1 h-3.5 w-3.5" />
          {t("filter.condition")}
        </Button>
        {depth < MAX_DEPTH && (
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() =>
              onChange({
                ...group,
                conditions: [
                  ...group.conditions,
                  { combinator: "and", conditions: [] },
                ],
              })
            }
          >
            <FolderPlus className="me-1 h-3.5 w-3.5" />
            {t("filter.group")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function DealsFilterBuilder({
  state,
  update,
}: {
  state: DealsUrlState;
  update: (partial: Partial<DealsUrlState>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup>(() =>
    decodeSafe(state.filters),
  );
  const { data: stages } = useListStages();
  const { data: users } = useListDealOwners();
  const { data: pipelines } = useListPipelines();

  // Re-sync the draft from the URL whenever the popover is opened so external
  // changes (saved views, shared links) are reflected.
  useEffect(() => {
    if (open) setDraft(decodeSafe(state.filters));
  }, [open, state.filters]);

  const ctx: BuilderCtx = {
    stages: stages ?? [],
    users: users ?? [],
    pipelines: pipelines ?? [],
    pipelineId: state.pipelineId,
  };

  const activeCount = (() => {
    try {
      return state.filters ? countConditions(decodeFilters(state.filters)) : 0;
    } catch {
      return 0;
    }
  })();

  const apply = () => {
    if (countConditions(draft) === 0) {
      update({ filters: undefined });
    } else if (maxDepth(draft) > MAX_DEPTH) {
      // Defensive: should be unreachable via the UI guard.
      return;
    } else {
      update({ filters: encodeFilters(draft) });
    }
    setOpen(false);
  };

  const clearAll = () => {
    setDraft(structuredClone(EMPTY_FILTER));
    update({ filters: undefined });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(activeCount > 0 && "border-teal-500 text-teal-700")}>
          <Filter className="me-1.5 h-4 w-4" />
          {t("common.filter")}
          {activeCount > 0 && (
            <Badge className="ms-1.5 bg-teal-600 px-1.5 hover:bg-teal-600">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[560px] max-w-[92vw] p-3">
        <div className="max-h-[60vh] overflow-auto">
          <GroupEditor group={draft} onChange={setDraft} depth={1} ctx={ctx} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {t("common.clearAll")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={apply}
            >
              {t("common.apply")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
