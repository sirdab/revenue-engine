import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDealHistoryQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DealField } from "./deal-section-card";
import { FieldControl } from "./deal-custom-fields-card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useDealFields,
  setDealFieldValue,
  dealFieldsQueryKey,
  type ResolvedDealField,
} from "@/lib/deal-fields-api";
import { useI18n } from "@/lib/i18n/i18n";

// Shown when a deal tries to enter a stage whose required fields are still
// empty. The server blocks the move (409) until they're filled — so with
// `onConfirm` this modal gates it: fill everything, then the button retries.
// Without `onConfirm` it's a plain prompt (legacy behaviour). Marking a deal
// as won goes through the same gate with the pipeline's won-required fields.

const isEmpty = (v: unknown): boolean =>
  v == null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" &&
    v !== null &&
    "value" in v &&
    (v as { value: unknown }).value == null);

// Mirrors the server's rule: the `value` column is NOT NULL DEFAULT 0, so a
// zero deal value counts as "not filled in" when it's required (column
// storage only — an unrelated field that owns the key keeps 0 = filled).
const isUnfilled = (f: ResolvedDealField): boolean =>
  isEmpty(f.value) ||
  (f.key === "value" && f.storage === "column" && f.value === 0);

export function RequiredFieldsDialog({
  dealId,
  requiredKeys,
  stageName,
  dealTitle,
  open,
  onOpenChange,
  onConfirm,
  confirming = false,
}: {
  dealId: number;
  requiredKeys: string[];
  stageName?: string | null;
  /** Shown in the description — essential when the dialog is part of a
   *  multi-deal (bulk) flow so the user knows which deal they're filling. */
  dealTitle?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog gates a blocked stage move: the button retries the
   *  move and stays disabled until every required field has a value. */
  onConfirm?: () => void | Promise<void>;
  confirming?: boolean;
}) {
  const { t, tPlural } = useI18n();
  const { data: fields } = useDealFields(open ? dealId : null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const keySet = useMemo(() => new Set(requiredKeys), [requiredKeys]);
  const shown = useMemo(
    () => (fields ?? []).filter((f) => keySet.has(f.key)),
    [fields, keySet],
  );
  const remaining = shown.filter(isUnfilled).length;
  const blocking = onConfirm != null;

  const commit = async (field: ResolvedDealField, value: unknown) => {
    try {
      const next = await setDealFieldValue(dealId, field.key, value);
      qc.setQueryData(dealFieldsQueryKey(dealId), next);
      qc.invalidateQueries({ queryKey: getGetDealHistoryQueryKey(dealId) });
    } catch (e) {
      toast({
        title: t("deals.customFields.saveFailed"),
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const filled = shown.length - remaining;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Long field lists (a won gate can require dozens) must never outgrow
          the viewport: header (with progress) and footer stay pinned, the
          field grid scrolls. Two columns on desktop keeps 25+ fields
          manageable; wide controls (multi-select chips, textareas) span both. */}
      <DialogContent className="flex max-h-[min(88vh,52rem)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-slate-100 px-6 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            {stageName ? t("deals.requiredFields.titleStage", { stage: stageName }) : t("deals.requiredFields.title")}
          </DialogTitle>
          <DialogDescription>
            {blocking
              ? stageName
                  ? t("deals.requiredFields.blockingMoveTo", { deal: dealTitle ? `“${dealTitle}”` : t("deals.requiredFields.theDeal"), stage: stageName })
                  : t("deals.requiredFields.blockingMove", { deal: dealTitle ? `“${dealTitle}”` : t("deals.requiredFields.theDeal") })
              : t("deals.requiredFields.movedNote")}
          </DialogDescription>
          {shown.length > 0 && (
            <div className="flex items-center gap-2.5 pt-1">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-teal-500 transition-[width] duration-300"
                  style={{ width: `${(filled / shown.length) * 100}%` }}
                />
              </div>
              <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">
                {filled}/{shown.length} filled
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {fields == null ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              <Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("deals.requiredFields.loading")}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {shown.map((f) => (
                <DealField
                  key={f.key}
                  label={isUnfilled(f) ? `${f.label} *` : f.label}
                  className={cn(
                    "rounded-md border-s-2 py-1 ps-3",
                    isUnfilled(f) ? "border-amber-300" : "border-teal-200",
                    // Chip groups and long text need the full row; compact
                    // inputs sit two-up.
                    (f.fieldType === "set" || f.fieldType === "text") &&
                      "sm:col-span-2",
                  )}
                >
                  <FieldControl field={f} onCommit={(v) => commit(f, v)} />
                </DealField>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="items-center border-t border-slate-100 px-6 py-3">
          {blocking ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={confirming}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void onConfirm()}
                disabled={remaining > 0 || confirming}
                className="gap-2"
                title={
                  remaining > 0
                    ? tPlural("deals.requiredFields.stillEmpty", remaining)
                    : undefined
                }
              >
                {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
                {remaining > 0
                  ? t("deals.requiredFields.fillMoreMove", { count: remaining })
                  : t("deals.requiredFields.moveDeal")}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>
              {remaining > 0 ? t("deals.requiredFields.skipForNow") : t("common.done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
