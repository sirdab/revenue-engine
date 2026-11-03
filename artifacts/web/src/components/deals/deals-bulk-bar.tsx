import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBulkUpdateDeals,
  useUpdateDeal,
  useListUserOptions,
  useListPipelines,
} from "@workspace/api-client-react";
import { canReassignDeals } from "@/lib/deal-reassign";
import { errorMessage } from "@/lib/api-error";
import { invalidateDealCollections } from "@/lib/deal-collections";
import type { Stage, DealBulkInput } from "@workspace/api-client-react";
import { RequiredFieldsDialog } from "@/components/deals/detail/required-fields-dialog";
import { requiredFieldsBlock } from "@/lib/deal-fields-api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { useAuth } from "@/hooks/use-auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { X, Trash2, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n";

export function DealsBulkBar({
  selectedIds,
  selectedPipelineIds,
  pipelineId,
  stages,
  onClear,
}: {
  selectedIds: number[];
  /** Pipeline of each selected deal, for the reassign lock. */
  selectedPipelineIds: number[];
  pipelineId?: number;
  stages: Stage[];
  onClear: () => void;
}) {
  const { t, tPlural } = useI18n();
  // A selected deal in a pipeline locked to admins (adminOnlyReassign) makes
  // the server refuse the whole set_owner for anyone else, so it is hidden.
  const { data: pipelines } = useListPipelines();
  const canReassign = canReassignDeals(
    useAuth().user?.isAdmin === true,
    selectedPipelineIds,
    pipelines ?? [],
  );
  const queryClient = useQueryClient();
  const { data: users } = useListUserOptions();
  const bulk = useBulkUpdateDeals();
  const updateDeal = useUpdateDeal();
  const { toast } = useToast();
  const [stageValue, setStageValue] = useState("");
  const [ownerValue, setOwnerValue] = useState("");
  // Deals a bulk stage move skipped because the target stage's required
  // fields are empty on them. The modal walks them one at a time: fill the
  // fields, retry the move, advance. Closing the dialog skips that deal.
  const [blockedQueue, setBlockedQueue] = useState<
    Array<{
      dealId: number;
      title: string;
      keys: string[];
      stageId: number;
      stageName: string | null;
    }>
  >([]);
  const [retrying, setRetrying] = useState(false);

  const stageOptions =
    pipelineId != null
      ? stages
          .filter((s) => s.pipelineId === pipelineId)
          .sort((a, b) => a.orderIndex - b.orderIndex)
      : [];

  const invalidateDeals = (ids: number[] = []) => {
    invalidateDealCollections(queryClient, ids);
  };

  const run = async (
    payload: Omit<DealBulkInput, "ids">,
    successVerb: string,
  ) => {
    try {
      const res = await bulk.mutateAsync({
        data: { ids: selectedIds, ...payload },
      });
      invalidateDeals(selectedIds);
      const blocked = res.blocked ?? [];
      toast({
        title: t("deals.bulk.doneCount", {
          verb: successVerb,
          count: res.updatedCount,
        }),
        ...(blocked.length
          ? {
              description: tPlural("deals.bulk.blocked", blocked.length),
            }
          : {}),
      });
      setStageValue("");
      setOwnerValue("");
      if (payload.action === "set_stage" && blocked.length) {
        const stageName =
          stageOptions.find((s) => s.id === payload.stageId)?.name ?? null;
        setBlockedQueue(
          blocked.map((b) => ({
            dealId: b.id,
            title: b.title,
            keys: b.missingRequiredFields.map((m) => m.key),
            stageId: payload.stageId as number,
            stageName,
          })),
        );
        // Don't clear the selection yet — the parent unmounts this bar (and
        // the modal queue with it) when nothing is selected. Cleared once the
        // queue is worked through.
      } else {
        onClear();
      }
    } catch (e) {
      // The server's reason (e.g. a reassign refused in a locked pipeline).
      toast({
        title: t("activity.bulk.failed"),
        description: errorMessage(e),
        variant: "destructive",
      });
    }
  };

  // The head of the queue drives the modal; advancing past the last deal
  // finally releases the selection (which keeps this bar mounted).
  const current = blockedQueue[0];
  const advanceQueue = () => {
    const next = blockedQueue.slice(1);
    setBlockedQueue(next);
    if (next.length === 0) onClear();
  };

  // Retry the current blocked deal's move once its fields are filled; a
  // repeat 409 (a field was cleared meanwhile) refreshes the modal's list.
  const confirmBlockedMove = async () => {
    if (!current) return;
    setRetrying(true);
    try {
      await updateDeal.mutateAsync({
        id: current.dealId,
        data: { stageId: current.stageId },
      });
      toast({ title: t("deals.bulk.movedTitle", { title: current.title }) });
      invalidateDeals([current.dealId]);
      advanceQueue();
    } catch (e) {
      const block = requiredFieldsBlock(e);
      if (block) {
        setBlockedQueue((q) =>
          q.length ? [{ ...q[0], keys: block.keys }, ...q.slice(1)] : q,
        );
      } else {
        toast({ title: t("board.moveFailed"), variant: "destructive" });
        advanceQueue();
      }
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="fixed bottom-6 start-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-slate-200 bg-card px-4 py-2.5 shadow-lg">
      <span className="text-sm font-medium text-slate-700">
        {selectedIds.length} selected
      </span>
      <div className="h-5 w-px bg-slate-200" />

      {stageOptions.length > 0 && (
        <Select
          value={stageValue}
          onValueChange={(v) => {
            setStageValue(v);
            run(
              { action: "set_stage", stageId: Number(v) },
              t("deals.bulk.moved"),
            );
          }}
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder={t("deals.bulk.setStage")} />
          </SelectTrigger>
          <SelectContent>
            {stageOptions.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {canReassign && (
        <Combobox
          items={(users ?? []).map((u) => ({
            value: u.id.toString(),
            label: u.name,
          }))}
          value={ownerValue}
          onChange={(v) => {
            setOwnerValue(v);
            run(
              { action: "set_owner", ownerId: Number(v) },
              t("deals.bulk.reassigned"),
            );
          }}
          placeholder={t("deals.bulk.setOwner")}
          triggerClassName="h-9 w-[150px]"
        />
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="me-1.5 h-4 w-4" />
            {t("common.delete")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deals.bulk.deleteTitle", { count: selectedIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deals.bulk.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => run({ action: "delete" }, t("deals.bulk.deleted"))}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {bulk.isPending && (
        <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-500"
        onClick={onClear}
        aria-label={t("activity.bulk.clearSelection")}
      >
        <X className="h-4 w-4" />
      </Button>

      {current && (
        <RequiredFieldsDialog
          key={current.dealId}
          dealId={current.dealId}
          requiredKeys={current.keys}
          stageName={current.stageName}
          dealTitle={current.title}
          open
          onOpenChange={(open) => {
            // Closing skips this deal (it simply stays in its stage) and
            // moves on to the next blocked one.
            if (!open) advanceQueue();
          }}
          onConfirm={confirmBlockedMove}
          confirming={retrying}
        />
      )}
    </div>
  );
}
