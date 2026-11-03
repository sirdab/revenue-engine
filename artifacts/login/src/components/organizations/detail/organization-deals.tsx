import { Link } from "wouter";
import { Handshake, ChevronRight, Flame } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@sirdab/one/components/empty-state";
import { Badge, type StatusTone } from "@/components/ui/badge";
import { Money } from "@/components/shared/money";
import { DealSectionCard } from "@/components/deals/detail/deal-section-card";
import type { Deal } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

const STATUS_TONE: Record<string, StatusTone> = {
  open: "neutral",
  won: "success",
  lost: "critical",
  deleted: "neutral",
};

export function OrganizationDeals({
  deals,
  loading,
}: {
  deals: Deal[];
  loading?: boolean;
}) {
  const { t } = useI18n();
  return (
    <DealSectionCard
      title={t("common.deals")}
      action={
        deals.length > 0 ? (
          <span className="text-caption font-medium text-subtle">
            {deals.length}
          </span>
        ) : undefined
      }
      bodyClassName="p-2"
    >
      {loading ? (
        <div className="space-y-1.5 p-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : deals.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={Handshake}
          title={t("contacts.noDeals")}
          caption={t("contacts.orgDealsHint")}
        />
      ) : (
        <ul className="divide-y divide-border">
          {deals.map((d) => (
            <li key={d.id}>
              <Link
                href={`/deal/${d.id}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-gray-alpha-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-body font-medium text-foreground">
                      {d.title}
                    </span>
                    {d.isRotting && d.status === "open" && (
                      <Flame className="h-3 w-3 shrink-0 text-warning-glyph" />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-caption text-subtle">
                    <Badge
                      tone={STATUS_TONE[d.status] ?? "neutral"}
                      className="capitalize"
                    >
                      {d.status}
                    </Badge>
                    {d.stageName && <span className="truncate">{d.stageName}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-body font-medium tabular-nums text-foreground">
                  <Money value={d.value} currency={d.currency} />
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-subtle transition-colors group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DealSectionCard>
  );
}
