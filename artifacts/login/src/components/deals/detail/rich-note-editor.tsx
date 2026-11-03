import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import type { UserOption } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

// Styling for an @mention chip. Kept as a literal so Tailwind sees the classes,
// and shared with the read-side renderer (rich-text.tsx) so chips look the same
// in the composer and the timeline.
export const MENTION_CLASS =
  "rounded bg-teal-50 px-1 font-medium text-teal-700";

export type RichNoteEditorHandle = {
  getHTML: () => string;
  isEmpty: () => boolean;
  // True once the serialized HTML differs from the content loaded on mount.
  // Used so editing a legacy note and saving without changes fires no history
  // event (TipTap normalizes legacy <div>/<br> markup on load, which would
  // otherwise look like an edit — see the U1 characterization tests).
  isDirty: () => boolean;
  clear: () => void;
  focus: () => void;
  // Insert an inline image node at the cursor (consumed by the composer's
  // attachment flow — U4). `src` must be a same-origin /api/files/<id>/content
  // path; the render-side allowlist (rich-text.tsx) enforces that on display.
  insertImage: (src: string, alt?: string) => void;
};

// The stored HTML contract is FROZEN: mention chips serialize as
// <span data-mention="<userId>" contenteditable="false">@Name</span>, exactly
// what mentions.ts MENTION_RE (/data-mention="(\d+)"/) parses. TipTap's default
// Mention stores data-id/data-label instead, so we override attribute IO to
// read/write data-mention and keep the display name in the element's text.
const MentionChip = Mention.extend({
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-mention"),
        // data-mention is emitted by renderHTML below, not as an auto attr.
        renderHTML: () => ({}),
      },
      label: {
        default: null,
        // Both our chips and legacy chips carry the name as text ("@Name").
        parseHTML: (el) => (el.textContent || "").replace(/^@/, "") || null,
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-mention": node.attrs.id,
        contenteditable: "false",
        class: MENTION_CLASS,
      },
      `@${node.attrs.label ?? ""}`,
    ];
  },
  renderText({ node }) {
    return `@${node.attrs.label ?? ""}`;
  },
});

type MentionItem = { id: string; label: string };
type MentionMenu = {
  items: MentionItem[];
  index: number;
  command: (item: MentionItem) => void;
  top: number;
  left: number;
};

export const RichNoteEditor = forwardRef<
  RichNoteEditorHandle,
  {
    users: UserOption[];
    placeholder: string;
    onSubmit: () => void;
    onEmptyChange?: (empty: boolean) => void;
    // Pre-populate the editor with existing HTML (used when editing an existing
    // note or an activity's note). Seeded once on mount.
    initialHTML?: string;
    // When provided, pasted/dropped files are forwarded here instead of being
    // handled by TipTap. Enables the attachment seam on the composer note tab
    // only (comments-only seam — U4). Absent on activity/mark-done editors.
    onFiles?: (files: File[]) => void;
  }
