import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Deal, DealUpdate, Pipeline, Stage } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

// A clickable "Pipeline → Stage" pill (Pipedrive-style) that opens a dropdown to
// change the deal's pipeline and set its stage in one save.

const NOTCH = 11;

function StageChevrons({
  stages,
  selectedId,
  onSelect,
}: {
  stages: Stage[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { t } = useI18n();
  const selectedIndex = stages.findIndex((s) => s.id === selectedId);
  if (stages.length === 0) {
    return <p className="text-xs text-subtle">{t("deals.pipeline.noStages")}</p>;
  }
  return (
    <div className="flex items-stretch">
      {stages.map((stage, i) => {
        const filled = selectedIndex >= 0 && i <= selectedIndex;
        const clipPath =
          i === 0
            ? `polygon(0 0, calc(100% - ${NOTCH}px) 0, 100% 50%, calc(100% - ${NOTCH}px) 100%, 0 100%)`
            : `polygon(0 0, calc(100% - ${NOTCH}px) 0, 100% 50%, calc(100% - ${NOTCH}px) 100%, 0 100%, ${NOTCH}px 50%)`;
        return (
          <button
            key={stage.id}
            type="button"
            title={stage.name}
            onClick={() => onSelect(stage.id)}
            style={{
              clipPath,
              marginLeft: i === 0 ? 0 : -NOTCH,
              paddingLeft: i === 0 ? 8 : NOTCH + 6,
            }}
            className={cn(
              "relative flex h-7 min-w-0 flex-1 items-center justify-center pe-2.5 transition-colors",
              filled ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "bg-gray-200 text-muted-foreground hover:bg-gray-300",
              stage.id === selectedId && "bg-brand-600 font-semibold",
            )}
          >
            <span className="w-full truncate text-center text-[10px] leading-none">{stage.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DealPipelineSelector({
  deal,
  pipelines,
  stages,
  onCommit,
}: {
  deal: Deal;
  pipelines: Pipeline[];
  stages: Stage[];
  onCommit: (patch: Partial<DealUpdate>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState(deal.pipelineId);
  const [stageId, setStageId] = useState(deal.stageId);

  // Re-seed the draft each time the popover opens.
  useEffect(() => {
    if (open) {
      setPipelineId(deal.pipelineId);
      setStageId(deal.stageId);
    }
  }, [open, deal.pipelineId, deal.stageId]);

  const stagesFor = useMemo(
    () => (pid: number) =>
      stages.filter((s) => s.pipelineId === pid).sort((a, b) => a.orderIndex - b.orderIndex),
    [stages],
  );
  const draftStages = stagesFor(pipelineId);
  const currentPipeline = pipelines.find((p) => p.id === deal.pipelineId);
  const currentStage = stages.find((s) => s.id === deal.stageId);

  const changePipeline = (pid: number) => {
    setPipelineId(pid);
    const first = stagesFor(pid)[0];
    if (first) setStageId(first.id); // moving pipeline resets to its first stage
  };

  const changed = pipelineId !== deal.pipelineId || stageId !== deal.stageId;
  const valid = draftStages.some((s) => s.id === stageId);

  const save = () => {
    if (!changed || !valid) return;
    onCommit({ pipelineId, stageId });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-brand-300 hover:bg-brand-subtle"
        >
          <span className="text-muted-foreground">{currentPipeline?.name ?? t("common.pipeline")}</span>
          <ArrowRight className="h-3 w-3 text-subtle" />
          <span className="font-semibold text-brand">{currentStage?.name ?? "—"}</span>
          <ChevronDown className="h-3 w-3 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
              {t("common.pipeline")}
            </label>
            <Select value={String(pipelineId)} onValueChange={(v) => changePipeline(Number(v))}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
              {t("deals.pipeline.stage")}
            </label>
            <StageChevrons stages={draftStages} selectedId={stageId} onSelect={setStageId} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" disabled={!changed || !valid} onClick={save} className="bg-primary text-primary-foreground hover:bg-primary-hover">
              {t("common.save")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
