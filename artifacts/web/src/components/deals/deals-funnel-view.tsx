import {
  useGetPipelineFunnel,
  useListPipelines,
  getGetPipelineFunnelQueryKey,
} from "@workspace/api-client-react";
import type { GetPipelineFunnelParams } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return "<1m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function DealsFunnelView({ state }: { state: DealsUrlState }) {
  const { t, tPlural, formatNumber } = useI18n();
  const { data: pipelines } = useListPipelines();
  const pipelineId = state.pipelineId ?? pipelines?.[0]?.id;

  const params: GetPipelineFunnelParams = {
    pipelineId: pipelineId ?? 0,
    ownerId: state.ownerId,
  };
  const { data, isLoading, isError } = useGetPipelineFunnel(params, {
    query: {
      enabled: pipelineId != null,
      queryKey: getGetPipelineFunnelQueryKey(params),
    },
  });

  if (pipelineId == null || isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-body text-destructive">
        {t("deals.funnel.loadFailed")}
      </div>
    );
  }

  const maxEntered = Math.max(...data.stages.map((s) => s.enteredCount), 1);

  return (
    <div className="h-full overflow-auto p-4 lg:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-caption text-muted-foreground">
            {t("common.pipeline")}
          </div>
          <div className="mt-1 text-heading-sm tabular-nums text-foreground">
            {data.pipelineName}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-caption text-muted-foreground">
            {t("deals.funnel.entered")}
          </div>
          <div className="mt-1 text-heading-sm tabular-nums text-foreground">
            {formatNumber(data.totalEntered)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-caption text-muted-foreground">
            {t("deals.funnel.stages")}
          </div>
          <div className="mt-1 text-heading-sm tabular-nums text-foreground">
            {data.stages.length}
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="mb-5 text-label font-semibold text-foreground">
          {t("deals.funnel.title")}
        </div>
        {data.stages.length === 0 ? (
          <div className="py-16 text-center text-body text-muted-foreground">
            {t("deals.funnel.noHistory")}
          </div>
        ) : (
          <div className="space-y-4">
            {data.stages.map((s) => {
              const width = Math.max((s.enteredCount / maxEntered) * 100, 2);
              const conversionPct = Math.round(s.conversionRate * 100);
              return (
                <div key={s.stageId}>
                  <div className="mb-1 flex items-center justify-between text-body">
                    <span className="font-medium text-foreground">
                      {s.stageName}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {tPlural("deals.funnel.enteredCount", s.enteredCount, { count: formatNumber(s.enteredCount) })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="flex h-full items-center justify-end rounded-md bg-brand px-2 text-caption font-semibold text-brand-foreground"
                        style={{ width: `${width}%` }}
                      >
                        {s.wonCount > 0 && <span>{tPlural("deals.funnel.wonCount", s.wonCount, { count: formatNumber(s.wonCount) })}</span>}
                      </div>
                    </div>
                    <div className="w-16 flex-shrink-0 text-end text-label tabular-nums text-foreground">
                      {conversionPct}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-body">
          <thead className="bg-surface-whisper text-caption font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start">{t("common.stage")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.enteredCol")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.reachedLater")}</th>
              <th className="px-4 py-2.5 text-end">{t("common.won")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.conversion")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.avgTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.stages.map((s) => (
              <tr key={s.stageId}>
                <td className="px-4 py-2.5 text-foreground">{s.stageName}</td>
                <td className="px-4 py-2.5 text-end tabular-nums text-foreground">
                  {formatNumber(s.enteredCount)}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">
                  {formatNumber(s.reachedLaterCount)}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">
                  {formatNumber(s.wonCount)}
                </td>
                <td className="px-4 py-2.5 text-end font-medium tabular-nums text-foreground">
                  {Math.round(s.conversionRate * 100)}%
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">
                  {formatDuration(s.avgTimeInStageSeconds)}
                </td>
              </tr>
            ))}
            {data.stages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t("deals.funnel.noData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
