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
  const { t } = useI18n();
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
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {t("deals.funnel.loadFailed")}
      </div>
    );
  }

  const maxEntered = Math.max(...data.stages.map((s) => s.enteredCount), 1);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("common.pipeline")}
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">
            {data.pipelineName}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("deals.funnel.entered")}
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">
            {data.totalEntered.toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("deals.funnel.stages")}
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">
            {data.stages.length}
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="mb-5 text-sm font-semibold text-foreground">
          {t("deals.funnel.title")}
        </div>
        {data.stages.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {t("deals.funnel.noHistory")}
          </div>
        ) : (
          <div className="space-y-4">
            {data.stages.map((s) => {
              const width = Math.max((s.enteredCount / maxEntered) * 100, 2);
              const conversionPct = Math.round(s.conversionRate * 100);
              return (
                <div key={s.stageId}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      {s.stageName}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.enteredCount.toLocaleString()} entered
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="flex h-full items-center justify-end rounded-md bg-gradient-to-r from-brand-500 to-brand-400 px-2 text-xs font-semibold text-white"
                        style={{ width: `${width}%` }}
                      >
                        {s.wonCount > 0 && <span>{s.wonCount.toLocaleString()} won</span>}
                      </div>
                    </div>
                    <div className="w-16 flex-shrink-0 text-end text-sm font-semibold tabular-nums text-brand">
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
        <table className="w-full text-sm">
          <thead className="bg-surface-whisper text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                  {s.enteredCount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">
                  {s.reachedLaterCount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">
                  {s.wonCount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-end font-medium tabular-nums text-brand">
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
