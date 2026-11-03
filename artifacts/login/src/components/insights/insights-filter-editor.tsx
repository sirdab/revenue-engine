import {
  useListDealOwners,
  useListLostReasons,
  useListPipelines,
  useListStages,
  type InsightsField,
} from "@workspace/api-client-react";
import {
  countConditions,
  isFilterGroup,
  type ExtendedFilterCondition,
  type ExtendedFilterGroup,
  type ExtendedFilterNode,
  type FilterGroup,
  type FilterOperator,
} from "@workspace/deals-filter";
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
import { Plus, X, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";
import { filterOperatorLabel } from "@/lib/deals-filter-labels";

// ---------------------------------------------------------------------------
// Scope-aware condition builder for Insights (ticket §7.2/§7.3, ADR-E2).
//
// Same recursive group/condition UX as the deals-page builder, but the field
// vocabulary comes from /insights/fields — the per-scope allow-list including
// registry custom fields (`cf:<key>`) — instead of the fixed base-DSL list.
// Emits ExtendedFilterGroup, which both the widget spec and the board's
// Add-filter encoding accept. The DSL itself is never forked: operators,
// group shape and encoding are the shared @workspace/deals-filter ones.
// ---------------------------------------------------------------------------

export type { InsightsField };

const MAX_DEPTH = 3;

const TEXT_OPS: FilterOperator[] = ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty"];
const NUMBER_OPS: FilterOperator[] = ["is", "is_not", "gt", "lt", "between", "is_empty", "is_not_empty"];
const DATE_OPS: FilterOperator[] = ["is", "gt", "lt", "between", "is_empty", "is_not_empty"];
const REF_OPS: FilterOperator[] = ["is", "is_not", "is_empty", "is_not_empty"];
const ENUM_ONLY_OPS: FilterOperator[] = ["is", "is_not"];

/** Operators the server compiler accepts for a catalog field type. */
export function operatorsFor(field: InsightsField): FilterOperator[] {
  switch (field.type) {
    case "double":
    case "monetary":
      return NUMBER_OPS;
    case "date":
      return DATE_OPS;
    case "user":
    case "pipeline":
    case "stage":
      return REF_OPS;
    case "status":
    case "boolean":
      return ENUM_ONLY_OPS;
    case "enum":
    case "set":
      return field.options && field.options.length > 0 ? REF_OPS : TEXT_OPS;
    default:
      return TEXT_OPS;
  }
}

function operatorTakesValue(op: FilterOperator): boolean {
  return op !== "is_empty" && op !== "is_not_empty";
}

function newCondition(fields: InsightsField[]): ExtendedFilterCondition {
  const first = fields[0];
  return {
    field: first?.key ?? "title",
    operator: first ? operatorsFor(first)[0] : "contains",
    value: undefined,
  };
}

const DEAL_STATUSES = ["open", "won", "lost", "deleted"] as const;

function LostReasonValue({
  value,
  onChange,
  inModal,
}: {
  value: string;
  onChange: (v: string) => void;
  inModal?: boolean;
}) {
  const { t } = useI18n();
  const { data: reasons } = useListLostReasons();
  const items = (reasons ?? []).map((r) => ({ value: r.name, label: r.name }));
  if (value && !items.some((i) => i.value === value)) {
    items.push({ value, label: `${value} (unmanaged)` });
  }
  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      placeholder={t("deals.filter.selectReason")}
      triggerClassName="h-8 w-44 px-2"
      inModal={inModal}
    />
  );
}

