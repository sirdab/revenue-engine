// Ask your pipeline: a question is typed and sent, the assistant names the
// lookup it is running, the answer is written out, and the deals it was drawn
// from fill the panel beside it. Then the next question.
//
// As in the app: answers stream in, the line above them shows the tool in use
// ("Deal list", "Pipeline summary"), and "Behind this answer" lists the
// related deals as value · stage · owner.

import { type Scene, $, $$, enter, leave, settle, type, typed, words } from "./kit";

interface Turn {
  ask: string;
  tools: string[];
  answer: string;
  sources: string;
  deals: { t: string; s: string }[];
}

interface Copy {
  turns: Turn[];
  thinking: string;
}

export const askAi: Scene = {
  // The chat before anything has been asked.
  setup({ root }) {
    for (const name of ["ask", "reply", "related"]) {
      const el = $<HTMLElement>(`[data-${name}]`, root);
      if (el) el.hidden = true;
    }
    for (const name of ["hello", "none"]) {
      const el = $<HTMLElement>(`[data-${name}]`, root);
      if (el) el.hidden = false;
    }
    $("[data-deals]", root)?.replaceChildren();
  },

  async play(run, { root, data }) {
    const copy = data as Copy;
    const part = (name: string) => $<HTMLElement>(`[data-${name}]`, root);
    const hello = part("hello");
    const ask = part("ask");
    const reply = part("reply");
    const think = part("think");
    const answer = part("answer");
    const sources = part("sources");
    const composer = part("composer");
    const send = part("send");
    const none = part("none");
    const related = part("related");
    const list = part("deals");
    if (!ask || !reply || !think || !answer || !sources || !composer || !send || !list) return;

    await run.wait(900);
    for (let i = 0; ; i = (i + 1) % copy.turns.length) {
      const turn = copy.turns[i];

      // The question is typed, and sent.
      composer.classList.remove("is-empty");
      composer.textContent = "";
      send.classList.add("is-ready");
      await type(run, composer, turn.ask, 36);
      await run.wait(380);
      send.classList.add("is-down");
      await run.wait(130);
      send.classList.remove("is-down", "is-ready");
      typed(composer);
      composer.textContent = composer.dataset.placeholder ?? "";
      composer.classList.add("is-empty");

      // It takes its place in the thread, and the assistant goes to look.
      if (hello) hello.hidden = true;
      ask.textContent = turn.ask;
      settle(ask);
      settle(reply);
      ask.hidden = false;
      enter(ask, { translate: "0 1em" }, 380);
      answer.textContent = "";
      sources.hidden = true;
      think.textContent = copy.thinking;
      think.hidden = false;
      reply.hidden = false;
      enter(reply, { translate: "0 0.6em" });
      await run.wait(850);
      for (const tool of turn.tools) {
        think.textContent = tool;
        await run.wait(820);
      }

      // The answer is written out, with what it was drawn from beside it.
      think.hidden = true;
      await words(run, answer, turn.answer);
      const label = $("span", sources);
      if (label) label.textContent = turn.sources;
      sources.hidden = false;
      enter(sources, { translate: "0 0.3em" }, 320);
      if (none) none.hidden = true;
      if (related) related.hidden = false;
      list.replaceChildren(
        ...turn.deals.map((deal) => {
          const row = document.createElement("div");
          row.className = "v-behind__deal";
          for (const [className, text] of [
            ["g-t", deal.t],
            ["g-s", deal.s],
          ]) {
            const line = document.createElement("span");
            line.className = className;
            line.textContent = text;
            row.append(line);
          }
          return row;
        }),
      );
      $$(".v-behind__deal", list).forEach((row, n) =>
        row.animate(
          [
            { opacity: 0, translate: "0 0.6em" },
            { opacity: 1, translate: "0 0" },
          ],
          { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", delay: n * 120, fill: "backwards" },
        ),
      );
      await run.wait(4200);

      // The thread clears for the next question.
      await Promise.all([leave(run, ask), leave(run, reply)]);
      ask.hidden = true;
      reply.hidden = true;
      await run.wait(250);
    }
  },
};
