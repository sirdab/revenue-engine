// What every scene is written with: the shape of a scene, and the handful of
// moves they share (typing, writing out, arriving, sliding to a new place).

import type { Run } from "../core";
import type { Cursor } from "../cursor";

export { $, $$, count, money } from "../core";

/** Overshoots a little, like something with weight coming to rest. */
export const SPRING = "cubic-bezier(0.25, 1.35, 0.4, 1)";
export const GLIDE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export interface Stage {
  /** The frame. It outlives every replay. */
  frame: HTMLElement;
  /** The drawing inside it, rebuilt from the still before each play. */
  root: HTMLElement;
  /** The copy sent along with the markup (`data` in components/art.tsx). */
  data: unknown;
  cursor: Cursor;
}

export interface Scene {
  /** Arranges the still into the moment the sequence opens on. */
  setup(stage: Stage): void;
  /**
   * The sequence. One that returns is replayed from the still after a rest;
   * one that loops for ever simply never returns.
   */
  play(run: Run, stage: Stage): Promise<void>;
  /**
   * A visitor's click inside the frame. Return true if it did something: the
   * sequence then stands aside for a while and leaves the drawing to them.
   */
  click?(target: Element, stage: Stage): boolean;
  /** How long to hold the last moment before replaying, in milliseconds. */
  rest?: number;
}

/**
 * Types `text` into `el`, a character at a time, with a caret after it. The
 * caret stays (someone is still at the keyboard) until `typed(el)`.
 */
export async function type(run: Run, el: HTMLElement, text: string, ms = 58): Promise<void> {
  el.classList.add("is-typing");
  for (let i = 1; i <= text.length; i++) {
    el.textContent = text.slice(0, i);
    await run.wait(ms * (0.55 + Math.random() * 0.9));
  }
}

export function typed(el: HTMLElement): void {
  el.classList.remove("is-typing");
}

/** Writes `text` into `el` a word at a time, as an answer arrives. */
export async function words(run: Run, el: HTMLElement, text: string, ms = 46): Promise<void> {
  let written = "";
  for (const part of text.split(/(\s+)/)) {
    written += part;
    if (!part.trim()) continue;
    el.textContent = written;
    await run.wait(ms * (0.6 + Math.random() * 0.8));
  }
}

// These use `translate` and `scale`, not `transform`: many of the cards are
// placed with a transform of their own, which an animated one would replace.

/** Something arrives: up from just below, by default. */
export function enter(el: Element, from: Keyframe = { translate: "0 0.6em" }, ms = 420): Animation {
  return el.animate([{ opacity: 0, ...from }, { opacity: 1, translate: "0 0", scale: 1 }], {
    duration: ms,
    easing: GLIDE,
  });
}

/** Something leaves. Resolves when it has gone; the caller then hides it. */
export async function leave(run: Run, el: Element, to: Keyframe = { translate: "0 -0.5em" }, ms = 220): Promise<void> {
  el.animate([{ opacity: 1 }, { opacity: 0, ...to }], { duration: ms, easing: "ease-in", fill: "forwards" });
  await run.wait(ms);
}

/** Undoes what `leave` held in place, once the element is hidden or refilled. */
export function settle(el: Element): void {
  for (const animation of el.getAnimations()) animation.cancel();
}

/** A small bounce, for a tick that lands or a button that wakes. */
export function pop(el: Element, from = 0.6): Animation {
  return el.animate([{ scale: from }, { scale: 1 }], { duration: 420, easing: SPRING });
}

/**
 * Changes the layout, then slides each of `els` from where it was to where it
 * now is. Elements that were not laid out before (hidden) fade in instead.
 */
export function flip(els: Element[], mutate: () => void, ms = 440): void {
  const first = els.map((el) => el.getBoundingClientRect());
  mutate();
  els.forEach((el, i) => {
    const before = first[i];
    const after = el.getBoundingClientRect();
    if (after.width === 0 && after.height === 0) return;
    if (before.width === 0 && before.height === 0) {
      enter(el);
      return;
    }
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: ms, easing: GLIDE });
  });
}

/** Restarts a CSS animation that a class starts. */
export function retrigger(el: Element, className: string): void {
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
}
