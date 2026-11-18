import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, History, Pencil, PhoneMissed, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/i18n";
import { formatDate, formatTimestamp } from "@/lib/format";
import { EntityHistoryDialog } from "@/components/shared/entity-history-dialog";
import { ActivityStatusBadge } from "@/components/activities/activity-status";
import { MarkDoneToggle } from "@/components/activities/mark-done-toggle";
import { useFlash } from "@/components/activities/log-plan";
import { NoteView } from "./note-field";
import { closedUnsuccessful, statusOf } from "./activity-rules";
import type { ActivityListController } from "./activity-controller";
import type { ActivitySource, ActivityView } from "./activity-source";

// The one activity row, for every list and timeline: organizations,
// people, the deal timeline and the Activities agenda. Tables are laid out
// differently, so they compose the same parts exported below instead.
//
// A row reads the same everywhere: the done control, subject, status, then a
// meta line — type, due date, duration, who, and when it was completed. A
// draft has a Draft chip, no status, no done control and no history.

// ── parts ──────────────────────────────────────────────────────────────────

export function ActivityDoneControl({
  view,
  controller,
  className,
}: {
  view: ActivityView;
  controller: ActivityListController;
  className?: string;
}) {
  return (
    <MarkDoneToggle
      done={view.done}
      noReply={closedUnsuccessful(view)}
      onToggle={() => controller.toggle(view)}
      className={className}
    />
  );
}

export function ActivityStatusPill({ view, today }: { view: ActivityView; today: Date }) {
  if (view.draft) return null;
  return <ActivityStatusBadge status={statusOf(view, today)} />;
}

export function ActivityActions({
  view,
  source,
  controller,
}: {
  view: ActivityView;
  source: ActivitySource;
  controller: ActivityListController;
}) {
  const { t } = useI18n();
  const iconButton =
    "h-7 w-7 text-subtle transition-colors hover:bg-gray-alpha-100 hover:text-muted-foreground";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {!view.draft && (
        <EntityHistoryDialog
          entityType="activity"
          entityId={view.id}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("activity.row.viewHistory")}
              className={iconButton}
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          }
        />
      )}
      {!view.draft && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.edit(view)}
            aria-label={t("activity.row.edit")}
            className={cn(iconButton, "hover:text-foreground")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.remove(view)}
            aria-label={t("activity.row.delete")}
            className={cn(iconButton, "hover:text-destructive")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

function dueText(view: ActivityView): string | null {
  if (!view.dueDate) return null;
  return `${formatDate(view.dueDate)}${view.dueTime ? ` · ${view.dueTime}` : ""}`;
}

export function ActivityMeta({
  view,
  source,
  hideDeal = false,
}: {
  view: ActivityView;
  source: ActivitySource;
  /** On the deal's own page, every row naming that deal is noise. */
  hideDeal?: boolean;
}) {
  const { t } = useI18n();
  const due = dueText(view);
  const completed =
    view.done && view.markedAsDoneTime ? formatTimestamp(view.markedAsDoneTime) : null;
  const parts: ReactNode[] = [<span key="type">{source.typeLabel(view, t)}</span>];
  if (due) parts.push(<span key="due">{due}</span>);
  if (view.duration) parts.push(<span key="dur">({view.duration})</span>);
  if (!hideDeal && view.links?.deal?.label)
    parts.push(
      <Link
        key="deal"
        href={`/deal/${view.links.deal.id}`}
        className="truncate text-foreground underline-offset-2 hover:underline"
      >
        {view.links.deal.label}
      </Link>,
    );
  if (view.links?.person?.label) parts.push(<span key="person" className="truncate">{view.links.person.label}</span>);
  if (view.ownerName) parts.push(<span key="author" className="truncate">{view.ownerName}</span>);
  if (completed)
    parts.push(
      <span key="done" className="inline-flex items-center gap-1">
        {closedUnsuccessful(view) ? (
          <PhoneMissed className="h-3 w-3" />
        ) : (
          <CheckCircle2 className="h-3 w-3 text-success-glyph" />
        )}
        {completed}
      </span>,
    );
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-subtle">
      {parts.flatMap((p, i) => (i === 0 ? [p] : [<span key={`sep${i}`}>·</span>, p]))}
    </div>
  );
}

