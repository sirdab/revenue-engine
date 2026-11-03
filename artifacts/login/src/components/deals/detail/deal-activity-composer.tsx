import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCreateNote,
  useUpdateNote,
  usePostNote,
  useListUserOptions,
  getListActivitiesQueryKey,
  getListNotesQueryKey,
  getGetDealQueryKey,
  getListUserOptionsQueryKey,
} from "@workspace/api-client-react";
import type { ActivityType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  ActivityComposer,
  type ActivityComposerHandle,
} from "@/components/activities/shared/activity-composer";
import { useDealActivitySource } from "@/components/activities/shared/activity-source";
import {
  RichNoteEditor,
  type RichNoteEditorHandle,
} from "./rich-note-editor";
import {
  AttachmentTray,
  type ComposerAttachment,
} from "./attachment-tray";
import {
  uploadNoteFileXHR,
  deleteCrmFile,
  fileContentUrl,
  isImageMime,
  ACCEPTED_FILE_ACCEPT_ATTR,
} from "@/lib/files-api";
import {
  MessageSquare,
  CheckSquare,
  Users,
  Phone,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// The deal page's composer: a Note tab (deal comments, with attachments) and
// the Activity / Meeting / Call tabs, which are all ONE shared activity form
// — Meeting and Call only pick its type. Both panes stay mounted
// and the inactive one is hidden, so text typed in a comment and text typed
// in an activity never mix or get lost when switching tabs.

// Map an image MIME to a canonical extension so a pasted screenshot (whose
// synthesized name may lack/mismatch an extension) agrees with the server's
// magic-byte check, which derives the stored type from the extension.
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
function ensureUploadName(file: File): File {
  const ext = IMAGE_EXT[file.type];
  if (!ext) return file;
  const ok = new RegExp(`\\.${ext === "jpg" ? "jpe?g" : ext}$`, "i").test(
    file.name,
  );
  if (ok) return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "pasted-image";
  return new File([file], `${base}.${ext}`, { type: file.type });
}

type Mode = "note" | "activity";

// Two tabs: a note on the deal, or an activity. Meeting and Call used to be
// tabs of their own, but they are types inside Activity, so they repeated it.
const TABS: {
  key: string;
  label: MessageKey;
  icon: typeof MessageSquare;
  mode: Mode;
}[] = [
  { key: "note", label: "activity.type.note", icon: MessageSquare, mode: "note" },
  {
    key: "activity",
    label: "common.activity",
    icon: CheckSquare,
    mode: "activity",
  },
];

export function DealActivityComposer({
  dealId,
  onLogged,
}: {
  dealId: number;
  /** Called with every activity the form writes (a log, a plan, a retry),
   *  e.g. to flash its row. */
  onLogged?: (activityId: number) => void;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState("note");
  const mode: Mode = TABS.find((tab) => tab.key === active)?.mode ?? "note";
  const [noteEmpty, setNoteEmpty] = useState(true);

  const editor = useRef<RichNoteEditorHandle>(null);
  const activityForm = useRef<ActivityComposerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const postNote = usePostNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Bare key + search: Home widgets, the Activities page and the org/person
  // lists read these activities too, not just this deal.
  const activitySource = useDealActivitySource(() => {
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
  });
  const activityScope = useMemo(() => ({ deal: { dealId } }), [dealId]);

  // Attachment state (note tab only — comments-only seam). The first attachment
  // lazily creates a draft note to anchor the uploads (single-flighted below);
  // the draft is posted/kept on submit and cascades away if abandoned+discarded.
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [draftNoteId, setDraftNoteId] = useState<number | null>(null);
  const draftNoteIdRef = useRef<number | null>(null);
  const draftPromiseRef = useRef<Promise<number> | null>(null);
  const abortHandles = useRef(new Map<string, () => void>());
  const fileByKey = useRef(new Map<string, File>());
  // Keys whose chip was removed while uploading; if the upload had already
  // resolved (X clicked between the response and onload), its finished file is
  // deleted rather than kept on the draft.
  const cancelledKeys = useRef(new Set<string>());

  // Abort any still-in-flight uploads if the composer unmounts (e.g. navigating
  // away mid-upload), so an XHR doesn't outlive its UI.
  useEffect(() => {
    const handles = abortHandles.current;
    return () => handles.forEach((abort) => abort());
  }, []);

  // Abort any still-in-flight uploads if the composer unmounts (e.g. navigating
  // away mid-upload), so an XHR doesn't outlive its UI.
  useEffect(() => {
    const handles = abortHandles.current;
    return () => handles.forEach((abort) => abort());
  }, []);

  // Users for @mention autocomplete — small list, fetched once.
  const { data: users = [] } = useListUserOptions({
    query: { queryKey: getListUserOptionsQueryKey(), staleTime: 10 * 60_000 },
  });

  const uploading = attachments.some((a) => a.status === "uploading");
  // A live draft alone doesn't make the composer submittable — after removing
  // every attachment and clearing the text, an empty comment must not post.
  const hasAttachments = attachments.length > 0;
  const pending =
    createNote.isPending || updateNote.isPending || postNote.isPending;
  const submitDisabled = pending || uploading || (noteEmpty && !hasAttachments);

  const selectTab = (tab: (typeof TABS)[number]) => {
    setActive(tab.key);
    // Meeting / Call are shortcuts into the one activity form.
  };

  const reset = () => {
    editor.current?.clear();
    setAttachments([]);
    setDraftNoteId(null);
    draftNoteIdRef.current = null;
    draftPromiseRef.current = null;
    abortHandles.current.clear();
    fileByKey.current.clear();
    cancelledKeys.current.clear();
  };

  // Single-flighted: dropping N files at once awaits ONE shared draft note, not
  // N drafts. A duplicate draft would be recoverable, but the memoized promise
  // makes one-draft-per-composer a clean client invariant.
  const ensureDraft = (): Promise<number> => {
    if (draftNoteIdRef.current != null) {
      return Promise.resolve(draftNoteIdRef.current);
    }
    if (draftPromiseRef.current) return draftPromiseRef.current;
    const p = (async () => {
      const content = editor.current?.isEmpty()
        ? ""
        : (editor.current?.getHTML() ?? "");
      const note = await createNote.mutateAsync({
        data: { dealId, content, draft: true },
      });
      draftNoteIdRef.current = note.id;
      setDraftNoteId(note.id);
      return note.id;
    })();
    draftPromiseRef.current = p;
    p.catch(() => {
      // Let a later attachment retry create the draft.
      draftPromiseRef.current = null;
    });
    return p;
  };

  const patchAttachment = (key: string, patch: Partial<ComposerAttachment>) => {
    setAttachments((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );
  };

  const uploadOne = async (key: string, file: File, isImage: boolean) => {
    fileByKey.current.set(key, file);
    let noteId: number;
    try {
      noteId = await ensureDraft();
    } catch {
      patchAttachment(key, { status: "error", error: t("deals.composer.uploadStartFailed") });
      return;
    }
    const { promise, abort } = uploadNoteFileXHR({
      dealId,
      noteId,
      file,
      category: "other",
      onProgress: (pct) => patchAttachment(key, { progress: pct }),
    });
    abortHandles.current.set(key, abort);
    try {
      const crmFile = await promise;
      abortHandles.current.delete(key);
      fileByKey.current.delete(key);
      // Removed while this upload was resolving (X clicked between the response
      // and this handler): abort() no-ops on a finished XHR, so delete the file
      // that would otherwise survive on the draft and post with the comment.
      if (cancelledKeys.current.has(key)) {
        cancelledKeys.current.delete(key);
        void deleteCrmFile(crmFile.id).catch(() => {});
        return;
      }
      if (isImage) {
        // Images land inline in the body; the tray chip is removed.
        editor.current?.insertImage(fileContentUrl(crmFile.id), file.name);
        setAttachments((prev) => prev.filter((a) => a.key !== key));
      } else {
        patchAttachment(key, {
          status: "done",
          progress: 100,
          fileId: crmFile.id,
        });
      }
    } catch (err) {
      abortHandles.current.delete(key);
      if (err instanceof DOMException && err.name === "AbortError") return;
      patchAttachment(key, {
        status: "error",
        error: err instanceof Error ? err.message : t("deals.composer.uploadFailedDot"),
      });
    }
  };

  const handleFiles = (files: File[]) => {
    for (const raw of files) {
      const file = ensureUploadName(raw);
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const isImage = isImageMime(file.type);
      setAttachments((prev) => [
        ...prev,
        {
          key,
          name: file.name,
          size: file.size,
          isImage,
          status: "uploading",
          progress: 0,
        },
      ]);
      void uploadOne(key, file, isImage);
    }
  };

  const removeAttachment = async (item: ComposerAttachment) => {
    if (item.status === "uploading") {
      // Mark cancelled BEFORE aborting so uploadOne's success handler (if the
      // response already arrived) deletes the finished file instead of keeping
      // it. abort() no-ops on an already-resolved XHR.
      cancelledKeys.current.add(item.key);
      abortHandles.current.get(item.key)?.();
      abortHandles.current.delete(item.key);
    }
    fileByKey.current.delete(item.key);
    setAttachments((prev) => prev.filter((a) => a.key !== item.key));
    if (item.fileId != null) {
      try {
        await deleteCrmFile(item.fileId);
      } catch {
        // Best-effort — the draft delete/discard cascade cleans up otherwise.
      }
    }
  };

  const retryAttachment = (item: ComposerAttachment) => {
    const file = fileByKey.current.get(item.key);
    if (!file) return;
    patchAttachment(item.key, { status: "uploading", progress: 0, error: undefined });
    void uploadOne(item.key, file, item.isImage);
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(Array.from(e.target.files));
    e.target.value = ""; // allow re-selecting the same file
  };

  // Save draft persists without publishing (creator-only until posted);
  // Post is today's publish behavior and stays the ⌘↵ fast path.
  const handleSubmit = async (draft: boolean) => {
    // The buttons are gated by submitDisabled, but the editor's ⌘↵ path
    // is not — guard here so an in-flight save can't be double-submitted.
    if (pending) return;
    const content = editor.current?.isEmpty()
      ? ""
      : (editor.current?.getHTML() ?? "");
    try {
      const draftId = draftNoteIdRef.current;
      if (draftId != null) {
        // Don't publish an empty comment: a draft with no text (no inline
        // images) AND no finished attachment left is nothing to post. The
        // ⌘↵ path reaches here past submitDisabled, so guard it. The draft
        // stays recoverable in the timeline.
        const hasDoneAttachment = attachments.some(
          (a) => a.status === "done",
        );
        if (!content && !hasDoneAttachment) return;
        // Attachments were added → the note already exists as a draft. Save
        // the latest content (incl. inline images), then post or keep draft.
        await updateNote.mutateAsync({ id: draftId, data: { content } });
        if (!draft) await postNote.mutateAsync({ id: draftId });
        queryClient.invalidateQueries({
          queryKey: getListNotesQueryKey({ dealId }),
        });
        // Refresh the timeline's posted-comment attachment chips.
        queryClient.invalidateQueries({ queryKey: ["crm-files"] });
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
        toast({ title: draft ? t("activity.add.draftSaved") : t("deals.composer.notePosted") });
        reset();
        return;
      }
      if (!content) return;
      await createNote.mutateAsync({
        data: { dealId, content, draft: draft || undefined },
      });
      queryClient.invalidateQueries({
        queryKey: getListNotesQueryKey({ dealId }),
      });
      toast({ title: draft ? t("activity.add.draftSaved") : t("deals.composer.notePosted") });
      queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      reset();
    } catch {
      toast({ title: t("common.saveFailed"), variant: "destructive" });
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectTab(tab)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-label transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-gray-alpha-50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(tab.label)}
            </button>
          );
        })}
      </div>

      <div className={cn(mode !== "activity" && "hidden")}>
        <ActivityComposer
          bare
          ref={activityForm}
          source={activitySource}
          scope={activityScope}
          onWritten={(v) => onLogged?.(v.id)}
        />
      </div>

      <div className={cn("space-y-4 p-4", mode !== "note" && "hidden")}>
        <RichNoteEditor
          ref={editor}
          users={users}
          onSubmit={() => handleSubmit(false)}
          onEmptyChange={setNoteEmpty}
          placeholder={t("deals.composer.notePlaceholder")}
          onFiles={handleFiles}
        />
        <AttachmentTray
          items={attachments}
          onRemove={removeAttachment}
          onRetry={retryAttachment}
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_FILE_ACCEPT_ATTR}
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            title={t("deals.composer.attachFiles")}
            onClick={() => fileInput.current?.click()}
            className="me-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-body text-muted-foreground transition-colors hover:bg-gray-alpha-100 hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
            {t("deals.composer.attach")}
          </button>
          <span className="text-[11px] text-subtle">
            {t("deals.composer.hint")}
          </span>
          <Button
            variant="outline"
            onClick={() => handleSubmit(true)}
            disabled={submitDisabled}
          >
            {t("activity.add.saveDraft")}
          </Button>
          <Button
            onClick={() => handleSubmit(false)}
            disabled={submitDisabled}
            className="bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {pending ? t("common.saving") : t("activity.drafts.post")}
          </Button>
        </div>
      </div>
    </div>
  );
}
