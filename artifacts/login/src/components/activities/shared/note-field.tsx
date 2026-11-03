import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  getListUserOptionsQueryKey,
  useListUserOptions,
} from "@workspace/api-client-react";
import {
  RichNoteEditor,
  type RichNoteEditorHandle,
} from "@/components/deals/detail/rich-note-editor";
import { RichText } from "@/components/deals/detail/rich-text";

// An activity note in the rich editor (mentions, formatting), behind a small
// handle so a dialog can read, check and clear it without knowing the
// editor's API.

export interface NoteFieldHandle {
  /** The editor's HTML. "" when empty. */
  read: () => string;
  isEmpty: () => boolean;
  /** Changed since mount. The rich editor normalises legacy markup on load,
   *  so "unchanged" is how a save avoids rewriting a note nobody touched. */
  isDirty: () => boolean;
  focus: () => void;
  /** Empty it, after the note it held has been written. */
  clear: () => void;
}

export const NoteField = forwardRef<
  NoteFieldHandle,
  {
    id?: string;
    initial?: string | null;
    placeholder?: string;
    invalid?: boolean;
    rows?: number;
    autoFocus?: boolean;
    className?: string;
    /** ⌘↵ (Ctrl+↵). */
    onSubmit?: () => void;
    onChange?: () => void;
  }
>(function NoteField({ initial, placeholder, autoFocus, className, onSubmit, onChange }, ref) {
  const richRef = useRef<RichNoteEditorHandle>(null);
  const { data: users = [] } = useListUserOptions({
    query: {
      queryKey: getListUserOptionsQueryKey(),
      staleTime: 10 * 60_000,
    },
  });

  // Focus the field itself on mount. The dialog around it must not place
  // focus first (see `keepFocusForField` in activity-complete-dialog.tsx):
  // a dialog focuses its first focusable element, which in the rich editor
  // is a toolbar button, and the first keystrokes went there.
  useEffect(() => {
    if (autoFocus) richRef.current?.focus();
  }, [autoFocus]);

  useImperativeHandle(
    ref,
    () => ({
      read: () => (richRef.current?.isEmpty() ? "" : (richRef.current?.getHTML() ?? "")),
      isEmpty: () => richRef.current?.isEmpty() ?? true,
      isDirty: () => richRef.current?.isDirty() ?? false,
      focus: () => richRef.current?.focus(),
      clear: () => richRef.current?.clear(),
    }),
    [],
  );

  return (
    // No red outline here: the editor draws its own border (and focus
    // ring) inside its toolbar, so a wrapper outline read as two boxes.
    // The caller's message under the field says what is missing.
    <div className={className}>
      <RichNoteEditor
        ref={richRef}
        users={users}
        initialHTML={initial ?? ""}
        placeholder={placeholder ?? ""}
        onSubmit={() => onSubmit?.()}
        onEmptyChange={() => onChange?.()}
      />
    </div>
  );
});

/** An existing note, read-only. */
export function NoteView({ note }: { note: string }) {
  return <RichText html={note} className="text-sm text-muted-foreground" />;
}
