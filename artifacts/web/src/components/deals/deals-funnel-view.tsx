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
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-600">
        {t("deals.funnel.loadFailed")}
      </div>
    );
  }

  const maxEntered = Math.max(...data.stages.map((s) => s.enteredCount), 1);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("common.pipeline")}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            {data.pipelineName}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("deals.funnel.entered")}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {data.totalEntered.toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("deals.funnel.stages")}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {data.stages.length}
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="mb-5 text-sm font-semibold text-slate-700">
          {t("deals.funnel.title")}
        </div>
        {data.stages.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
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
                    <span className="font-medium text-slate-700">
                      {s.stageName}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {s.enteredCount.toLocaleString()} entered
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-slate-100">
                      <div
                        className="flex h-full items-center justify-end rounded-md bg-gradient-to-r from-teal-500 to-teal-400 px-2 text-xs font-semibold text-white"
                        style={{ width: `${width}%` }}
                      >
                        {s.wonCount > 0 && <span>{s.wonCount.toLocaleString()} won</span>}
                      </div>
                    </div>
                    <div className="w-16 flex-shrink-0 text-end text-sm font-semibold tabular-nums text-teal-700">
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
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-start">{t("common.stage")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.enteredCol")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.reachedLater")}</th>
              <th className="px-4 py-2.5 text-end">{t("common.won")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.conversion")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.funnel.avgTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.stages.map((s) => (
              <tr key={s.stageId}>
                <td className="px-4 py-2.5 text-slate-700">{s.stageName}</td>
                <td className="px-4 py-2.5 text-end tabular-nums text-slate-700">
                  {s.enteredCount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-slate-600">
                  {s.reachedLaterCount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-slate-600">
                  {s.wonCount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-end font-medium tabular-nums text-teal-700">
                  {Math.round(s.conversionRate * 100)}%
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-slate-600">
                  {formatDuration(s.avgTimeInStageSeconds)}
                </td>
              </tr>
            ))}
            {data.stages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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