>(function RichNoteEditor(
  { users, placeholder, onSubmit, onEmptyChange, initialHTML, onFiles },
  ref,
) {
  // Refs so the once-created editor never closes over stale callbacks/props.
  const { t } = useI18n();
  const usersRef = useRef(users);
  usersRef.current = users;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;
  // Read live so a host can change it after creation (the deal composer's
  // note / activity / "what did they say?" prompt share one editor).
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

  const [empty, setEmpty] = useState(!initialHTML);
  const [mention, setMention] = useState<MentionMenu | null>(null);
  const mentionRef = useRef<MentionMenu | null>(null);
  mentionRef.current = mention;
  const mentionList = useRef<HTMLUListElement>(null);
  // Normalized HTML captured once the editor has parsed initialHTML — the
  // baseline isDirty() compares against.
  const baselineRef = useRef<string | null>(null);

  const forwardFiles = (files: FileList | null | undefined): boolean => {
    const handler = onFilesRef.current;
    if (!handler || !files || files.length === 0) return false;
    handler(Array.from(files));
    return true;
  };

  // Declared before useEditor: onCreate can fire synchronously during the hook.
  const syncEmpty = (ed: Editor) => {
    const e = ed.isEmpty;
    setEmpty(e);
    onEmptyChangeRef.current?.(e);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Keep the stored HTML inside the render allowlist (rich-text.tsx):
        // headings/blockquote/hr have no renderer support, so disable them
        // rather than store markup that degrades to bare text on display.
        heading: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      Image.configure({ inline: false, HTMLAttributes: { loading: "lazy" } }),
      MentionChip.configure({
        suggestion: {
          char: "@",
          items: ({ query }) =>
            usersRef.current
              .filter((u) =>
                u.name.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 50)
              .map((u) => ({ id: String(u.id), label: u.name })),
          render: () => {
            const update = (props: {
              items: MentionItem[];
              command: (item: MentionItem) => void;
              clientRect?: (() => DOMRect | null) | null;
            }) => {
              const rect = props.clientRect?.();
              setMention({
                items: props.items,
                index: 0,
                command: props.command,
                top: rect ? rect.bottom + 4 : 0,
                left: rect ? rect.left : 0,
              });
            };
            return {
              onStart: update,
              onUpdate: update,
              onKeyDown: (props: { event: KeyboardEvent }) => {
                const m = mentionRef.current;
                if (!m || m.items.length === 0) return false;
                const { key } = props.event;
                if (key === "ArrowDown") {
                  setMention({ ...m, index: (m.index + 1) % m.items.length });
                  return true;
                }
                if (key === "ArrowUp") {
                  setMention({
                    ...m,
                    index: (m.index - 1 + m.items.length) % m.items.length,
                  });
                  return true;
                }
                if (key === "Enter" || key === "Tab") {
                  const item = m.items[m.index];
                  if (item) m.command(item);
                  return true;
                }
                if (key === "Escape") {
                  setMention(null);
                  return true;
                }
                return false;
              },
              onExit: () => setMention(null),
            };
          },
        },
      }),
    ],
    content: initialHTML ?? "",
    editorProps: {
      attributes: {
        // dir="auto" lets the browser detect RTL (Arabic) per paragraph.
        dir: "auto",
        role: "textbox",
        "aria-multiline": "true",
        class: cn(
          "max-h-[60vh] min-h-[110px] w-full overflow-y-auto rounded-md border border-slate-200 bg-card px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500",
          "[&_a]:text-teal-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5",
        ),
      },
      handlePaste: (_view, event) =>
        forwardFiles(event.clipboardData?.files),
      handleDrop: (_view, event) =>
        forwardFiles((event as DragEvent).dataTransfer?.files),
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl+Enter submits — but only when the mention menu isn't
        // capturing the keystroke (the suggestion plugin runs first).
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor }) => {
      baselineRef.current = editor.getHTML();
      syncEmpty(editor);
    },
    onUpdate: ({ editor }) => syncEmpty(editor),
  });

  // The placeholder decoration only recomputes on a transaction, so nudge one
  // when the prop changes.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  // Keep the highlighted mention option scrolled into view.
  useEffect(() => {
    if (!mention) return;
    const el = mentionList.current?.children[mention.index] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [mention]);

  useImperativeHandle(
    ref,
    () => ({
      getHTML: () => editor?.getHTML() ?? "",
      isEmpty: () => editor?.isEmpty ?? true,
      isDirty: () =>
        editor ? editor.getHTML() !== (baselineRef.current ?? "") : false,
      clear: () => {
        editor?.commands.clearContent(true);
        baselineRef.current = editor?.getHTML() ?? "";
        setMention(null);
      },
      focus: () => editor?.commands.focus(),
      insertImage: (src, alt) => {
        editor?.chain().focus().setImage({ src, alt: alt ?? "" }).run();
      },
    }),
    [editor],
  );

  const chain = () => editor?.chain().focus();

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-0.5">
        <ToolbarButton
          onClick={() => chain()?.toggleBold().run()}
          active={editor?.isActive("bold")}
          title={t("editor.bold")}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => chain()?.toggleItalic().run()}
          active={editor?.isActive("italic")}
          title={t("editor.italic")}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => chain()?.toggleUnderline().run()}
          active={editor?.isActive("underline")}
          title={t("editor.underline")}
        >
          <Underline className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => chain()?.toggleStrike().run()}
          active={editor?.isActive("strike")}
          title={t("editor.strikethrough")}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <ToolbarButton
          onClick={() => chain()?.toggleBulletList().run()}
          active={editor?.isActive("bulletList")}
          title={t("editor.bulletList")}
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => chain()?.toggleOrderedList().run()}
          active={editor?.isActive("orderedList")}
          title={t("editor.numberedList")}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => chain()?.toggleCodeBlock().run()}
          active={editor?.isActive("codeBlock")}
          title={t("editor.codeBlock")}
        >
          <Code2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <EmojiPicker
          // Inline so the picker works inside the deal drawer (Sheet) and the
          // add-activity Dialog — both scroll-lock a portalled popover.
          disablePortal
          onSelect={(emoji) => chain()?.insertContent(emoji).run()}
        />
      </div>

      <EditorContent editor={editor} />

      {mention &&
        mention.items.length > 0 &&
        createPortal(
          // Portalled to <body> with viewport-relative `fixed` coords: a `fixed`
          // descendant of a transformed ancestor (DialogContent's translate)
          // paints relative to that ancestor, which broke the menu inside modal
          // note editors — so the menu lives on <body>. (Radix popovers use the
          // separate disablePortal path instead; different mechanism.)
          <ul
            ref={mentionList}
            className="fixed z-50 max-h-64 w-60 overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-card py-1 shadow-lg"
            style={{ top: mention.top, left: mention.left }}
          >
            {mention.items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  // Keep the editor selection alive through the click.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    mention.command(item);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm",
                    i === mention.index
                      ? "bg-teal-50 text-teal-800"
                      : "text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}

      {/* Placeholder is handled by the TipTap Placeholder extension + the
          .is-editor-empty CSS in index.css; `empty` still drives consumers. */}
      <span className="sr-only" aria-hidden>
        {empty ? "empty" : ""}
      </span>
    </div>
  );
});

function ToolbarButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      // preventDefault keeps the caret/selection in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-slate-100 hover:text-slate-700",
        active ? "bg-slate-100 text-teal-700" : "text-slate-500",
      )}
    >
      {children}
    </button>
  );
}
