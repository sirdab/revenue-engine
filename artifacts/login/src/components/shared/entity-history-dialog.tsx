import { useState, type ReactNode } from "react";
import { History, Sparkles, PencilLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import {
  useGetActivityHistory,
  useGetNoteHistory,
  getGetActivityHistoryQueryKey,
  getGetNoteHistoryQueryKey,
} from "@workspace/api-client-react";
import {
  snapshotLabel,
  prettifyKey,
  ChangeEventRow,
  type ChangeDescription,
} from "@/components/shared/entity-timeline";
import type { ChangeEvent } from "@workspace/api-client-react";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

// Field-key vocabulary shared by activity and note change_events, matching
// TRACKED_ACTIVITY_FIELDS / TRACKED_NOTE_FIELDS in
// artifacts/api-server/src/lib/change-events.ts. Neither entity has its own
// detail page — this dialog is the only place their history is surfaced.
function describeChange(t: Translate, e: ChangeEvent): ChangeDescription {
  const oldL = snapshotLabel(e.oldValue);
  const newL = snapshotLabel(e.newValue);
  if (e.fieldKey === "created") {
    return {
      title: t(e.entityType === "note" ? "history.noteCreated" : "history.activityCreated"),
      icon: <Sparkles className="h-3.5 w-3.5" />,
      accent: "bg-teal-50 text-teal-600",
    };
  }
  return {
    title: (
      <span>
        {prettifyKey(e.fieldKey)}{" "}
        {e.oldValue && (
          <>
            <span className="font-semibold">{oldL}</span>{" "}
          </>
        )}
        → <span className="font-semibold">{newL}</span>
      </span>
    ),
    icon: <PencilLine className="h-3.5 w-3.5" />,
    accent: "bg-slate-100 text-slate-500",
  };
}

export function EntityHistoryDialog({
  entityType,
  entityId,
  trigger,
}: {
  entityType: "activity" | "note";
  entityId: number;
  trigger: ReactNode;
}) {
  const { t } = useI18n();
  const describe = (e: ChangeEvent) => describeChange(t, e);
  const [open, setOpen] = useState(false);

  // All hooks are always called (rules of hooks); only the one matching
  // entityType is enabled, and only once the dialog is actually opened.
  const activityHistory = useGetActivityHistory(entityId, {
    query: {
      enabled: open && entityType === "activity",
      queryKey: getGetActivityHistoryQueryKey(entityId),
    },
  });
  const noteHistory = useGetNoteHistory(entityId, {
    query: {
      enabled: open && entityType === "note",
      queryKey: getGetNoteHistoryQueryKey(entityId),
    },
  });
  const { data, isLoading } =
    entityType === "activity" ? activityHistory : noteHistory;
  const events = data?.events ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("common.history")}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-2.5">
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                <Skeleton className="h-6 flex-1 rounded-lg" />
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <Empty className="border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History className="h-4 w-4" />
              </EmptyMedia>
              <EmptyTitle>{t("history.empty")}</EmptyTitle>
              <EmptyDescription>
                {t(entityType === "note" ? "history.emptyNote" : "history.emptyActivity")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="max-h-[60vh] space-y-2.5 overflow-y-auto">
            {events.map((e) => (
              <ChangeEventRow key={e.id} event={e} describe={describe} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
