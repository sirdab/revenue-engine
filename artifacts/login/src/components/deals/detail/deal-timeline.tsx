import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "wouter";
import { startOfDay } from "date-fns";
import { formatTimestamp } from "@/lib/format";
import {
  useUpdateNote,
  usePostActivity,
  usePostNote,
  useDeleteActivity,
  useDeleteNote,
  useListUserOptions,
  getListActivitiesQueryKey,
  getListNotesQueryKey,
  getListUserOptionsQueryKey,
  getGetDealQueryKey,
  getGetActivityHistoryQueryKey,
  getGetNoteHistoryQueryKey,
  getGetDealHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  ArrowRight,
  User,
  PencilLine,
  CalendarDays,
  XCircle,
  MessageSquare,
  Pencil,
  History,
  FileText,
  Download,
  Trash2,
  GitMerge,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { Segmented, SegmentedItem } from "@sirdab/one/components/segmented";
import { DealSectionCard } from "./deal-section-card";
import { RichText } from "./rich-text";
import { ReactionBar } from "./reaction-bar";
import { LinkPreviewCards } from "./link-preview-card";
import { RichNoteEditor, type RichNoteEditorHandle } from "./rich-note-editor";
import { useAuth } from "@/hooks/use-auth";
import {
  useDealNoteAttachments,
  downloadFile,
  openFile,
  isPreviewable,
  formatFileSize,
  isImageMime,
  type CrmFile,
} from "@/lib/files-api";
import { STATUS_PILL_CLASS } from "@/components/activities/activity-status";
import { useDealActivityList } from "@/components/activities/mark-activity-done";
import { ActivityItem } from "@/components/activities/shared/activity-item";
import {
  dealToView,
  type ActivitySource,
} from "@/components/activities/shared/activity-source";
import type { ActivityListController } from "@/components/activities/shared/activity-controller";
import { dayKey, dayLabel } from "./deal-utils";
import {
  snapshotLabel,
  prettifyKey,
  ChangeEventRow,
  type ChangeDescription,
} from "@/components/shared/entity-timeline";
import { EntityHistoryDialog } from "@/components/shared/entity-history-dialog";
import type {
  Activity,
  Note,
  ChangeEvent,
  UserOption as ApiUser,
} from "@workspace/api-client-react";
import { useI18n, type I18n, type MessageKey } from "@/lib/i18n/i18n";

type Entry =
  | { kind: "activity"; id: number; date: Date; data: Activity }
  | { kind: "note"; id: number; date: Date; data: Note }
  | { kind: "change"; id: number; date: Date; data: ChangeEvent };

type Tab = "all" | "activities" | "notes" | "history";

const TABS: { key: Tab; label: MessageKey }[] = [
  { key: "all", label: "common.all" },
  { key: "activities", label: "common.activities" },
  { key: "notes", label: "common.notes" },
  { key: "history", label: "common.history" },
];

// Human labels for the tracked deal fields rendered by the generic branch
// below. Add a key here and the timeline reads naturally — no new case needed.
const FIELD_LABELS: Record<string, MessageKey> = {
  pipeline_id: "common.pipeline",
  person_id: "deals.timeline.field.contact",
  organization_id: "common.organization",
  currency: "common.currency",
  comments: "common.comments",
  lost_reason_note: "deals.timeline.field.lostReasonNote",
  labels: "deals.field.labels",
  visible_to: "deals.merge.field.visibleTo",
  utm_source: "deals.field.utmSource",
  utm_medium: "deals.field.utmMedium",
  utm_campaign: "deals.field.utmCampaign",
  utm_keyword: "deals.field.utmKeyword",
  ad_name: "deals.field.adName",
  gclid: "deals.merge.field.gclid",
  fbclid: "deals.merge.field.fbclid",
};

const strong = (text: ReactNode) => <span className="font-semibold">{text}</span>;

function describeChange(
  { t, tNode }: Pick<I18n, "t" | "tNode">,
  e: ChangeEvent,
): ChangeDescription {
  const oldL = snapshotLabel(e.oldValue);
  const newL = snapshotLabel(e.newValue);
  switch (e.fieldKey) {
    case "created":
      return {
        title: t("deals.timeline.created"),
        icon: <Sparkles className="h-3.5 w-3.5" />,
        accent: "bg-brand-subtle text-brand",
      };
    // Both sides of a merge. Without these they fell through to the generic
    // "<Prettified Key> → <value>" branch and rendered as "Merged From →".
    case "merged_from":
      return {
        title: (
          <span>
            {tNode("deals.timeline.mergedIn", { deal: strong(newL) })}
            {e.newValue?.id != null && (
              <span className="text-subtle"> · #{e.newValue.id}</span>
            )}
          </span>
        ),
        icon: <GitMerge className="h-3.5 w-3.5" />,
        accent: "bg-brand-subtle text-brand",
      };
    // On the deal that was merged AWAY: the one thing on its timeline that
    // explains why it has nothing else on it.
    case "merged_into":
      return {
        title: (
          <span>
            {tNode("deals.timeline.mergedInto", { deal: strong(newL) })}
            {e.newValue?.id != null && (
              <span className="text-subtle"> · #{e.newValue.id}</span>
            )}
          </span>
        ),
        icon: <GitMerge className="h-3.5 w-3.5" />,
        accent: "bg-attention-subtle text-attention-glyph",
      };
    case "archived": {
      const nowArchived = e.newValue?.label === "true";
      return {
        title: t(nowArchived ? "common.archived" : "deals.timeline.restored"),
        icon: nowArchived ? (
          <Archive className="h-3.5 w-3.5" />
        ) : (
          <ArchiveRestore className="h-3.5 w-3.5" />
        ),
        accent: nowArchived
          ? "bg-warning-subtle text-warning"
          : "bg-muted text-muted-foreground",
      };
    }
    case "stage_id":
      return {
        title: e.oldValue ? (
          <span>{tNode("deals.timeline.stageChange", { from: strong(oldL), to: strong(newL) })}</span>
        ) : (
          <span>{tNode("deals.timeline.entered", { stage: strong(newL) })}</span>
        ),
        icon: <ArrowRight className="h-3.5 w-3.5" />,
        accent: "bg-attention-subtle text-attention-glyph",
      };
    case "owner_id":
      return {
        title: (
          <span>{tNode("deals.timeline.ownerChange", { owner: strong(newL) })}</span>
        ),
        icon: <User className="h-3.5 w-3.5" />,
        accent: "bg-warning-subtle text-warning",
      };
    case "value":
      return {
        title: (
          <span>{tNode("deals.timeline.valueChange", { from: strong(oldL), to: strong(newL) })}</span>
        ),
        icon: <PencilLine className="h-3.5 w-3.5" />,
        accent: "bg-muted text-muted-foreground",
      };
    case "status":
      return {
        title: (
          <span>{tNode("deals.timeline.statusChange", { status: strong(newL) })}</span>
        ),
        icon: <PencilLine className="h-3.5 w-3.5" />,
        accent: "bg-muted text-muted-foreground",
      };
    case "title":
      return {
        title: (
          <span>{tNode("deals.timeline.titleChange", { title: strong(newL) })}</span>
        ),
        icon: <PencilLine className="h-3.5 w-3.5" />,
        accent: "bg-muted text-muted-foreground",
      };
    case "expected_close_date":
      return {
        title: (
          <span>{tNode("deals.timeline.closeDateChange", { date: strong(newL) })}</span>
        ),
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        accent: "bg-muted text-muted-foreground",
      };
    case "lost_reason":
      return {
        title: (
          <span>{tNode("deals.timeline.lost", { reason: strong(newL) })}</span>
        ),
        icon: <XCircle className="h-3.5 w-3.5" />,
        accent: "bg-destructive-subtle text-destructive",
      };
    default: {
      // File uploads/removals are logged as "file:<id>"; render a proper
      // sentence instead of falling through to the generic "Label old →
      // new" branch below (which would print "File:123 → contract.pdf").
      if (e.fieldKey.startsWith("file:")) {
        const isDelete = e.newValue == null;
        const fileLabel =
          (isDelete ? e.oldValue?.label : e.newValue?.label) ?? t("deals.timeline.aFile");
        return {
          title: (
            <span>
              {tNode(isDelete ? "deals.timeline.removedFile" : "deals.timeline.uploadedFile", { file: strong(fileLabel) })}
            </span>
          ),
          icon: <FileText className="h-3.5 w-3.5" />,
          accent: isDelete
            ? "bg-destructive-subtle text-destructive"
            : "bg-brand-subtle text-brand",
        };
      }
      // Custom-field edits are logged as "cf:<key>"; show the field name.
      const label = e.fieldKey.startsWith("cf:")
        ? prettifyKey(e.fieldKey.slice(3))
        : FIELD_LABELS[e.fieldKey]
          ? t(FIELD_LABELS[e.fieldKey])
          : prettifyKey(e.fieldKey);
      return {
        title: (
          <span>
            {e.oldValue
              ? tNode("deals.timeline.fieldChange", { field: label, from: strong(oldL), to: strong(newL) })
              : tNode("deals.timeline.fieldSet", { field: label, to: strong(newL) })}
          </span>
        ),
        icon: <PencilLine className="h-3.5 w-3.5" />,
        accent: "bg-muted text-muted-foreground",
      };
    }
  }
}

// Inline rich-text editor shown when a note (a comment) is edited directly in
// the timeline. Reuses the composer's editor (mentions, toolbar). Activities
// are edited in the shared edit dialog instead.
function InlineNoteEditor({
  initialHTML,
  users,
  saving,
  onSave,
  onCancel,
}: {
  initialHTML: string;
  users: ApiUser[];
  saving: boolean;
  onSave: (html: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<RichNoteEditorHandle>(null);
  const [empty, setEmpty] = useState(!initialHTML);

  const submit = () => {
    // No real change (TipTap only normalized legacy markup) → close without
    // saving, so a no-op edit fires no history event or mention re-diff.
    if (ref.current && !ref.current.isDirty()) {
      onCancel();
      return;
    }
    const html = ref.current?.isEmpty() ? "" : (ref.current?.getHTML() ?? "");
    if (!html) return;
    onSave(html);
  };

  return (
    <div className="mt-2 space-y-2">
      <RichNoteEditor
        ref={ref}
        users={users}
        initialHTML={initialHTML}
        onEmptyChange={setEmpty}
        onSubmit={submit}
        placeholder={t("deals.composer.notePlaceholder")}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={saving || empty}
        >
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function TimelineRow({
  entry,
  dealId,
  today,
  source,
  controller,
  onDeleteNote,
  users,
  canModify,
  attachments,
  editing,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onPost,
  onDiscard,
  mutating,
}: {
  entry: Entry;
  dealId: number;
  today: Date;
  source: ActivitySource;
  controller: ActivityListController;
  onDeleteNote: () => void;
  users: ApiUser[];
  // R10: false hides the edit AND delete affordances on a comment the viewer
  // can't modify.
  canModify: boolean;
  // Posted-comment attachments (download chips for non-images).
  attachments: CrmFile[];
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (html: string) => void;
  onPost: () => void;
  onDiscard: () => void;
  mutating: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const describe = (e: ChangeEvent) => describeChange(i18n, e);
  if (entry.kind === "change") {
    return <ChangeEventRow event={entry.data} describe={describe} />;
  }

  // Drafts are visible only to their creator; they trade the status badge and
  // history icon (no events exist yet) for a Draft chip + Post/Discard actions.
  const draft = entry.data.draft;
  const draftActions = draft && !editing && (
    <div className="mt-2 flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDiscard}
        disabled={mutating}
        className="text-muted-foreground hover:text-destructive"
      >
        {t("common.discard")}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onPost}
        disabled={mutating}
      >
        {mutating ? t("activity.drafts.posting") : t("activity.drafts.post")}
      </Button>
    </div>
  );

  // Activities are the shared row: tick, status, edit in the
  // shared dialog, history and delete, with the full note shown.
  if (entry.kind === "activity") {
    return (
      <ul>
        <ActivityItem
          hideDeal
          view={dealToView(entry.data as Activity)}
          source={source}
          controller={controller}
          today={today}
          noteCollapsed={false}
          footer={draftActions || undefined}
        />
      </ul>
    );
  }

  const note = entry.data as Note;
  const body = note.content ?? "";

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-lg border px-3 py-2",
          draft
            ? "border-dashed border-warning/30 bg-warning-subtle/40"
            : "border-border bg-surface-whisper",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate text-body font-medium text-foreground">
              {t("activity.type.note")}
            </span>
            {draft && (
              <span
                className={cn(
                  STATUS_PILL_CLASS,
                  "border-warning/30 bg-warning-subtle text-warning",
                )}
              >
                {t("common.draft")}
              </span>
            )}
            {note.userName && (
              <span className="text-[11px] text-subtle">· {note.userName}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!editing && (
              <>
                {!draft && (
                  <EntityHistoryDialog
                    entityType="note"
                    entityId={entry.id}
                    trigger={
                      <button
                        type="button"
                        title={t("activity.row.viewHistory")}
                        className="text-subtle transition-colors hover:text-muted-foreground"
                      >
                        <History className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                )}
                {/* R10: comments are editable only by author/admin. */}
                {canModify && (
                  <button
                    type="button"
                    onClick={onStartEdit}
                    title={t("deals.timeline.editNote")}
                    className="text-subtle transition-colors hover:text-muted-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {/* Posted comments delete from the same author/admin gate as
                    the pencil (R10). A draft keeps its Discard button instead,
                    so it never shows both. */}
                {!draft && canModify && (
                  <button
                    type="button"
                    onClick={onDeleteNote}
                    disabled={mutating}
                    title={t("deals.timeline.deleteNote")}
                    className="text-subtle transition-colors hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
            <time className="text-[11px] text-subtle">
              {formatTimestamp(entry.date)}
            </time>
          </div>
        </div>
        {editing ? (
          <InlineNoteEditor
            initialHTML={body}
            users={users}
            saving={saving}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          body && (
            <RichText
              html={body}
              className="mt-1 break-words text-body text-muted-foreground"
            />
          )
        )}
        {/* Non-image attachments as download chips (R3); images already render
            inline from the note HTML above. */}
        {!draft && !editing && (
          <AttachmentChips
            attachments={attachments.filter((f) => !isImageMime(f.mimeType))}
          />
        )}
        {/* Link preview cards for URLs in a posted comment (R11). */}
        {!draft && !editing && <LinkPreviewCards previews={note.previews ?? []} />}
        {/* Reactions on posted comments only (R9) — self-service for everyone. */}
        {!draft && !editing && (
          <ReactionBar
            dealId={dealId}
            noteId={entry.id}
            reactions={note.reactions ?? []}
          />
        )}
        {draftActions}
      </div>
    </div>
  );
}

// Chips for a posted comment's non-image attachments (R3). Previewable types
// (PDF) open inline in a new tab on click; a trailing download button always
// saves the file. Non-previewable types (docx/xlsx) click straight to download.
function AttachmentChips({ attachments }: { attachments: CrmFile[] }) {
  const { t } = useI18n();
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((f) => {
        const previewable = isPreviewable(f.mimeType);
        return (
          <div
            key={f.id}
            className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-caption text-muted-foreground"
          >
            <button
              type="button"
              onClick={() =>
                previewable ? openFile(f.id) : void downloadFile(f.id, f.fileName)
              }
              title={t(previewable ? "deals.timeline.previewFile" : "deals.timeline.downloadFile", { file: f.fileName })}
              className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-brand"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-subtle" />
              <span className="truncate">{f.fileName}</span>
              <span className="shrink-0 text-[10px] text-subtle">
                {formatFileSize(f.sizeBytes)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void downloadFile(f.id, f.fileName)}
              title={t("common.download")}
              className="shrink-0 text-subtle transition-colors hover:text-foreground"
            >
              <Download className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function DealTimeline({
  dealId,
  activities,
  notes,
  changeEvents,
  loading,
  flashActivityId,
}: {
  dealId: number;
  activities: Activity[];
  notes: Note[];
  changeEvents: ChangeEvent[];
  loading?: boolean;
  /** Highlight this activity's row briefly (the composer's onLogged). */
  flashActivityId?: number | null;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("all");
  // Which timeline entry (e.g. "note-12" / "activity-7") is being edited inline.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const today = startOfDay(new Date());
  const updateNote = useUpdateNote();
  const postActivity = usePostActivity();
  const postNote = usePostNote();
  const deleteActivity = useDeleteActivity();
  const deleteNote = useDeleteNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  // R10: only a comment's author or an admin may edit/delete it.
  const canModifyNote = (note: Note) =>
    note.userId === (user?.id ?? -1) || Boolean(user?.isAdmin);

  // Users for @mention autocomplete in the inline editor. Same query key as the
  // composer, so this hits the cache it already warmed.
  const { data: users = [] } = useListUserOptions({
    query: { queryKey: getListUserOptionsQueryKey(), staleTime: 10 * 60_000 },
  });

  // Activity rows are the shared row, their actions the shared controller;
  // ticking still runs the deal mark-done flow (note step, "what's next?").
  const {
    source: activitySource,
    controller: activityController,
    dialogs: activityDialogs,
  } = useDealActivityList(activities, (activityId) => {
    // Bare key + search: Home widgets, the Activities page and the
    // org/person lists read this activity too, not just this deal.
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    queryClient.invalidateQueries({
      queryKey: getGetActivityHistoryQueryKey(activityId),
    });
  });
  // The composer's latest write flashes once here.
  const { setFlashId } = activityController;
  useEffect(() => {
    if (flashActivityId != null) setFlashId(flashActivityId);
  }, [flashActivityId, setFlashId]);

  const saving = updateNote.isPending;

  const saveEdit = async (entry: Entry, html: string) => {
    try {
      if (entry.kind === "note") {
        await updateNote.mutateAsync({ id: entry.id, data: { content: html } });
        queryClient.invalidateQueries({
          queryKey: getListNotesQueryKey({ dealId }),
        });
        queryClient.invalidateQueries({
          queryKey: getGetNoteHistoryQueryKey(entry.id),
        });
      }
      queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      setEditingKey(null);
      toast({ title: t("common.saved") });
    } catch {
      toast({ title: t("common.saveFailed"), variant: "destructive" });
    }
  };

  // Which timeline entry ("note-12" / "activity-7") has a mutation in flight —
  // a draft post/discard, or a posted comment's delete — so only that row's
  // buttons are disabled.
  const [pendingEntryKey, setPendingEntryKey] = useState<string | null>(null);

  const invalidateAfterDraftAction = (entry: Entry) => {
    if (entry.kind === "note") {
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey({ dealId }) });
    } else {
      // The drafts list, Home and the Activities page read activities too.
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    }
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    // Posting/discarding a comment changes which attachments are timeline-
    // visible (the chip query returns posted-comment attachments only).
    if (entry.kind === "note") {
      queryClient.invalidateQueries({ queryKey: ["crm-files"] });
    }
  };

  // Publish a draft: the server resets addTime to now and logs the "created"
  // event, so the row re-sorts to the top of today's group.
  const postDraft = async (entry: Entry) => {
    setPendingEntryKey(`${entry.kind}-${entry.id}`);
    try {
      if (entry.kind === "note") {
        await postNote.mutateAsync({ id: entry.id });
      } else {
        await postActivity.mutateAsync({ id: entry.id });
      }
      invalidateAfterDraftAction(entry);
      toast({ title: entry.kind === "note" ? t("deals.composer.notePosted") : t("activity.drafts.posted") });
    } catch {
      toast({ title: t("activity.drafts.postFailed"), variant: "destructive" });
    } finally {
      setPendingEntryKey(null);
    }
  };

  // Discard deletes the draft outright — it was never published, so no
  // history event is logged and nothing remains.
  const discardDraft = async (entry: Entry) => {
    if (!window.confirm(t("activity.drafts.discardConfirm")))
      return;
    setPendingEntryKey(`${entry.kind}-${entry.id}`);
    try {
      if (entry.kind === "note") {
        await deleteNote.mutateAsync({ id: entry.id });
      } else {
        await deleteActivity.mutateAsync({ id: entry.id });
      }
      invalidateAfterDraftAction(entry);
      toast({ title: t("activity.drafts.discarded") });
    } catch {
      toast({ title: t("activity.drafts.discardFailed"), variant: "destructive" });
    } finally {
      setPendingEntryKey(null);
    }
  };

  // Delete a POSTED comment. Activities already had a delete affordance;
  // comments had none, so a stray note could only be edited, never removed.
  // Unlike discardDraft this also invalidates the deal history — deleting a
  // comment that carried attachments logs one deal-scoped `file:{id}` removal
  // event per file, which the History tab renders. (The note's own "deleted"
  // event is entityType "note", so it never shows in the deal history.)
  const deletePostedNote = async (entry: Entry) => {
    if (!window.confirm(t("deals.timeline.deleteNoteConfirm"))) return;
    setPendingEntryKey(`${entry.kind}-${entry.id}`);
    try {
      await deleteNote.mutateAsync({ id: entry.id });
      queryClient.invalidateQueries({ queryKey: getListNotesQueryKey({ dealId }) });
      queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      queryClient.invalidateQueries({
        queryKey: getGetDealHistoryQueryKey(dealId),
      });
      // Attachments on the note are reaped server-side along with it.
      queryClient.invalidateQueries({ queryKey: ["crm-files"] });
      toast({ title: t("deals.timeline.noteDeleted") });
    } catch {
      toast({ title: t("deals.timeline.deleteNoteFailed"), variant: "destructive" });
    } finally {
      setPendingEntryKey(null);
    }
  };

  // Flat, newest-first entry list for the active filter. Windowing (below)
  // slices this; grouping happens on the visible slice, so no query changes and
  // every existing invalidation still works.
  const allEntries = useMemo(() => {
    const include = {
      activity: tab === "all" || tab === "activities",
      note: tab === "all" || tab === "notes",
      change: tab === "all" || tab === "history",
    };
    return [
      ...(include.activity
        ? activities.map(
            (a): Entry => ({
              kind: "activity",
              id: a.id,
              date: new Date(a.addTime),
              data: a,
            }),
          )
        : []),
      ...(include.note
        ? notes.map(
            (n): Entry => ({
              kind: "note",
              id: n.id,
              date: new Date(n.addTime),
              data: n,
            }),
          )
        : []),
      ...(include.change
        ? changeEvents.map(
            (e): Entry => ({
              kind: "change",
              id: e.id,
              date: new Date(e.changedAt),
              data: e,
            }),
          )
        : []),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [activities, notes, changeEvents, tab]);

  // Render windowing: start with a page of entries, reveal more as a sentinel
  // scrolls into view. Data is already fully fetched — this is pure render
  // windowing, so a long thread opens instantly.
  const WINDOW_PAGE = 30;
  const [visibleCount, setVisibleCount] = useState(WINDOW_PAGE);
  useEffect(() => setVisibleCount(WINDOW_PAGE), [tab]);

  const groups = useMemo(() => {
    const visible = allEntries.slice(0, visibleCount);
    const map = new Map<number, Entry[]>();
    for (const entry of visible) {
      const key = dayKey(entry.date);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [allEntries, visibleCount]);

  const hasMore = visibleCount < allEntries.length;
  // The notes list is fetched with the server's default cap (200). Hitting it
  // means older comments were never loaded — surface a soft notice so they
  // aren't silently dropped. (True server-side pagination is the follow-up.)
  const NOTES_FETCH_CAP = 200;
  const notesCapped =
    notes.length >= NOTES_FETCH_CAP && (tab === "all" || tab === "notes");
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + WINDOW_PAGE, allEntries.length));
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, allEntries.length]);

  // Posted-comment attachments for the whole deal in one call — grouped by note
  // for download chips (inline images render from the note HTML separately).
  const { data: noteAttachments = [] } = useDealNoteAttachments(dealId);
  const attachmentsByNote = useMemo(() => {
    const map = new Map<number, CrmFile[]>();
    for (const f of noteAttachments) {
      if (f.noteId == null) continue;
      const arr = map.get(f.noteId) ?? [];
      arr.push(f);
      map.set(f.noteId, arr);
    }
    return map;
  }, [noteAttachments]);

  const [params] = useSearchParams();
  const focusKey = params.get("focus");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const focusToastedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusKey || loading) return;
    const idx = allEntries.findIndex((e) => `${e.kind}-${e.id}` === focusKey);
    if (idx === -1) {
      // Beyond the fetch cap or deleted — a visible fallback, not a silent
      // no-op. Only toast once per focus target.
      if (focusToastedRef.current !== focusKey) {
        focusToastedRef.current = focusKey;
        toast({
          title: t("deals.timeline.commentNotFound"),
          description: t("deals.timeline.mayBeDeleted"),
          variant: "destructive",
        });
      }
      return;
    }
    // Expand the window until the target is rendered, then scroll to it.
    if (idx >= visibleCount) {
      setVisibleCount(idx + 1);
      return;
    }
    const el = document.getElementById(`timeline-${focusKey}`);
    if (!el) return;
    setHighlightedKey(focusKey);
    const raf = requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    const timer = setTimeout(() => setHighlightedKey(null), 3000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [focusKey, loading, allEntries, visibleCount, toast]);

  return (
    <>
    <DealSectionCard
      title={t("deals.timeline.title")}
      action={
        <Segmented
          value={tab}
          onValueChange={(next) => setTab(next as typeof tab)}
          className="h-control p-0.5"
        >
          {TABS.map(({ key, label: labelKey }) => (
            <SegmentedItem
              key={key}
              value={key}
              label={t(labelKey)}
              className="h-7 text-caption"
            />
          ))}
        </Segmented>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-10 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Empty className="border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare className="h-4 w-4" />
            </EmptyMedia>
            <EmptyTitle>{t("deals.timeline.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {tab === "all"
                ? t("deals.timeline.emptyAll")
                : t("deals.timeline.emptyTab", { tab: t(TABS.find((x) => x.key === tab)?.label ?? "common.all").toLowerCase() })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map(([key, entries]) => (
            <div key={key}>
              <div className="sticky top-0 z-[1] -mx-1 mb-2.5 bg-card/95 px-1 py-0.5 text-caption font-medium text-muted-foreground backdrop-blur">
                {dayLabel(new Date(key))}
              </div>
              <div className="space-y-2.5">
                {entries.map((entry) => {
                  const k = `${entry.kind}-${entry.id}`;
                  return (
                    <div
                      key={k}
                      id={`timeline-${k}`}
                      className={cn(
                        "rounded-lg transition-shadow",
                        highlightedKey === k &&
                          "ring-2 ring-ring ring-offset-1",
                      )}
                    >
                      <TimelineRow
                        entry={entry}
                        dealId={dealId}
                        today={today}
                        source={activitySource}
                        controller={activityController}
                        onDeleteNote={() => deletePostedNote(entry)}
                        users={users}
                        canModify={
                          entry.kind === "note"
                            ? canModifyNote(entry.data as Note)
                            : true
                        }
                        attachments={
                          entry.kind === "note"
                            ? (attachmentsByNote.get(entry.id) ?? [])
                            : []
                        }
                        editing={editingKey === k}
                        saving={saving}
                        onStartEdit={() => setEditingKey(k)}
                        onCancelEdit={() => setEditingKey(null)}
                        onSaveEdit={(html) => saveEdit(entry, html)}
                        onPost={() => postDraft(entry)}
                        onDiscard={() => discardDraft(entry)}
                        mutating={pendingEntryKey === k}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="py-2 text-center text-[11px] text-subtle"
            >
              {t("deals.timeline.loadingEarlier")}
            </div>
          )}
          {!hasMore && notesCapped && (
            <div className="py-2 text-center text-[11px] text-subtle">
              {t("deals.timeline.notesCapped", { count: NOTES_FETCH_CAP })}
            </div>
          )}
        </div>
      )}
    </DealSectionCard>
    {activityDialogs}
    </>
  );
}
