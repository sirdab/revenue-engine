import { History } from "lucide-react";
import { useLocation } from "wouter";
import { useGetChangesFeed } from "@workspace/api-client-react";
import type { ChangesFeedItem } from "@workspace/api-client-react";
import { formatRelativeShort } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { changeFullSentence, changeHref } from "@/lib/change-feed";
import { useI18n } from "@/lib/i18n/i18n";

// Recent changes on your records, in the topbar next to the bell.
//
// This is the `change_events` audit feed that used to occupy the home page's
// "Notifications" card — which was never a notification surface: it owns no
// rows, has no read state, and nothing can be delivered to it. The card now
// reads the real notification store; the audit feed lives here.
//
// Passive by design: no unread badge, no mark-as-read. It is a log you glance
// at, not a queue you work through — the bell is the queue.
//
// Styling is copied from NotificationBell's trigger deliberately, not
// approximated: same h-5 w-5 glyph, same p-2 rounded-md hit area, same
// slate-500 to slate-900 hover. Two adjacent topbar icons that are a pixel
// apart look like a bug.

const LIMIT = 15;

export function RecentChangesMenu() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { data } = useGetChangesFeed({ limit: LIMIT });
  const items = data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("recentChanges.title")}
        title={t("recentChanges.title")}
        className="relative flex-shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-gray-alpha-100 hover:text-foreground focus:outline-none"
      >
        <History className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">{t("recentChanges.title")}</p>
          <p className="text-xs text-subtle">
            {t("recentChanges.subtitle")}
          </p>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("recentChanges.empty")}
          </p>
        ) : (
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((item: ChangesFeedItem) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(changeHref(item))}
                className="block w-full px-3 py-2 text-start hover:bg-gray-alpha-50"
              >
                <p className="text-sm leading-snug text-muted-foreground">
                  {changeFullSentence(item)}
                </p>
                <p className="text-xs text-subtle">
                  {formatRelativeShort(item.changedAt)}
                </p>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
