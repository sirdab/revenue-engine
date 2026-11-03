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

const STATUS_PILL: Record<string, string> = {
  won: "bg-teal-100 text-teal-700 border border-teal-200",
  lost: "bg-red-50 text-red-700 border border-red-200",
  deleted: "bg-slate-100 text-slate-500 border border-slate-200",
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
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("deals.header.backToDeals")}
          </Link>
        </div>

        {merged && archived ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              {t("deals.header.merged")}
            </span>
            <Button
              asChild
              size="sm"
              className="h-7 bg-teal-600 px-3 text-xs text-white hover:bg-teal-700"
            >
              <Link href={`/deal/${mergedIntoDealId}`}>
                {t("deals.header.openDealNumber", { id: mergedIntoDealId })}
                <ArrowRight className="ms-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ) : archived ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">
              {t("common.archived")}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCommit({ archived: false })}
              disabled={isSaving}
              className="h-7 px-3 text-xs"
            >
              <ArchiveRestore className="me-1 h-3.5 w-3.5" /> {t("common.restore")}
            </Button>
          </div>
        ) : deal.status === "open" ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => onCommit({ status: "won" })}
              disabled={isSaving}
              className="h-7 bg-teal-600 px-3 text-xs text-white hover:bg-teal-700"
            >
              <CheckCircle2 className="me-1 h-3.5 w-3.5" /> {t("common.won")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLost(true)}
              disabled={isSaving}
              className="h-7 border-red-200 px-3 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <XCircle className="me-1 h-3.5 w-3.5" /> {t("common.lost")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowMerge(true)}
              disabled={isSaving}
              title={t("deals.merge.title")}
              className="h-7 px-2 text-xs text-slate-400 hover:text-slate-700"
            >
              <GitMerge className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowArchive(true)}
              disabled={isSaving}
              title={t("deals.header.archiveDeal")}
              className="h-7 px-2 text-xs text-slate-400 hover:text-slate-700"
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                STATUS_PILL[deal.status] ?? STATUS_PILL.deleted,
              )}
            >
              {deal.status}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onCommit({ status: "open", lostReason: null, lostReasonNote: null })
              }
              disabled={isSaving}
              className="h-7 px-2 text-xs text-slate-500"
            >
              <RotateCcw className="me-1 h-3 w-3" /> {t("activity.bulk.reopen")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowArchive(true)}
              disabled={isSaving}
              title={t("deals.header.archiveDeal")}
              className="h-7 px-2 text-xs text-slate-400 hover:text-slate-700"
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {merged ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-900">
          <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {tNode("deals.header.mergedNotice", {
              deal: (
                <Link
                  href={`/deal/${mergedIntoDealId}`}
                  className="font-semibold underline underline-offset-2 hover:text-indigo-700"
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
                className="underline underline-offset-2 hover:text-indigo-700 disabled:opacity-50"
              >
                {t("deals.header.restoreSeparate")}
              </button>
            )}
          </span>
        </div>
      ) : archived ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
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
          className="-ms-1 min-w-0 max-w-full font-heading text-lg font-bold text-slate-900"
        />
        <EditableMoney
          value={deal.value}
          currency={deal.currency}
          onCommit={(next) => onCommit({ value: next })}
          className="-ms-1 shrink-0 text-sm font-semibold text-teal-700"
        />
        <span className="hidden h-3.5 w-px bg-slate-200 sm:block" />
        <span
          className="inline-flex items-center gap-1.5 text-xs text-slate-500"
          title={deal.ownerName ?? t("common.unassigned")}
        >
          <Avatar className="h-4 w-4">
            <AvatarFallback className="bg-teal-100 text-[9px] font-semibold text-teal-700">
              {initials(deal.ownerName)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[10rem] truncate">
            {deal.ownerName ?? t("common.unassigned")}
          </span>
        </span>
        {deal.organizationName && (
          <span
            className="inline-flex min-w-0 items-center gap-1 text-xs text-slate-500"
            title={deal.organizationName}
          >
            <Building2 className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="max-w-[12rem] truncate">
              {deal.organizationName}
            </span>
          </span>
        )}
        {deal.isRotting && deal.status === "open" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-600">
            <Flame className="h-3 w-3" /> {t("deals.header.rotting")}
          </span>
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
            <label className="text-sm font-medium text-slate-700">
              {t("deals.field.lostReason")}
            </label>
            <LostReasonSelect
              value={lostReason}
              onChange={setLostReason}
              inModal
            />
            <p className="text-xs text-slate-400">
              {t("reasons.hint")}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              {t("deals.header.additionalDetail")}{" "}
              <span className="font-normal text-slate-400">{t("common.optionalParen")}</span>
            </label>
            <textarea
              value={lostReasonNote}
              onChange={(e) => setLostReasonNote(e.target.value)}
              placeholder={t("deals.header.lostDetailPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-md border border-slate-200 bg-card px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLost(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
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