function ValueEditor({
  field,
  condition,
  onChange,
  inModal,
}: {
  field: InsightsField;
  condition: ExtendedFilterCondition;
  onChange: (value: ExtendedFilterCondition["value"]) => void;
  inModal?: boolean;
}) {
  const { t } = useI18n();
  const { data: owners } = useListDealOwners();
  const { data: pipelines } = useListPipelines();
  const { data: stages } = useListStages();

  if (!operatorTakesValue(condition.operator as FilterOperator)) return null;

  if (condition.operator === "between") {
    const arr = Array.isArray(condition.value) ? condition.value : [null, null];
    if (field.type === "date") {
      // Date range: the DSL still stores a `[yyyy-mm-dd, yyyy-mm-dd]` tuple;
      // clearing a bound emits "" which we map back to null. disablePortal is
      // unconditional because every host of this editor is portalled (the board
      // and widget-shell Popovers, the widget-builder Dialog), so a body-portaled
      // calendar day-click would otherwise dismiss the surrounding popover.
      return (
        <div className="flex items-center gap-1">
          <DatePicker
            className="h-8 w-40"
            value={typeof arr[0] === "string" ? arr[0] : ""}
            onChange={(next) => onChange([next === "" ? null : next, arr[1] ?? null])}
          />
          <span className="text-xs text-subtle">and</span>
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
        <span className="text-xs text-subtle">and</span>
        <Input
          type="number"
          className="h-8 w-28"
          value={arr[1] == null ? "" : String(arr[1])}
          onChange={(e) => onChange([arr[0] ?? null, parse(e.target.value)])}
        />
      </div>
    );
  }

  switch (field.type) {
    case "double":
    case "monetary":
      return (
        <Input
          type="number"
          className="h-8 w-36"
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
    case "user":
      return (
        <Combobox
          items={(owners ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(v) => onChange(Number(v))}
          placeholder={t("deals.filter.selectOwner")}
          triggerClassName="h-8 w-40 px-2"
          inModal={inModal}
        />
      );
    case "pipeline":
      return (
        <Combobox
          items={(pipelines ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(v) => onChange(Number(v))}
          placeholder={t("deals.selectPipeline")}
          triggerClassName="h-8 w-40 px-2"
          inModal={inModal}
        />
      );
    case "stage":
      return (
        <Combobox
          items={(stages ?? [])
            .slice()
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((s) => ({ value: String(s.id), label: s.name }))}
          value={condition.value == null ? "" : String(condition.value)}
          onChange={(v) => onChange(Number(v))}
          placeholder={t("deals.selectStage")}
          triggerClassName="h-8 w-40 px-2"
          inModal={inModal}
        />
      );
    case "status":
      return (
        <Select
          value={typeof condition.value === "string" ? condition.value : ""}
          onValueChange={onChange}
        >
          <SelectTrigger className="h-8 w-36">
            <SelectValue placeholder={t("common.status")} />
          </SelectTrigger>
          <SelectContent>
            {DEAL_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "boolean":
      return (
        <Select
          value={
            typeof condition.value === "boolean" ? String(condition.value) : ""
          }
          onValueChange={(v) => onChange(v === "true")}
        >
          <SelectTrigger className="h-8 w-28">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t("common.yes")}</SelectItem>
            <SelectItem value="false">{t("common.no")}</SelectItem>
          </SelectContent>
        </Select>
      );
    case "enum":
    case "set": {
      if (field.options && field.options.length > 0) {
        // Registry set values store labels, so filter on the label text.
        const items = field.options.map((o) => ({ value: o.label, label: o.label }));
        return (
          <Combobox
            items={items}
            value={typeof condition.value === "string" ? condition.value : ""}
            onChange={onChange}
            placeholder={t("insights.selectValue")}
            triggerClassName="h-8 w-44 px-2"
            inModal={inModal}
          />
        );
      }
      break;
    }
  }

  if (field.key === "lostReason") {
    return (
      <LostReasonValue
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={onChange}
        inModal={inModal}
      />
    );
  }
  return (
    <Input
      dir="auto"
      className="h-8 w-40"
      value={typeof condition.value === "string" ? condition.value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
  inModal,
}: {
  condition: ExtendedFilterCondition;
  fields: InsightsField[];
  onChange: (next: ExtendedFilterCondition) => void;
  onRemove: () => void;
  inModal?: boolean;
}) {
  const { t } = useI18n();
  const field = fields.find((f) => f.key === condition.field);
  const ops = field ? operatorsFor(field) : TEXT_OPS;

  const setField = (key: string) => {
    const next = fields.find((f) => f.key === key);
    if (!next) return;
    const nextOps = operatorsFor(next);
    const operator = nextOps.includes(condition.operator as FilterOperator)
      ? condition.operator
      : nextOps[0];
    onChange({ field: key, operator, value: undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Combobox
        items={fields.map((f) => ({ value: f.key, label: f.label }))}
        value={condition.field}
        onChange={setField}
        placeholder={t("filter.searchFields")}
        triggerClassName="h-8 w-44 px-2"
        inModal={inModal}
      />
      <Select
        value={condition.operator}
        onValueChange={(op) =>
          onChange({
            ...condition,
            operator: op as FilterOperator,
            value: op === "between" ? [null, null] : undefined,
          })
        }
      >
        <SelectTrigger className="h-8 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {filterOperatorLabel(t, op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field && (
        <ValueEditor
          field={field}
          condition={condition}
          onChange={(value) => onChange({ ...condition, value })}
          inModal={inModal}
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-subtle hover:text-destructive"
        onClick={onRemove}
        aria-label={t("filter.removeCondition")}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function InsightsFilterEditor({
  group,
  fields,
  onChange,
  onRemove,
  depth = 1,
  inModal = false,
}: {
  group: ExtendedFilterGroup;
  /** Filterable fields from /insights/fields for the widget's scope. */
  fields: InsightsField[];
  onChange: (next: ExtendedFilterGroup) => void;
  onRemove?: () => void;
  depth?: number;
  /** Pass when hosted inside a Dialog — threads Combobox popovers through
   *  the dialog's scroll-lock allowlist so their lists stay scrollable. */
  inModal?: boolean;
}) {
  const { t } = useI18n();
  const filterable = fields.filter((f) => f.filterable);
  const nodes = group.conditions as ExtendedFilterNode[];

  const updateChild = (i: number, node: ExtendedFilterNode) =>
    onChange({
      ...group,
      conditions: nodes.map((c, idx) => (idx === i ? node : c)),
    });
  const removeChild = (i: number) =>
    onChange({ ...group, conditions: nodes.filter((_, idx) => idx !== i) });

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3",
        depth === 1 ? "border-border bg-card" : "border-border bg-surface-whisper",
      )}
    >
      <div className="flex items-center gap-2">
        <Select
          value={group.combinator}
          onValueChange={(v) => onChange({ ...group, combinator: v as "and" | "or" })}
        >
          <SelectTrigger className="h-7 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">AND</SelectItem>
            <SelectItem value="or">OR</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-subtle">
          match {group.combinator === "and" ? "all" : "any"} of
        </span>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="ms-auto h-7 w-7 text-subtle hover:text-destructive"
            onClick={onRemove}
            aria-label={t("filter.removeGroup")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2 ps-2">
        {nodes.length === 0 && (
          <p className="text-xs text-subtle">
            {t("insights.noConditions")}
          </p>
        )}
        {nodes.map((node, i) =>
          isFilterGroup(node as never) ? (
            <InsightsFilterEditor
              key={i}
              group={node as ExtendedFilterGroup}
              fields={fields}
              depth={depth + 1}
              inModal={inModal}
              onChange={(n) => updateChild(i, n)}
              onRemove={() => removeChild(i)}
            />
          ) : (
            <ConditionRow
              key={i}
              condition={node as ExtendedFilterCondition}
              fields={filterable}
              inModal={inModal}
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
              conditions: [...nodes, newCondition(filterable)],
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
                conditions: [...nodes, { combinator: "and", conditions: [] }],
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

/** Drop conditions whose operator needs a value but none was provided, so a
 *  half-built row never reaches the server compiler. */
export function pruneFilters(group: ExtendedFilterGroup): ExtendedFilterGroup {
  const conditions = (group.conditions as ExtendedFilterNode[])
    .map((node) => {
      if (isFilterGroup(node as never)) {
        const pruned = pruneFilters(node as ExtendedFilterGroup);
        return pruned.conditions.length > 0 ? pruned : null;
      }
      const cond = node as ExtendedFilterCondition;
      if (!operatorTakesValue(cond.operator as FilterOperator)) return cond;
      if (cond.value === undefined || cond.value === null || cond.value === "") {
        return null;
      }
      if (Array.isArray(cond.value) && cond.value.some((v) => v == null || v === "")) {
        return null;
      }
      return cond;
    })
    .filter((n): n is ExtendedFilterNode => n !== null);
  return { combinator: group.combinator, conditions };
}

/** Leaf-condition count — the shared deals-filter walker, typed for the
 *  extended (cf:-aware) tree. Same counter the server logs as "N board
 *  condition(s)", so the badge and the applied-filters tooltip agree. */
export function countGroupConditions(group: ExtendedFilterGroup): number {
  return countConditions(group as FilterGroup);
}
