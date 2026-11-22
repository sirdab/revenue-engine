// See what is working: the dashboard's numbers count up, then one widget is
// taken through every chart type the app has. The picker works for a visitor
// too: click a type and the chart is redrawn as it.
//
// As in the app: a widget's chart type is picked from eight icon tiles (bar,
// bar list, line, area, pie, funnel, KPI, table) and the same data is redrawn.

import { clamp, ease, lerp } from "../core";
import { type Scene, $, $$, GLIDE, SPRING, pop } from "./kit";

/** The order the tour takes them in: it ends where the still begins. */
const TOUR = ["line", "area", "pie", "funnel", "kpi", "list", "table", "bar"];

/** Counts a figure such as "$348k" up from nothing, keeping what surrounds the digits. */
function countUp(el: HTMLElement, ms = 900): void {
  const text = el.dataset.figure ?? el.textContent ?? "";
  el.dataset.figure = text;
  const parts = /^(\D*)(\d+)(.*)$/.exec(text.trim());
  if (!parts) return;
  const to = Number(parts[2]);
  const start = performance.now();
  const tick = (now: number) => {
    const t = clamp((now - start) / ms);
    el.textContent = `${parts[1]}${Math.round(lerp(0, to, ease.outQuint(t)))}${parts[3]}`;
    if (t < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Each chart type draws itself in its own way. */
function draw(widget: HTMLElement, kind: string): void {
  const each = (selector: string, frames: Keyframe[], ms: number, easing = GLIDE, step = 55) =>
    $$(selector, widget).forEach((el, i) => el.animate(frames, { duration: ms, easing, delay: i * step, fill: "backwards" }));
  switch (kind) {
    case "bar":
    case "funnel":
      each(".v-plot__cols i", [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], 700, SPRING);
      each(".v-plot__cols b", [{ opacity: 0 }, { opacity: 1 }], 400, GLIDE, 55);
      break;
    case "line":
    case "area":
      // The line is drawn from its first month to its last.
      each(".v-plot__path svg", [{ clipPath: "inset(-10% 100% -10% -5%)" }, { clipPath: "inset(-10% -5% -10% -5%)" }], 900);
      each(".v-plot__path i", [{ scale: 0 }, { scale: 1 }], 420, SPRING, 110);
      break;
    case "pie":
      each(".v-plot__pie circle", [{ strokeDasharray: "0 100" }, {}], 700, GLIDE, 70);
      each(".v-plot__pie li", [{ opacity: 0, translate: "0 0.4em" }, { opacity: 1, translate: "0 0" }], 380, GLIDE, 60);
      break;
    case "kpi": {
      const figure = $<HTMLElement>(".v-plot__kpi > b", widget);
      if (figure) countUp(figure, 800);
      each(".v-plot__kpi .v-delta", [{ opacity: 0, translate: "0 0.4em" }, { opacity: 1, translate: "0 0" }], 420, GLIDE, 0);
      break;
    }
    case "list":
      each(".v-plot__list i", [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 650, GLIDE, 60);
      break;
    case "table":
      each(".v-plot__table div", [{ opacity: 0, translate: "0 0.4em" }, { opacity: 1, translate: "0 0" }], 360, GLIDE, 45);
      break;
  }
}

function setKind(root: HTMLElement, kind: string): void {
  const widget = $<HTMLElement>("[data-widget]", root);
  if (!widget || widget.dataset.kind === kind) return;
  widget.dataset.kind = kind;
  widget.classList.add("is-editing");
  for (const tile of $$<HTMLElement>("[data-viz] [data-kind]", root)) {
    const on = tile.dataset.kind === kind;
    tile.classList.toggle("is-on", on);
    if (on) pop(tile, 0.92);
  }
  draw(widget, kind);
}

export const insights: Scene = {
  setup() {
    // The still is where it starts: a bar chart.
  },

  async play(run, { root, cursor }) {
    const widget = $<HTMLElement>("[data-widget]", root);
    if (!widget) return;
    // The dashboard loads: its figures count up and the chart draws.
    for (const figure of $$<HTMLElement>("[data-count]", root)) countUp(figure);
    draw(widget, widget.dataset.kind ?? "bar");
    $$(".v-bars i", root).forEach((bar, i) =>
      bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: 700,
        easing: GLIDE,
        delay: 200 + i * 70,
        fill: "backwards",
      }),
    );
    await run.wait(2200);

    cursor.show();
    for (;;) {
      for (const kind of TOUR) {
        await cursor.click(run, $(`[data-viz] [data-kind="${kind}"]`, root), () => setKind(root, kind));
        await run.wait(kind === "bar" ? 2600 : 1750);
      }
    }
  },

  click(target, { root }) {
    const tile = target.closest<HTMLElement>("[data-viz] [data-kind]");
    if (!tile) return false;
    setKind(root, tile.dataset.kind ?? "bar");
    return true;
  },
};
