import type { ReactNode } from "react";
import type { ChangeEvent } from "@workspace/api-client-react";
import { formatTimestamp } from "@/lib/format";
import { dayKey, dayLabel } from "@/components/deals/detail/deal-utils";

export { dayLabel };

export function snapshotLabel(v: ChangeEvent["oldValue"]): string {
  if (!v) return "—";
  return v.label ?? (v.id != null ? String(v.id) : "—");
}

export function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface ChangeDescription {
  title: ReactNode;
  icon: ReactNode;
  accent: string;
}

// Groups events by local day, newest day first, newest event first within a
// day — the same grouping deal-timeline.tsx applies to its merged feed.
export function groupChangeEventsByDay(
  events: ChangeEvent[],
): Array<[number, ChangeEvent[]]> {
  const sorted = [...events].sort(
    (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime(),
  );
  const map = new Map<number, ChangeEvent[]>();
  for (const e of sorted) {
    const key = dayKey(new Date(e.changedAt));
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
}

// One change_events row: icon + description + who + relative time. Entity-
// agnostic — the caller supplies `describe` to turn a raw event into a
// human-readable title/icon/accent for its own field-key vocabulary.
export function ChangeEventRow({
  event,
  describe,
}: {
  event: ChangeEvent;
  describe: (e: ChangeEvent) => ChangeDescription;
}) {
  const { title, icon, accent } = describe(event);
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${accent}`}
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="truncate text-sm text-slate-600">
          {title}
          {event.changedByName && (
            <span className="text-slate-400"> · {event.changedByName}</span>
          )}
        </div>
        <time className="shrink-0 text-[11px] text-slate-400">
          {formatTimestamp(event.changedAt)}
        </time>
      </div>
    </div>
  );
}
