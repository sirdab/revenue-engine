import { isToday, isYesterday, startOfDay } from "date-fns";
import { tStatic as t } from "@/lib/i18n/static";
import { formatDate } from "@/lib/format";

// Human-friendly elapsed time for stage durations ("3d 4h", "2h 10m", "45m").
export function formatDuration(seconds: number): string {
  if (seconds < 60) return t("deals.duration.lessThanMinute");
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return t("deals.duration.daysHours", { days, hours });
  if (hours > 0) return t("deals.duration.hoursMinutes", { hours, minutes });
  return t("activity.duration.minutes", { count: minutes });
}

// Header label for a timeline day group.
export function dayLabel(date: Date): string {
  if (isToday(date)) return t("common.today");
  if (isYesterday(date)) return t("common.yesterday");
  return formatDate(date.toISOString());
}

export function dayKey(date: Date): number {
  return startOfDay(date).getTime();
}
