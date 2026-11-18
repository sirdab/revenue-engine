import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useMergeDeal } from "@workspace/api-client-react";
import type { Deal, DealMergeResult } from "@workspace/api-client-react";
import { GitMerge, Loader2 } from "lucide-react";
import { AsyncSelect } from "@/components/ui/async-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadDealOptions } from "@/lib/contacts-search-api";
import { useToast } from "@/hooks/use-toast";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// Merge THIS (duplicate) deal into another deal. Two steps in one
// dialog: pick the primary -> a live preview shows exactly what will move and
// which empty fields fill in -> confirm. The merge is irreversible by design,
// so nothing happens until the preview has been seen.

const FIELD_LABELS: Record<string, MessageKey> = {
  personId: "deals.merge.field.personId",
  organizationId: "common.organization",
  expectedCloseDate: "deals.merge.field.expectedCloseDate",
  lostReason: "deals.field.lostReason",
  comments: "common.comments",
  visibleTo: "deals.merge.field.visibleTo",
  utmSource: "deals.field.utmSource",
  utmMedium: "deals.field.utmMedium",
  utmCampaign: "deals.field.utmCampaign",
  utmKeyword: "deals.field.utmKeyword",
  adName: "deals.field.adName",
  gclid: "deals.merge.field.gclid",
  fbclid: "deals.merge.field.fbclid",
  value: "deals.merge.field.value",
  labels: "deals.field.labels",
};

export function MergeDealDialog({
  deal,
  open,
  onOpenChange,
}: {
  deal: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, tNode, tPlural } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const merge = useMergeDeal();

  const [targetId, setTargetId] = useState("");
  const [targetLabel, setTargetLabel] = useState<string | null>(null);
  const [preview, setPreview] = useState<DealMergeResult | null>(null);

  const reset = () => {
    setTargetId("");
    setTargetLabel(null);
    setPreview(null);
  };

  const loadPreview = async (id: string) => {
    setPreview(null);
    if (!id) return;
    try {
      const p = await merge.mutateAsync({
        id: deal.id,
        data: { intoDealId: Number(id), preview: true },
      });
      setPreview(p);
    } catch (e) {
      toast({
        title: t("deals.merge.cannot"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
      setTargetId("");
      setTargetLabel(null);
    }
  };

  const confirm = async () => {
    if (!targetId || !preview) return;
    try {
      const result = await merge.mutateAsync({
        id: deal.id,
        data: { intoDealId: Number(targetId) },
      });
      // Everything about both deals changed — drop all cached deal queries.
      await queryClient.invalidateQueries();
      toast({
        title: t("deals.merge.done"),
        description: t("deals.merge.doneBody", { count: result.moved.activities + result.moved.notes + result.moved.files }),
      });
      onOpenChange(false);
      reset();
      navigate(`/deal/${result.primaryId}`);
    } catch (e) {
      toast({
        title: t("deals.merge.failed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-brand" />
            {t("deals.merge.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-body text-muted-foreground">
            {tNode("deals.merge.body", {
              title: <span className="font-medium text-foreground">{deal.title}</span>,
            })}
          </p>
          <div className="space-y-1.5">
            <div className="text-caption font-medium text-muted-foreground">
              {t("deals.merge.targetLabel")}
            </div>
            <AsyncSelect
              value={targetId || null}
              valueLabel={targetLabel}
              loadOptions={async (q) =>
                (await loadDealOptions(q)).filter(
                  (o) => o.value !== String(deal.id),
                )
              }
              onChange={(v, label) => {
                setTargetId(v ?? "");
                setTargetLabel(label);
                void loadPreview(v ?? "");
              }}
              allValue=""
              allLabel={t("deals.merge.chooseDeal")}
              placeholder={t("common.searchDeals")}
              inModal
              triggerClassName="w-full"
            />
          </div>

          {merge.isPending && !preview && targetId && (
            <div className="flex items-center gap-2 text-body text-subtle">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("deals.merge.checking")}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-border bg-surface-whisper/60 p-3 text-body">
              <div className="mb-1.5 text-caption font-medium text-muted-foreground">
                {t("deals.merge.whatHappens")}
              </div>
              <ul className="space-y-1 text-muted-foreground">
                <li>
                  {tNode("deals.merge.moves", {
                    activities: <span className="font-medium text-foreground">{tPlural("deals.merge.activities", preview.moved.activities)}</span>,
                    notes: <span className="font-medium text-foreground">{tPlural("deals.merge.notes", preview.moved.notes)}</span>,
                    files: <span className="font-medium text-foreground">{tPlural("deals.merge.files", preview.moved.files)}</span>,
                    events: <span className="font-medium text-foreground">{tPlural("deals.merge.events", preview.moved.historyEvents)}</span>,
                  })}
                </li>
                <li>
                  {preview.filledFields.length > 0 ? (
                    <>
                      {tNode("deals.merge.fills", {
                        fields: (
                          <span className="font-medium text-foreground">
                            {preview.filledFields
                              .map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f))
                              .join(", ")}
                          </span>
                        ),
                      })}
                    </>
                  ) : (
                    t("deals.merge.noFill")
                  )}
                </li>
                <li>{t("deals.merge.archivedWithLink", { title: deal.title })}</li>
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={!preview || merge.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {merge.isPending && (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            )}
            {t("deals.merge.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
