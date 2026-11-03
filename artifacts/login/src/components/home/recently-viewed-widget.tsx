import { Link } from "wouter";
import { Building2, HandCoins, UserRound } from "lucide-react";
import { useRecentlyViewed } from "@/hooks/use-user-preferences";
import type { RecentlyViewedEntry } from "@/lib/preferences";
import { formatRelativeShort } from "@/lib/format";
import { WidgetCard } from "./widget-card";
import { useI18n } from "@/lib/i18n/i18n";

const ICON: Record<RecentlyViewedEntry["type"], typeof HandCoins> = {
  deal: HandCoins,
  person: UserRound,
  organization: Building2,
};

export function RecentlyViewedWidget() {
  // Server-backed (cross-device) — the single source of truth for recently
  // viewed records; entries carry their own detail-page href.
  const { t } = useI18n();
  const records = useRecentlyViewed();

  return (
    <WidgetCard
      title={t("home.recent.title")}
      isEmpty={records.length === 0}
      emptyText={t("home.recent.empty")}
    >
      <div className="divide-y divide-border">
        {records.map((r) => {
          const Icon = ICON[r.type];
          return (
            <Link
              key={r.href}
              href={r.href}
              className="flex items-center gap-3 py-2 hover:bg-gray-alpha-50"
            >
              <Icon className="h-4 w-4 shrink-0 text-subtle" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {r.title}
              </p>
              <span className="shrink-0 text-xs text-subtle">
                {formatRelativeShort(r.viewedAt)}
              </span>
            </Link>
          );
        })}
      </div>
    </WidgetCard>
  );
}
