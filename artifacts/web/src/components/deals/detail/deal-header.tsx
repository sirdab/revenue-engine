import { useState } from "react";
import { Link } from "wouter";
import {
  Archive,
  ArchiveRestore,
  GitMerge,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type StatusTone } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { EditableText, EditableMoney } from "@/components/deals/inline-edit";
import { LabelsEditor } from "@/components/shared/labels-editor";
import { LostReasonSelect } from "@/components/deals/lost-reason-select";
import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
import { MergeDealDialog } from "@/components/deals/merge-deal-dialog";
import type { Deal, DealUpdate } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

const STATUS_TONE: Record<string, StatusTone> = {
  won: "success",
  lost: "critical",
  deleted: "neutral",
};

export function DealHeader({
  deal,
  onCommit,
  isSaving,
}: {
  deal: Deal;
  onCommit: (patch: Partial<DealUpdate>) => void;
  isSaving: boolean;
}) {
  const { t, tNode } = useI18n();
  const [showLost, setShowLost] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostReasonNote, setLostReasonNote] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const archived = deal.archived === true;
  // A merged-away deal is archived AND points at its survivor. It used to be
  // indistinguishable from any other archived deal, so the only action on
  // offer was "Restore" — which reads as "undo the merge" and isn't: the
  // activities, notes and files stay on the survivor. Surface the survivor
  // instead, and label the restore for what it actually does.
  const mergedIntoDealId = deal.mergedIntoDealId ?? null;
  const merged = mergedIntoDealId != null;

  return (
    <div className="px-4 pt-2.5 pb-0">
      {/* Top row: nav + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/deals"
            className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("deals.header.backToDeals")}
          </Link>
        </div>

        {merged && archived ? (
          <div className="flex items-center gap-2">
            <Badge tone="attention">{t("deals.header.merged")}</Badge>
            <Button asChild size="sm">
              <Link href={`/deal/${mergedIntoDealId}`}>
                {t("deals.header.openDealNumber", { id: mergedIntoDealId })}
                <ArrowRight className="ms-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ) : archived ? (
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{t("common.archived")}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCommit({ archived: false })}
              disabled={isSaving}
            >
              <ArchiveRestore /> {t("common.restore")}
            </Button>
          </div>
        ) : deal.status === "open" ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => onCommit({ status: "won" })}
              disabled={isSaving}
            >
              <CheckCircle2 /> {t("common.won")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setShowLost(true)}
              disabled={isSaving}
            >
              <XCircle /> {t("common.lost")}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setShowMerge(true)}
              disabled={isSaving}
              title={t("deals.merge.title")}
              aria-label={t("deals.merge.title")}
            >
              <GitMerge />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setShowArchive(true)}
              disabled={isSaving}
              title={t("deals.header.archiveDeal")}
              aria-label={t("deals.header.archiveDeal")}
            >
              <Archive />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[deal.status] ?? "neutral"} className="uppercase">
              {deal.status}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onCommit({ status: "open", lostReason: null, lostReasonNote: null })
              }
              disabled={isSaving}
            >
              <RotateCcw /> {t("activity.bulk.reopen")}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setShowArchive(true)}
              disabled={isSaving}
              title={t("deals.header.archiveDeal")}
              aria-label={t("deals.header.archiveDeal")}
            >
              <Archive />
            </Button>
          </div>
        )}
      </div>

      {merged ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-attention-subtle px-3 py-2 text-caption text-attention">
          <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {tNode("deals.header.mergedNotice", {
              deal: (
                <Link
                  href={`/deal/${mergedIntoDealId}`}
                  className="font-semibold underline underline-offset-2 hover:text-attention"
                >
                  {t("deals.header.dealNumberLower", { id: mergedIntoDealId })}
                </Link>
              ),
            })}{" "}
            {archived && (
              <button
                type="button"
                onClick={() => onCommit({ archived: false })}
                disabled={isSaving}
                className="underline underline-offset-2 hover:text-attention disabled:opacity-50"
              >
                {t("deals.header.restoreSeparate")}
              </button>
            )}
          </span>
        </div>
      ) : archived ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-caption text-warning">
          <Archive className="h-3.5 w-3.5 shrink-0" />
          {t("deals.header.archivedNotice")}
        </div>
      ) : null}

      {/* Dense identity band: title · value · owner · org · rotting · labels */}
      <div className="mt-1.5 mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <EditableText
          value={deal.title}
          onCommit={(next) => onCommit({ title: next })}
          placeholder={t("deals.header.untitled")}
          className="-ms-1 min-w-0 max-w-full text-heading-sm text-foreground"
        />
        <EditableMoney
          value={deal.value}
          currency={deal.currency}
          onCommit={(next) => onCommit({ value: next })}
          className="-ms-1 shrink-0 text-label font-semibold tabular-nums text-foreground"
        />
        <span className="hidden h-3.5 w-px bg-border sm:block" />
        <span
          className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
          title={deal.ownerName ?? t("common.unassigned")}
        >
          <Avatar className="size-5 text-[9px]">
            <AvatarFallback>
              {initials(deal.ownerName)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[10rem] truncate">
            {deal.ownerName ?? t("common.unassigned")}
          </span>
        </span>
        {deal.organizationName && (
          <span
            className="inline-flex min-w-0 items-center gap-1 text-caption text-muted-foreground"
            title={deal.organizationName}
          >
            <Building2 className="h-3 w-3 shrink-0 text-subtle" />
            <span className="max-w-[12rem] truncate">
              {deal.organizationName}
            </span>
          </span>
        )}
        {deal.isRotting && deal.status === "open" && (
          <Badge tone="warning" className="shrink-0 gap-1">
            <Flame className="size-3" /> {t("deals.header.rotting")}
          </Badge>
        )}
        <LabelsEditor
          entity="deal"
          labels={deal.labels ?? []}
          onChange={(next) => onCommit({ labels: next })}
        />
      </div>

      <MergeDealDialog deal={deal} open={showMerge} onOpenChange={setShowMerge} />
      <ArchiveConfirmDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        recordLabel="deal"
        recordName={deal.title}
        confirming={isSaving}
        onConfirm={() => {
          onCommit({ archived: true });
          setShowArchive(false);
        }}
      />

      <Dialog open={showLost} onOpenChange={setShowLost}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deals.header.markLost")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-label text-foreground">
              {t("deals.field.lostReason")}
            </label>
            <LostReasonSelect
              value={lostReason}
              onChange={setLostReason}
              inModal
            />
            <p className="text-caption text-muted-foreground">
              {t("deals.lostReason.reasonHint")}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-label text-foreground">
              {t("deals.header.additionalDetail")}{" "}
              <span className="font-normal text-subtle">{t("common.optionalParen")}</span>
            </label>
            <Textarea
              value={lostReasonNote}
              onChange={(e) => setLostReasonNote(e.target.value)}
              placeholder={t("deals.header.lostDetailPlaceholder")}
              rows={3}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLost(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onCommit({
                  status: "lost",
                  lostReason: lostReason || null,
                  lostReasonNote: lostReasonNote.trim() || null,
                });
                setShowLost(false);
                setLostReason("");
                setLostReasonNote("");
              }}
            >
              {t("deals.header.confirmLost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