/** A row's note: commentary, not the headline, so collapsed by default in
 *  lists — a long description must not push the rest off the screen. */
export function ActivityNote({
  note,
  collapsed = true,
}: {
  note: string;
  collapsed?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(!collapsed);
  if (!collapsed) {
    return (
      <div className="mt-1">
        <NoteView note={note} />
      </div>
    );
  }
  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-caption text-subtle transition-colors hover:text-muted-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            // index.css already mirrors a chevron-right in Arabic, so there
            // the open state turns the other way to point down.
            open && "rotate-90 rtl:-rotate-90",
          )}
        />
        {open ? t("activity.row.hideDescription") : t("activity.row.showDescription")}
      </button>
      {open && (
        <div className="mt-1">
          <NoteView note={note} />
        </div>
      )}
    </div>
  );
}

// ── the row ────────────────────────────────────────────────────────────────

export function ActivityItem({
  view,
  source,
  controller,
  today,
  noteCollapsed = true,
  trailing,
  footer,
  hideDeal = false,
}: {
  view: ActivityView;
  source: ActivitySource;
  controller: ActivityListController;
  /** On the deal's own page: don't repeat the deal on every row. */
  hideDeal?: boolean;
  /** Start of today, computed once per render by the list. */
  today: Date;
  noteCollapsed?: boolean;
  /** Page-only extras beside the actions (e.g. a reschedule picker). */
  trailing?: ReactNode;
  /** Page-only extras under the row (e.g. a draft's Post / Discard). */
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const flash = useFlash(controller.flashId, view.id);
  // The row just written is brought into view, so what the form says it
  // logged is visible — a done row lands in the timeline, often well below
  // the open work.
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (controller.flashId === view.id) {
      rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [controller.flashId, view.id]);
  const Icon = source.typeIcon(view);
  const status = statusOf(view, today);
  const canToggle = !view.draft;

  return (
    <li ref={rowRef} className="flex gap-2.5">
      <span
        className={cn(
          "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          view.done
            ? "bg-muted text-subtle"
            : status === "overdue"
              ? "bg-destructive-subtle text-destructive-glyph"
              : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-lg border px-3 py-2",
          view.draft
            ? "border-dashed border-border bg-surface-whisper"
            : "border-border bg-surface-whisper",
          flash,
        )}
      >
        {/* On a narrow screen the status and actions wrap under the subject
            rather than squeezing it into a thin column. */}
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <div className="flex min-w-[55%] flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            {/* The control stays beside the subject's first line when a long
                subject wraps. */}
            <span className="flex min-w-0 items-start gap-1.5">
              {canToggle && (
                <ActivityDoneControl view={view} controller={controller} className="mt-0.5" />
              )}
              <span
                dir="auto"
                className={cn(
                  "min-w-0 text-body font-medium",
                  view.done ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {view.subject}
              </span>
            </span>
            {view.draft && (
              <Badge tone="attention">{t("common.draft")}</Badge>
            )}
          </div>
          {/* Wraps too: a page extra (the agenda's reschedule picker) plus
              the actions can be wider than a phone row. */}
          <div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            <ActivityStatusPill view={view} today={today} />
            {trailing}
            <ActivityActions view={view} source={source} controller={controller} />
          </div>
        </div>
        {view.note?.trim() && (
          <ActivityNote note={view.note} collapsed={noteCollapsed} />
        )}
        <ActivityMeta view={view} source={source} hideDeal={hideDeal} />
        {footer}
      </div>
    </li>
  );
}
