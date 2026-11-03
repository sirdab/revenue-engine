import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  useListNotifications,
  useDismissNotification,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { formatRelativeLong, initials } from "@/lib/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { notificationPath } from "@/lib/notification-path";
import { WidgetCard } from "./widget-card";
import { useI18n } from "@/lib/i18n/i18n";

// The home page's Notifications card.
//
// Reads the same store and the SAME QUERY KEY as the topbar bell, deliberately:
// React Query then serves both surfaces from one fetch, and they can never
// disagree about what you have been notified about. Change the limit here and
// the key diverges, which quietly doubles the request — keep it at 30 to match
// notification-bell.tsx.
//
// Not to be confused with the recent-changes feed, which used to live in this
// slot under the "Notifications" title while actually rendering the
// `change_events` audit log. That moved to the topbar History icon.

const LIMIT = 30;

type NotificationItem = {
  id: number;
  message: string;
  entityType?: string | null;
  entityId?: number | null;
  actorName?: string | null;
  readAt?: Date | string | null;
  createdAt: Date | string;
};

export function NotificationsWidget() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const queryKey = getListNotificationsQueryKey({ limit: LIMIT });
  const { data, isLoading, isError, refetch } = useListNotifications(
    { limit: LIMIT },
    { query: { queryKey } },
  );

  // Dismissal is optimistic: the row is what the user just clicked away, and
  // waiting a round trip to see it go feels broken. Invalidating on settle
  // reconciles with the server (and refreshes the bell's badge, which shares
  // this key).
  const dismiss = useDismissNotification({
    mutation: {
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (old: unknown) => {
          const prev = old as
            | { items?: NotificationItem[]; unreadCount?: number }
            | undefined;
          if (!prev?.items) return old;
          const target = prev.items.find((n) => n.id === id);
          return {
            ...prev,
            items: prev.items.filter((n) => n.id !== id),
            // Dismissing marks it read too, so an unread row leaving must take
            // its badge count with it or the bell shows a phantom.
            unreadCount: Math.max(
              0,
              (prev.unreadCount ?? 0) - (target && !target.readAt ? 1 : 0),
            ),
          };
        });
        return { previous };
      },
      onError: (_err, _vars, context) => {
        const ctx = context as { previous?: unknown } | undefined;
        if (ctx?.previous !== undefined) {
          queryClient.setQueryData(queryKey, ctx.previous);
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const items = (data?.items ?? []) as NotificationItem[];

  return (
    <WidgetCard
      title={t("notifications.title")}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!!data && items.length === 0}
      emptyText={t("notifications.empty")}
    >
      {/* Scrolls rather than growing without bound. Invoice-period alerts arrive
          in month-end bursts (every account with a billing period ending, per
          subscriber), so this card could otherwise run to hundreds of rows and
          push every other widget off the page. Capped by viewport height so it
          still shows a useful number of rows on a laptop. */}
      <div className="max-h-[26rem] divide-y divide-border overflow-y-auto">
        {items.map((item) => {
          const path = notificationPath(item.entityType, item.entityId);
          const dismissButton = (
            <button
              type="button"
              aria-label={t("notifications.dismissAria")}
              title={t("notifications.dismiss")}
              // The row is wrapped in a Link, so the click has to be stopped
              // from navigating as well as from bubbling — otherwise dismissing
              // also opens the account.
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss.mutate({ id: item.id });
              }}
              // Always present, just quiet: a hover-only X is invisible on
              // touch, and this is the only way to clear a sticky notification.
              className="mt-0.5 shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-gray-alpha-150 hover:text-foreground group-hover:text-subtle"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          );
          const row = (
            <div className="group flex items-start gap-2.5 py-2">
              <Avatar className="mt-0.5 h-6 w-6 border border-border bg-muted text-muted-foreground">
                <AvatarFallback className="bg-transparent text-[10px] font-medium">
                  {initials(item.actorName ?? "Sirdab")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm leading-snug",
                    // Unread carries weight; read fades back. Without this the
                    // card is a wall of identical rows and the bell's unread
                    // count has no visual counterpart here.
                    item.readAt ? "text-muted-foreground" : "font-medium text-foreground",
                  )}
                >
                  {item.message}
                </p>
                <p className="text-xs text-subtle">
                  {formatRelativeLong(item.createdAt)}
                </p>
              </div>
              {dismissButton}
            </div>
          );
          // A notification whose entity link cannot be resolved still has to
          // render — it is the message that matters — just not as a dead link.
          return path ? (
            <Link key={item.id} href={path} className="block hover:bg-gray-alpha-50">
              {row}
            </Link>
          ) : (
            <div key={item.id}>{row}</div>
          );
        })}
      </div>
    </WidgetCard>
  );
}
