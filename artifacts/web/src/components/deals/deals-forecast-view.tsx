import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useForecastDeals } from "@workspace/api-client-react";
import type { ForecastDealsParams } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/shared/money";
import type { DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-caption text-muted-foreground">
        {label}
      </div>
      <div
        className={
          accent
            ? "mt-1 text-heading-sm tabular-nums text-brand"
            : "mt-1 text-heading-sm tabular-nums text-foreground"
        }
      >
        {value}
      </div>
    </Card>
  );
}

export function DealsForecastView({ state }: { state: DealsUrlState }) {
  const { t } = useI18n();
  const params: ForecastDealsParams = {
    pipelineId: state.pipelineId,
    ownerId: state.ownerId,
    status: state.status as ForecastDealsParams["status"],
    filters: state.filters,
  };
  const { data, isLoading, isError } = useForecastDeals(params);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-body text-destructive">
        {t("deals.forecast.loadFailed")}
      </div>
    );
  }

  const chartData = data.buckets.map((b) => ({
    label: b.label,
    Weighted: b.weightedValue,
    Total: b.totalValue,
    count: b.count,
  }));

  return (
    <div className="h-full overflow-auto p-4 lg:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label={t("deals.forecast.openDeals")} value={data.totalCount.toLocaleString()} />
        <SummaryCard label={t("deals.forecast.totalValue")} value={<Money value={data.totalValue} />} />
        <SummaryCard
          label={t("deals.forecast.weightedValue")}
          value={<Money value={data.totalWeightedValue} />}
          accent
        />
      </div>

      <Card className="mt-6 p-4">
        <div className="mb-4 text-label font-semibold text-foreground">
          {t("deals.forecast.byMonth")}
        </div>
        {chartData.length === 0 ? (
          <div className="py-16 text-center text-body text-muted-foreground">
            {t("deals.forecast.noDates")}
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => formatCurrency(Number(v))}
                  width={90}
                />
                <Tooltip
                  formatter={(v: number) => formatCurrency(Number(v))}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                    color: "var(--card-foreground)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="Total"
                  fill="var(--chart-neutral)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar dataKey="Weighted" fill="var(--chart-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-body">
          <thead className="bg-surface-whisper text-caption font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start">{t("common.month")}</th>
              <th className="px-4 py-2.5 text-end">{t("common.deals")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.forecast.totalValue")}</th>
              <th className="px-4 py-2.5 text-end">{t("deals.forecast.weightedValue")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.buckets.map((b) => (
              <tr key={b.month}>
                <td className="px-4 py-2.5 text-foreground">{b.label}</td>
                <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">
                  {b.count}
                </td>
                <td className="px-4 py-2.5 text-end tabular-nums text-foreground">
                  <Money value={b.totalValue} />
                </td>
                <td className="px-4 py-2.5 text-end font-medium tabular-nums text-foreground">
                  <Money value={b.weightedValue} />
                </td>
              </tr>
            ))}
            {data.buckets.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {t("deals.forecast.noData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
