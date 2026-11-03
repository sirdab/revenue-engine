import React from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeShort } from "@/lib/format";
import { notificationPath } from "@/lib/notification-path";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

type NotificationItem = {
  id: number;
  message: string;
  entityType?: string | null;
  entityId?: number | null;
  readAt?: Date | string | null;
  createdAt: Date | string;
};

export function NotificationBell() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data } = useListNotifications(
    { limit: 30 },
    {
      query: {
        queryKey: getListNotificationsQueryKey({ limit: 30 }),
        refetchInterval: 30_000,
      },
    },
  );
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });

  const open = (n: NotificationItem) => {
    if (!n.readAt) {
      markRead.mutate({ id: n.id }, { onSettled: refresh });
    }
    const path = notificationPath(n.entityType, n.entityId);
    if (path) navigate(path);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={
          unreadCount > 0
            ? t("notifications.titleUnread", { count: unreadCount })
            : t("notifications.title")
        }
        className="relative flex-shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold text-slate-700">
            {t("notifications.title")}
          </span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate(undefined, { onSettled: refresh })}
              className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-400">
            {t("notifications.caughtUp")}
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2.5 text-start transition-colors hover:bg-slate-50",
                    !n.readAt && "bg-teal-50/50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                      n.readAt ? "bg-transparent" : "bg-teal-500",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-slate-700">
                      {n.message}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {formatRelativeShort(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
