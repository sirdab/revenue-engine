// The terminal: the commands that start the app locally are typed one after
// another, with what the last of them prints.

import { type Scene, $, $$, typed } from "./kit";

export const terminal: Scene = {
  // An empty terminal.
  setup({ root }) {
    for (const line of $$<HTMLElement>("[data-line]", root)) line.hidden = true;
  },

  async play(run, { root }) {
    await run.wait(700);
    let printed = false;
    for (const line of $$<HTMLElement>("[data-line]", root)) {
      const kind = line.dataset.line;
      if (kind === "cmd") {
        const text = $<HTMLElement>("[data-text]", line);
        if (!text) continue;
        const command = text.textContent ?? "";
        text.textContent = "";
        line.hidden = false;
        text.classList.add("is-typing");
        await run.wait(420);
        for (let i = 1; i <= command.length; i++) {
          text.textContent = command.slice(0, i);
          await run.wait(12 + Math.random() * 30);
        }
        await run.wait(360);
        typed(text);
        printed = false;
      } else {
        // The first line a command prints takes a moment; the rest follow at once.
        await run.wait(kind === "out" && !printed ? 1100 : kind === "out" ? 140 : 320);
        printed = kind === "out";
        line.hidden = false;
        line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      }
    }
  },

  rest: 6000,
};
