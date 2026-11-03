import { useState, type ReactNode } from "react";
import { Smile } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useI18n } from "@/lib/i18n/i18n";
// Curated native-unicode emoji picker. Deliberately NOT emoji-mart (~1MB) — a
// small inline grid covers both the editor's emoji button (R6) and the
// reaction set (R9) at zero bundle cost. Selecting inserts the raw character.
//
// The reaction subset is kept in sync with the server-side curated set in
// api-server/src/lib/note-reactions.ts — the API rejects any emoji outside it,
// so the two lists must not drift.
export const REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😄",
  "🎉",
  "🙏",
  "👀",
  "🔥",
  "✅",
] as const;

// Broader set offered by the editor's emoji button, grouped loosely so the grid
// reads sensibly. Flattened for insertion.
const EDITOR_EMOJIS: string[] = [
  // reactions first so the common ones are up top
  ...REACTION_EMOJIS,
  "😀", "😂", "😅", "😊", "😍", "😎", "🤔", "😢",
  "😮", "😴", "🤝", "👏", "🙌", "💪", "🫡", "🤯",
  "💯", "⭐", "⚡", "🚀", "📈", "📉", "💰", "🧾",
  "📦", "🏬", "🗓️", "⏰", "❗", "❓", "✔️", "❌",
];

export function EmojiPicker({
  onSelect,
  disablePortal = false,
  emojis = EDITOR_EMOJIS,
  align = "start",
  children,
}: {
  onSelect: (emoji: string) => void;
  /** Pass inside a Radix Dialog/Sheet so the grid isn't scroll-locked. */
  disablePortal?: boolean;
  emojis?: readonly string[];
  align?: "start" | "center" | "end";
  /** Custom trigger. Defaults to a smile icon button. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <button
            type="button"
            title={t("common.emoji")}
            // preventDefault keeps the editor selection alive through the click.
            onMouseDown={(e) => e.preventDefault()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-gray-alpha-100 hover:text-foreground"
          >
            <Smile className="h-3.5 w-3.5" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        disablePortal={disablePortal}
        // Keep focus in the editor: block the default focus-steal on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-auto max-w-[16rem] p-2"
      >
        <div className="grid grid-cols-8 gap-0.5">
          {emojis.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded text-lg",
                "hover:bg-gray-alpha-100",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
