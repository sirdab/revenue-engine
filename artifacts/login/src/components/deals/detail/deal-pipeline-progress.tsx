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
            <Skeleton key={i} className="h-7 flex-1 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (ordered.length === 0) return null;

  const NOTCH = 13;

  return (
    <div className="border-t border-border px-4 pt-2 pb-3">
      <div className="mb-2">
        <DealPipelineSelector
          deal={deal}
          pipelines={pipelines}
          stages={stages}
          onCommit={onCommit}
        />
      </div>

      {/* Chevron bar — segments interlock: each one points right and the next
          overlaps onto its tip (negative margin) so the bar reads as a single
          continuous arrow with no gaps. */}
      <div className="flex items-stretch">
        {ordered.map((stage, i) => {
          const isPast = currentIndex >= 0 && i < currentIndex;
          const isCurrent = stage.id === deal.stageId;
          const seconds = isCurrent
            ? currentStageSeconds
            : (durationByStage.get(stage.id) ?? (isPast ? 0 : null));

          // First segment has a flat left edge; every later segment carries a
          // left notch that nests onto the previous segment's arrow tip.
          const clipPath =
            i === 0
              ? `polygon(0 0, calc(100% - ${NOTCH}px) 0, 100% 50%, calc(100% - ${NOTCH}px) 100%, 0 100%)`
              : `polygon(0 0, calc(100% - ${NOTCH}px) 0, 100% 50%, calc(100% - ${NOTCH}px) 100%, 0 100%, ${NOTCH}px 50%)`;

          return (
            <button
              key={stage.id}
              type="button"
              disabled={isClosed || isCurrent}
              onClick={() => !isCurrent && !isClosed && onStageChange(stage.id)}
              title={stage.name}
              style={{
                clipPath,
                marginLeft: i === 0 ? 0 : -NOTCH,
                paddingLeft: i === 0 ? 12 : NOTCH + 10,
              }}
              className={cn(
                "relative flex h-10 min-w-0 flex-1 flex-col items-center justify-center pe-4 leading-none transition-colors",
                isCurrent
                  ? "bg-primary font-semibold text-primary-foreground"
                  : isPast
                    ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                    : "bg-gray-200 text-muted-foreground hover:bg-gray-300",
                !isClosed && !isCurrent && "cursor-pointer",
                isClosed && "cursor-default",
              )}
            >
              <span className="w-full truncate text-center text-[11px]">
                {stage.name}
              </span>
              {seconds != null && (
                <span
                  className={cn(
                    "mt-0.5 text-[10px] font-normal tabular-nums",
                    isCurrent || isPast ? "text-white/75" : "text-subtle",
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
