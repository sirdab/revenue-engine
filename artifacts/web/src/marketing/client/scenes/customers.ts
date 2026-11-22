// Know every customer: a call lands on the timeline, the timeline's tabs
// filter it, and search finds the contact by a phone number, then a file by a
// word in its name.
//
// As in the app: the timeline's tabs are All, Activities, Notes and History;
// search starts answering at the third character, matches a phone number on
// its digits however it was typed, and marks the text it matched.

import type { Run } from "../core";
import { type Scene, type Stage, $, $$, enter, flip, type, typed } from "./kit";

/** What is typed into search: a phone number, then a word from a file name. */
interface Copy {
  person: string;
  file: string;
}

/** Search answers from this many characters on. */
const MIN = 3;

/** Shows the events a tab keeps, and slides the rest of the list closed. */
function setTab(root: HTMLElement, kind: string): void {
  for (const tab of $$<HTMLElement>("[data-tab]", root)) tab.classList.toggle("is-on", tab.dataset.tab === kind);
  const events = $$<HTMLElement>(".v-event:not([data-pending])", root);
  flip(events, () => {
    for (const event of events) event.hidden = kind !== "all" && event.dataset.kind !== kind;
  });
}

/** Types a query, and shows its result once enough of it is there. */
async function search(run: Run, root: HTMLElement, text: string, which: string): Promise<void> {
  const input = $<HTMLElement>("[data-q]", root);
  const result = $<HTMLElement>(`[data-res="${which}"]`, root);
  if (!input || !result) return;
  for (const other of $$<HTMLElement>("[data-res]", root)) other.hidden = true;
  input.classList.remove("is-empty");
  input.textContent = "";
  input.classList.add("is-typing");
  let found = false;
  for (let i = 1; i <= text.length; i++) {
    input.textContent = text.slice(0, i);
    if (!found && text.slice(0, i).replace(/\s/g, "").length >= MIN) {
      found = true;
      result.hidden = false;
      enter(result, { translate: "0 0.4em" }, 300);
    }
    await run.wait(55 + Math.random() * 75);
  }
  typed(input);
}

export const customers: Scene = {
  // The call has not been logged yet, and nothing has been searched for.
  setup({ root }) {
    const call = $<HTMLElement>('.v-event[data-kind="call"]', root);
    if (call) {
      call.hidden = true;
      call.dataset.pending = "";
    }
    const input = $<HTMLElement>("[data-q]", root);
    if (input) {
      input.textContent = input.dataset.placeholder ?? "";
      input.classList.add("is-empty");
    }
    for (const result of $$<HTMLElement>("[data-res]", root)) result.hidden = true;
  },

  async play(run, { root, cursor, data }: Stage) {
    const copy = data as Copy;
    const call = $<HTMLElement>('.v-event[data-kind="call"]', root);
    const tab = (kind: string) => $<HTMLElement>(`[data-tab="${kind}"]`, root);

    // A call is logged: it takes its place at the top of the timeline.
    await run.wait(900);
    if (call) {
      flip($$(".v-event", root), () => {
        call.hidden = false;
        delete call.dataset.pending;
      });
    }
    await run.wait(1700);

    // The tabs keep one kind of entry each.
    cursor.show();
    await cursor.click(run, tab("note"), () => setTab(root, "note"));
    await run.wait(1500);
    await cursor.click(run, tab("history"), () => setTab(root, "history"));
    await run.wait(1500);
    await cursor.click(run, tab("all"), () => setTab(root, "all"));
    await run.wait(700);

    // A phone number, typed without its country code or punctuation.
    const input = $<HTMLElement>("[data-q]", root);
    await cursor.click(run, input, () => undefined, 0.3, 0.5);
    await search(run, root, copy.person, "person");
    await run.wait(2600);
    await search(run, root, copy.file, "file");
    await run.wait(700);
    cursor.hide();
    await run.wait(1900);
  },

  click(target, { root }) {
    const tab = target.closest<HTMLElement>("[data-tab]");
    if (!tab) return false;
    // Whatever was on its way in is here now.
    for (const event of $$<HTMLElement>("[data-pending]", root)) {
      event.hidden = false;
      delete event.dataset.pending;
    }
    setTab(root, tab.dataset.tab ?? "all");
    return true;
  },
};
