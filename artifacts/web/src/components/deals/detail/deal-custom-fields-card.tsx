import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDealHistoryQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { DealSectionCard, DealField } from "./deal-section-card";
import { getDefaultCurrency } from "@/lib/format";
import {
  EditableText,
  EditableTextarea,
  EditableNumber,
  EditableMoney,
  EditableSelect,
  EditableDate,
} from "@/components/deals/inline-edit";
import { Switch } from "@/components/ui/switch";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useDealFields,
  setDealFieldValue,
  dealFieldsQueryKey,
  fieldInPipeline,
  type ResolvedDealField,
  type DealFieldOption,
} from "@/lib/deal-fields-api";
import { useI18n, tStatic } from "@/lib/i18n/i18n";

// Renders every ACTIVE deal field (decoded Pipedrive data + user-created),
// grouped + ordered by the registry, each editable by its type. Fetches its own
// data (the generated GetDeal response doesn't carry custom_fields), so it just
// needs the deal id.

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const asNum = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);

function displayValue(f: ResolvedDealField): string {
  const v = f.value;
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "—";
  if (f.fieldType === "monetary") {
    const m = v as { value?: unknown; currency?: unknown };
    return `${m.value ?? "—"}${m.currency ? ` ${m.currency}` : ""}`;
  }
  if (f.fieldType === "daterange") {
    const r = v as { from?: unknown; to?: unknown };
    return `${r.from ?? "…"} → ${r.to ?? "…"}`;
  }
  if (f.fieldType === "boolean") return tStatic(v ? "common.yes" : "common.no");
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

// Past this many options the flat chip row stops being scannable and becomes a
// wall of buttons; the searchable picker takes over.
const CHIP_ROW_MAX_OPTIONS = 12;

function SetEditor({
  values,
  options,
  onCommit,
}: {
  values: string[];
  options: DealFieldOption[];
  onCommit: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const set = new Set(values);
  if (options.length === 0)
    return <span className="text-sm text-slate-400">{values.join(", ") || "—"}</span>;
  if (options.length > CHIP_ROW_MAX_OPTIONS)
    return (
      <MultiCombobox
        options={options.map((o) => o.value)}
        values={values}
        onChange={onCommit}
        placeholder={t("common.search")}
      />
    );
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = set.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() =>
              onCommit(
                on ? values.filter((x) => x !== o.value) : [...values, o.value],
              )
            }
            className={cn(
              "rounded border px-2 py-0.5 text-xs transition-colors",
              on
                ? "border-teal-300 bg-teal-50 text-teal-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldControl({
  field,
  onCommit,
}: {
  field: ResolvedDealField;
  onCommit: (value: unknown) => void;
}) {
  if (!field.editable) {
    return <span className="text-sm text-slate-400">{displayValue(field)}</span>;
  }
  const v = field.value;
  switch (field.fieldType) {
    case "text":
      return <EditableTextarea value={asStr(v)} onCommit={(s) => onCommit(s)} />;
    case "double":
      return <EditableNumber value={asNum(v)} onCommit={(n) => onCommit(n)} />;
    case "monetary": {
      const m = (v ?? {}) as { value?: number; currency?: string };
      return (
        <EditableMoney
          value={Number(m.value ?? 0)}
          currency={m.currency ?? getDefaultCurrency()}
          onCommit={(n) => onCommit({ value: n, currency: m.currency ?? getDefaultCurrency() })}
          onClear={v == null ? undefined : () => onCommit(null)}
        />
      );
    }
    case "boolean":
      return (
        <Switch
          checked={Boolean(v)}
          onCheckedChange={(c) => onCommit(c)}
        />
      );
    case "date":
      return <EditableDate value={asStr(v)} onCommit={(s) => onCommit(s)} />;
    case "daterange": {
      const r = (v ?? {}) as { from?: string; to?: string };
      return (
        <div className="flex items-center gap-1.5">
          <EditableDate
            value={asStr(r.from)}
            onCommit={(s) => onCommit({ from: s, to: r.to ?? null })}
          />
          <span className="text-slate-300">→</span>
          <EditableDate
            value={asStr(r.to)}
            onCommit={(s) => onCommit({ from: r.from ?? null, to: s })}
          />
        </div>
      );
    }
    case "enum":
      return (
        <EditableSelect
          value={v == null ? null : String(v)}
          options={field.options ?? []}
          onCommit={(s) => onCommit(s)}
        />
      );
    case "set":
      return (
        <SetEditor
          values={Array.isArray(v) ? v.map(String) : []}
          options={field.options ?? []}
          onCommit={(arr) => onCommit(arr)}
        />
      );
    default:
      return (
        <EditableText
          value={asStr(v)}
          onCommit={(s) => onCommit(s || null)}
          allowClear
        />
      );
  }
}

interface FieldGroup {
  group: string | null;
  fields: ResolvedDealField[];
}

function groupFields(fields: ResolvedDealField[]): FieldGroup[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, ResolvedDealField[]>();
  for (const f of fields) {
    const g = f.group || null;
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(f);
  }
  return order.map((g) => ({ group: g, fields: map.get(g)! }));
}

// Empty by this card's standards: nothing worth pinning space for.
function isFilled(f: ResolvedDealField): boolean {
  const v = f.value;
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return false;
  if (f.fieldType === "monetary") {
    const m = v as { value?: unknown };
    return m.value != null && m.value !== "";
  }
  if (f.fieldType === "daterange") {
    const r = v as { from?: unknown; to?: unknown };
    return r.from != null || r.to != null;
  }
  return true;
}

// Core deal columns registered in the field registry only so the stage/won
// required-fields pickers can offer them — their editors live on the deal
// header (value) and details card (expected close date), so this card skips
// them to avoid duplicates.
const CORE_COLUMN_FIELD_KEYS = new Set(["value", "expected_close_date"]);

export function DealCustomFieldsCard({
  dealId,
  pipelineId,
}: {
  dealId: number;
  pipelineId: number | null | undefined;
}) {
  const { t, tNode } = useI18n();
  const { data: allFields, isLoading } = useDealFields(dealId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showEmpty, setShowEmpty] = useState(false);

  // Active fields are the editable registry; inactive ones only matter when
  // they hold imported data (shown read-only at the bottom).
  const { fields, inactiveFilled, emptyCount } = useMemo(() => {
    const all = (allFields ?? []).filter(
      (f) => !(f.storage === "column" && CORE_COLUMN_FIELD_KEYS.has(f.key)),
    );
    // A field limited to other pipelines is left off this deal unless it
    // already holds a value (e.g. the deal moved pipelines), so no data hides.
    const active = all.filter(
      (f) => f.active && (fieldInPipeline(f.pipelineIds, pipelineId) || isFilled(f)),
    );
    return {
      fields: active,
      inactiveFilled: all.filter((f) => !f.active && isFilled(f)),
      emptyCount: active.filter((f) => !isFilled(f)).length,
    };
  }, [allFields, pipelineId]);

  // Filled fields always render; empty ones sit behind the header toggle so
  // the card surfaces data first while every field stays reachable for entry.
  const visible = useMemo(
    () => (showEmpty ? fields : fields.filter(isFilled)),
    [fields, showEmpty],
  );
  const groups = useMemo(() => groupFields(visible), [visible]);
  const inactiveGroups = useMemo(
    () => groupFields(inactiveFilled),
    [inactiveFilled],
  );

  const commit = async (field: ResolvedDealField, value: unknown) => {
    try {
      const next = await setDealFieldValue(dealId, field.key, value);
      qc.setQueryData(dealFieldsQueryKey(dealId), next);
      // Surface the cf: edit in the deal history timeline.
      qc.invalidateQueries({ queryKey: getGetDealHistoryQueryKey(dealId) });
    } catch (e) {
      toast({
        title: t("deals.customFields.saveFailed"),
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <DealSectionCard title={t("deals.group.customFields")} collapsible defaultOpen>
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </DealSectionCard>
    );
  }
  if (fields.length === 0 && inactiveFilled.length === 0) return null;

  return (
    <DealSectionCard
      title={t("deals.group.customFields")}
      collapsible
      defaultOpen
      action={
        emptyCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowEmpty((v) => !v)}
            className="text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            {showEmpty ? t("deals.customFields.hideEmpty") : t("deals.customFields.showEmpty", { count: emptyCount })}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {visible.length === 0 && emptyCount > 0 && (
          <p className="text-sm text-slate-400">
            {t("deals.customFields.noneFilled")}{" "}
            <button
              type="button"
              onClick={() => setShowEmpty(true)}
              className="font-medium text-teal-600 hover:text-teal-700"
            >
              {t("deals.customFields.showAllFields", { count: emptyCount })}
            </button>{" "}
            {t("deals.customFields.toStartAdding")}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.group ?? "__ungrouped__"}>
            {g.group && (
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {g.group}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {g.fields.map((f) => (
                <DealField key={f.key} label={f.label}>
                  <FieldControl field={f} onCommit={(v) => commit(f, v)} />
                </DealField>
              ))}
            </div>
          </div>
        ))}

        {/* Imported values whose field an admin hasn't activated: still shown
            (nothing with data is hidden), but read-only until activated. */}
        {inactiveFilled.length > 0 && (
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {t("deals.customFields.moreImported")}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {inactiveGroups.flatMap((g) => g.fields).map((f) => (
                <DealField key={f.key} label={f.label}>
                  <span className="text-sm text-slate-500">
                    {displayValue(f)}
                  </span>
                </DealField>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {tNode("deals.customFields.readOnlyNote", {
                link: (
                  <Link
                    href="/admin/settings/custom-fields"
                    className="text-teal-600 hover:text-teal-700"
                  >
                    {t("deals.customFields.settingsLink")}
                  </Link>
                ),
              })}
            </p>
          </div>
        )}
      </div>
    </DealSectionCard>
  );
}
