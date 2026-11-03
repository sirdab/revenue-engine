import { useMemo } from "react";
import { differenceInSeconds } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDuration } from "./deal-utils";
import { DealPipelineSelector } from "./deal-pipeline-selector";
import type {
  Deal,
  DealUpdate,
  Pipeline,
  Stage,
  DealStageDuration,
} from "@workspace/api-client-react";

export function DealPipelineProgress({
  deal,
  pipelines,
  stages,
  stageDurations,
  loading,
  onStageChange,
  onCommit,
}: {
  deal: Deal;
  pipelines: Pipeline[];
  stages: Stage[];
  stageDurations: DealStageDuration[];
  loading?: boolean;
  onStageChange: (stageId: number) => void;
  onCommit: (patch: Partial<DealUpdate>) => void;
}) {
  const ordered = useMemo(
    () =>
      stages
        .filter((s) => s.pipelineId === deal.pipelineId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [stages, deal.pipelineId],
  );

  const durationByStage = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of stageDurations) {
      if (d.stageId == null) continue;
      m.set(d.stageId, (m.get(d.stageId) ?? 0) + d.durationSeconds);
    }
    return m;
  }, [stageDurations]);

  const currentIndex = ordered.findIndex((s) => s.id === deal.stageId);
  const isClosed = deal.status !== "open";

  const currentStageSeconds = useMemo(() => {
    const fromHistory = durationByStage.get(deal.stageId);
    if (fromHistory != null) return fromHistory;
    const since = deal.stageChangeTime ?? deal.addTime;
    return since
      ? Math.max(0, differenceInSeconds(new Date(), new Date(since)))
      : null;
  }, [durationByStage, deal.stageId, deal.stageChangeTime, deal.addTime]);

  if (loading) {
    return (
      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 flex-1 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (ordered.length === 0) return null;

  return (
    <div className="border-t border-border px-4 pt-3 pb-4">
      <div className="mb-3">
        <DealPipelineSelector
          deal={deal}
          pipelines={pipelines}
          stages={stages}
          onCommit={onCommit}
        />
      </div>

      {/* Stage track. Progress is identity, not status, so it is painted in
          the brand ramp: stages already passed in the brand tint, the
          current stage as the one solid brand block, the rest neutral. Ink
          stays reserved for the deal's action (Won). */}
      <div className="flex items-stretch gap-1 rounded-xl bg-muted p-1">
        {ordered.map((stage, i) => {
          const isPast = currentIndex >= 0 && i < currentIndex;
          const isCurrent = stage.id === deal.stageId;
          const seconds = isCurrent
            ? currentStageSeconds
            : (durationByStage.get(stage.id) ?? (isPast ? 0 : null));

          return (
            <button
              key={stage.id}
              type="button"
              disabled={isClosed || isCurrent}
              onClick={() => !isCurrent && !isClosed && onStageChange(stage.id)}
              title={stage.name}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "relative flex h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-2 leading-none transition-colors",
                isCurrent
                  ? "bg-brand font-semibold text-brand-foreground shadow-raised"
                  : isPast
                    ? "bg-brand-subtle text-brand-subtle-foreground hover:bg-brand-100"
                    : "text-muted-foreground hover:bg-gray-alpha-100 hover:text-foreground",
                !isClosed && !isCurrent && "cursor-pointer",
                isClosed && "cursor-default",
              )}
            >
              <span className="w-full truncate text-center text-caption">
                {stage.name}
              </span>
              {seconds != null && (
                <span
                  className={cn(
                    "mt-1 text-[10px] font-normal tabular-nums",
                    isCurrent ? "text-brand-foreground/80" : "opacity-70",
                  )}
                >
                  {formatDuration(seconds)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
