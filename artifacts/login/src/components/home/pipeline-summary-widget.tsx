import { useLocation } from "wouter";
import {
  useGetDealStageSummary,
  getGetDealStageSummaryQueryKey,
  useListPipelines,
} from "@workspace/api-client-react";
import { encodeFilters } from "@workspace/deals-filter";
import { usePreference } from "@/hooks/use-user-preferences";
import { formatCurrency } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WidgetCard } from "./widget-card";
import { useI18n } from "@/lib/i18n/i18n";

export function PipelineSummaryWidget({ userId }: { userId: number }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  // /pipelines already hides archived pipelines and sorts the default first.
  const { data: pipelines } = useListPipelines();
  const active = pipelines ?? [];
  const [storedId, setStoredId] = usePreference<number | null>(
    "home.pipelineId",
    null,
  );
  const pipelineId = active.some((p) => p.id === storedId)
    ? (storedId as number)
    : active[0]?.id;

  const params = { pipelineId: pipelineId ?? 0, ownerId: userId };
  const { data, isLoading, isError, refetch } = useGetDealStageSummary(params, {
    query: {
      enabled: pipelineId != null,
      queryKey: getGetDealStageSummaryQueryKey(params),
    },
  });

  const openStage = (stageId: number) => {
    const filters = encodeFilters({
      combinator: "and",
      conditions: [{ field: "stage", operator: "is", value: stageId }],
    });
    navigate(`/deals?view=list&pipelineId=${pipelineId}&filters=${filters}`);
  };

  return (
    <WidgetCard
      title={t("home.pipeline.title")}
      action={{ label: t("home.pipeline.openBoard"), href: "/deals?view=pipeline" }}
      isLoading={isLoading || pipelineId == null}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!!data && data.totalCount === 0}
      emptyText={t("home.pipeline.empty")}
    >
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-bold tabular-nums text-foreground">
                {data.totalCount}
              </span>{" "}
              {t("home.pipeline.summary", { value: formatCurrency(data.totalValue), weighted: formatCurrency(data.totalWeightedValue) })}
            </p>
            {active.length > 1 && (
              <Select
                value={String(pipelineId)}
                onValueChange={(v) => setStoredId(Number(v))}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {data.stages.map((s) => (
              <button
                key={s.stageId}
                type="button"
                onClick={() => openStage(s.stageId)}
                className="min-w-[110px] flex-1 rounded-md border border-border bg-surface-whisper px-3 py-2 text-start transition-colors hover:border-brand-400 hover:bg-brand-subtle"
              >
                <p className="truncate text-xs font-medium text-muted-foreground">
                  {s.name}
                </p>
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {s.count}
                </p>
                <p className="truncate text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(s.totalValue)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
