// The product illustrations, played.
//
// components/art.tsx draws each one as a still. For every frame that names a
// scene, this plays it while it is on screen: a short sequence that does what
// the caption says, using the drawing's own markup. A scene that comes to an
// end rests, then starts again from the still; one that is a cycle just keeps
// going. A visitor who clicks something that works (a tab, a chart type, a
// switch) takes the drawing over, and the sequence leaves it alone for a while.
//
// Each scene is a file in ./scenes. All of them load together in this one
// chunk, after the page has settled. Nothing here runs for a visitor who asked
// for less motion: they keep the stills.

import { $, $$, Run, still, watch } from "./core";
import { Cursor } from "./cursor";
import { askAi } from "./scenes/ask-ai";
import { automation } from "./scenes/automation";
import { customers } from "./scenes/customers";
import { importing } from "./scenes/import";
import { insights } from "./scenes/insights";
import type { Scene, Stage } from "./scenes/kit";
import { languages } from "./scenes/languages";
import { pipeline } from "./scenes/pipeline";
import { terminal } from "./scenes/terminal";

const SCENES: Record<string, Scene> = {
  pipeline,
  customers,
  automation,
  insights,
  "ask-ai": askAi,
  import: importing,
  terminal,
  languages,
};

/** How long a finished scene holds its last moment, unless it says otherwise. */
const REST = 2600;
/** How long a drawing is left to a visitor who used it. */
const HANDS_OFF = 14_000;

function mount(frame: HTMLElement, scene: Scene): void {
  const root = $<HTMLElement>(".frame__stage", frame);
  if (!root) return;
  const original = root.innerHTML;
  const data: unknown = frame.dataset.sceneData ? JSON.parse(frame.dataset.sceneData) : null;
  let stage: Stage;
  let run: Run | null = null;
  let inView = false;
  let resume = 0;

  /** Back to the still, arranged for the scene's opening. */
  const rebuild = () => {
    root.innerHTML = original;
    root.style.opacity = "";
    stage = { frame, root, data, cursor: new Cursor(root, $(".g-cursor", root)) };
    scene.setup(stage);
  };

  const fade = (mine: Run, from: number, to: number, ms: number) =>
    mine.tween(ms, (t) => {
      root.style.opacity = String(from + (to - from) * t);
    });

  const start = (delay: number) => {
    if (run || !inView) return;
    const mine = (run = new Run());
    void mine
      .play(async () => {
        await mine.wait(delay);
        for (;;) {
          await scene.play(mine, stage);
          await mine.wait(scene.rest ?? REST);
          await fade(mine, 1, 0, 280);
          rebuild();
          await fade(mine, 0, 1, 460);
        }
      })
      .finally(() => {
        if (run === mine) run = null;
      });
  };

  const stop = () => {
    const mine = run;
    run = null;
    mine?.cancel();
    stage.cursor.hide();
    root.style.opacity = "";
  };

  rebuild();
  frame.classList.add("is-live");

  frame.addEventListener("click", (e) => {
    if (!e.isTrusted || !scene.click?.(e.target as Element, stage)) return;
    stop();
    window.clearTimeout(resume);
    resume = window.setTimeout(() => {
      if (!inView) return;
      rebuild();
      start(0);
    }, HANDS_OFF);
  });

  watch(
    frame,
    (visible) => {
      if (visible === inView) return;
      inView = visible;
      window.clearTimeout(resume);
      if (visible) {
        start(350);
      } else {
        // Out of sight: put it back, so it starts from the top when it returns.
        stop();
        rebuild();
      }
    },
    { threshold: 0.45 },
  );
}

export function scenes(): void {
  if (still) return;
  for (const frame of $$<HTMLElement>("[data-scene]")) {
    const scene = SCENES[frame.dataset.scene ?? ""];
    if (scene) mount(frame, scene);
  }
}
