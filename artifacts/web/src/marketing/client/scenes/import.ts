// Bring your data with you: a CSV is dropped in, recognised as a Pipedrive
// export, its columns map themselves one by one, and the import runs.
//
// As in the app: the import's steps are Type, Upload, Map & defaults, Review
// and Done; a Pipedrive export gets a notice that its columns were matched; the
// button reads "Importing…" while it runs, and the last step says how many
// records were imported.

import { type Scene, $, $$, enter, leave, pop } from "./kit";

/** The button's three labels: on to the review, start the import, importing. */
interface Copy {
  review: string;
  go: string;
  busy: string;
}

/** Marks the steps before `at` as done and `at` as the one being taken. */
function step(root: HTMLElement, at: number): void {
  $$("[data-steps] li", root).forEach((item, i) => {
    item.classList.toggle("is-done", i < at);
    item.classList.toggle("is-on", i === at);
  });
}

function pane(root: HTMLElement, name: string): HTMLElement | null {
  let shown: HTMLElement | null = null;
  for (const el of $$<HTMLElement>("[data-pane]", root)) {
    el.hidden = el.dataset.pane !== name;
    if (!el.hidden) shown = el;
  }
  return shown;
}

export const importing: Scene = {
  // The second step: nothing uploaded yet.
  setup({ root }) {
    step(root, 1);
    pane(root, "upload");
    for (const name of ["file", "go"]) {
      const el = $<HTMLElement>(`[data-${name}]`, root);
      if (el) el.style.visibility = "hidden";
    }
  },

  async play(run, { root, cursor, data }) {
    const copy = data as Copy;
    const file = $<HTMLElement>("[data-file]", root);
    const drop = $<HTMLElement>(".v-drop", root);
    const go = $<HTMLElement>("[data-go]", root);
    const label = $<HTMLElement>("[data-go-label]", root);
    const ready = $<HTMLElement>("[data-ready]", root);
    if (!file || !go || !label) return;

    // A file is dropped on the page.
    await run.wait(900);
    drop?.classList.add("is-over");
    await run.wait(650);
    file.style.visibility = "";
    pop(file, 0.8);
    await run.wait(450);

    // Its columns are recognised and matched, one after another.
    step(root, 2);
    const map = pane(root, "map");
    if (map) enter(map, { translate: "0 0.5em" }, 320);
    const note = $("[data-note]", root);
    if (note) enter(note, { translate: "0 -0.4em", scale: 0.98 }, 420);
    const rows = $$(".v-map__row", root);
    rows.forEach((row, i) => {
      const delay = 380 + i * 210;
      row.animate(
        [
          { opacity: 0, translate: "0 0.5em" },
          { opacity: 1, translate: "0 0" },
        ],
        { duration: 360, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", delay, fill: "backwards" },
      );
      // Its tick lands a beat after the row does.
      $(".v-map__ok", row)?.animate([{ scale: 0 }, { scale: 1 }], {
        duration: 420,
        easing: "cubic-bezier(0.25, 1.35, 0.4, 1)",
        delay: delay + 200,
        fill: "backwards",
      });
    });
    await run.wait(380 + rows.length * 210 + 500);
    go.style.visibility = "";
    enter(go, { translate: "0 0.4em" }, 320);
    await run.wait(700);

    // On to the review, then the import itself.
    cursor.show();
    await cursor.click(run, go, () => {
      step(root, 3);
      label.textContent = copy.go;
      if (ready) {
        ready.hidden = false;
        enter(ready, { translate: "-0.4em 0" }, 320);
      }
    });
    await run.wait(1100);
    await cursor.click(run, go, () => {
      label.textContent = copy.busy;
      go.classList.add("is-busy");
    });
    cursor.hide();
    await run.wait(1700);

    // Done: every row is in.
    step(root, 5);
    const foot = $<HTMLElement>("[data-foot]", root);
    if (foot) await leave(run, foot, { translate: "0 0.3em" }, 160);
    if (foot) foot.style.visibility = "hidden";
    const done = pane(root, "done");
    if (done) {
      enter(done, { translate: "0 0.5em" }, 380);
      const tick = $(".v-done > svg", done);
      if (tick) pop(tick, 0.4);
    }
    await run.wait(1200);
  },

  rest: 2800,
};
