import { Link } from "wouter";
import { Flame } from "lucide-react";
import { useListDeals } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { WidgetCard } from "./widget-card";
import { useI18n } from "@/lib/i18n/i18n";

// Idle time mirrors the server's rotting derivation: the most recent of
// (stage change, last activity), falling back to the deal's creation time.
function daysIdle(deal: {
  stageChangeTime?: string | Date | null;
  lastActivityTime?: string | Date | null;
  addTime?: string | Date | null;
}): number {
  const times = [deal.stageChangeTime, deal.lastActivityTime, deal.addTime]
    .filter((t): t is string | Date => t != null)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - Math.max(...times)) / 86_400_000),
  );
}

export function RottenDealsWidget({ userId }: { userId: number }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useListDeals({
    ownerId: userId,
    status: "open",
    rotting: true,
    sort: "stageChangeTime:asc",
    limit: 5,
  });

  return (
    <WidgetCard
      title={
        <span className="flex items-center gap-2">
          {t("home.rotten.title")}
          {data && data.total > 0 && (
            <span className="rounded-full bg-destructive-subtle px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-destructive">
              {data.total}
            </span>
          )}
        </span>
      }
      action={{ label: t("home.rotten.viewAll"), href: "/deals?view=list" }}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!!data && data.items.length === 0}
      emptyText={t("home.rotten.empty")}
    >
      <div className="divide-y divide-border">
        {(data?.items ?? []).map((d) => (
          <Link
            key={d.id}
            href={`/deal/${d.id}`}
            className="flex items-center gap-3 py-2 hover:bg-gray-alpha-50"
          >
            <Flame className="h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {d.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatCurrency(d.value, d.currency)}
                {d.stageName ? ` · ${d.stageName}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-destructive">
              {t("home.rotten.idle", { count: daysIdle(d) })}
            </span>
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}
