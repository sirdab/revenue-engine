import { Link } from "wouter";
import { Handshake, ChevronRight, Flame } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { Money } from "@/components/shared/money";
import { DealSectionCard } from "@/components/deals/detail/deal-section-card";
import type { Deal } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

const STATUS_PILL: Record<string, string> = {
  open: "bg-teal-50 text-teal-700 border-teal-200",
  won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost: "bg-red-50 text-red-600 border-red-200",
  deleted: "bg-slate-100 text-slate-500 border-slate-200",
};

export function PersonDeals({
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
          <span className="text-[11px] font-medium text-slate-400">
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
        <Empty className="border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Handshake className="h-4 w-4" />
            </EmptyMedia>
            <EmptyTitle>{t("contacts.noDeals")}</EmptyTitle>
            <EmptyDescription>
              {t("contacts.personDealsHint")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {deals.map((d) => (
            <li key={d.id}>
              <Link
                href={`/deal/${d.id}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-800">
                      {d.title}
                    </span>
                    {d.isRotting && d.status === "open" && (
                      <Flame className="h-3 w-3 shrink-0 text-orange-500" />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-px font-semibold uppercase tracking-wide",
                        STATUS_PILL[d.status] ?? STATUS_PILL.deleted,
                      )}
                    >
                      {d.status}
                    </span>
                    {d.stageName && <span className="truncate">{d.stageName}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">
                  <Money value={d.value} currency={d.currency} />
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-teal-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DealSectionCard>
  );
}
