import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SmilePlus } from "lucide-react";
import {
  useAddNoteReaction,
  useRemoveNoteReaction,
  getListNotesQueryKey,
  type NoteReactionSummary,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { EmojiPicker, REACTION_EMOJIS } from "@/components/ui/emoji-picker";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// Reaction pills + an add-reaction picker under a posted comment (R9). Toggling
// is optimistic (instant pill update) and idempotent on the server; the notes
// list is invalidated on settle so counts reconcile. Reactions are self-service
// — anyone adds/removes their own — so this shows for every viewer, unlike the
// author/admin-gated edit/delete controls.
function applyToggle(
  list: NoteReactionSummary[],
  emoji: string,
  add: boolean,
  myName: string,
): NoteReactionSummary[] {
  const idx = list.findIndex((r) => r.emoji === emoji);
  if (idx === -1) {
    return add
      ? [...list, { emoji, count: 1, reactedByMe: true, reactorNames: [myName] }]
      : list;
  }
  const r = list[idx];
  const count = r.count + (add ? 1 : -1);
  if (count <= 0) return list.filter((_, i) => i !== idx);
  const reactorNames = add
    ? [...r.reactorNames, myName]
    : r.reactorNames.filter((n) => n !== myName);
  const next = { ...r, count, reactedByMe: add, reactorNames };
  return list.map((x, i) => (i === idx ? next : x));
}

export function ReactionBar({
  dealId,
  noteId,
  reactions,
}: {
  dealId: number;
  noteId: number;
  reactions: NoteReactionSummary[];
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const myName = user?.name ?? t("deals.reactions.you");
  const queryClient = useQueryClient();
  const addReaction = useAddNoteReaction();
  const removeReaction = useRemoveNoteReaction();

  // Optimistic copy, re-seeded whenever the server list changes. A ref mirror
  // is updated SYNCHRONOUSLY in toggle so a same-tick double-click reads the
  // just-applied state (not the stale render closure) and correctly flips back
  // instead of double-counting.
  const [local, setLocal] = useState<NoteReactionSummary[]>(reactions);
  const localRef = useRef<NoteReactionSummary[]>(reactions);
  useEffect(() => {
    setLocal(reactions);
    localRef.current = reactions;
  }, [reactions]);

  const toggle = (emoji: string) => {
    const current = localRef.current;
    const mine = current.find((r) => r.emoji === emoji)?.reactedByMe ?? false;
    const next = applyToggle(current, emoji, !mine, myName);
    localRef.current = next;
    setLocal(next);
    const mutation = mine ? removeReaction : addReaction;
    mutation.mutate(
      { id: noteId, emoji },
      {
        onSettled: () =>
          queryClient.invalidateQueries({
            queryKey: getListNotesQueryKey({ dealId }),
          }),
      },
    );
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {local.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji)}
          title={r.reactorNames.join(", ")}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
            r.reactedByMe
              ? "border-teal-300 bg-teal-50 text-teal-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          <span className="leading-none">{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
      <EmojiPicker
        emojis={REACTION_EMOJIS}
        // Inline (non-portalled) so the picker works inside the deal drawer's
        // scroll-locked Sheet (the recurring picker-in-modal bug).
        disablePortal
        onSelect={toggle}
      >
        <button
          type="button"
          title={t("deals.reactions.add")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
      </EmojiPicker>
    </div>
  );
}
