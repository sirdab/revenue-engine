// Shared by every script on the marketing pages: finding elements, knowing
// whether to move at all, and a way to write an animation as a sequence of
// steps that can be abandoned halfway.

export const $ = <T extends Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

export const $$ = <T extends Element>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

/** The visitor asked their system for less motion: draw, don't animate. */
export const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A mouse or trackpad, as opposed to a finger. */
export const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const ease = {
  inOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number): number => 1 - Math.pow(1 - t, 3),
  outQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
};

/** `$1,234`: how the sample workspace writes money, in both languages. */
export const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

/** Thrown inside a sequence when it is cancelled; `Run.play` swallows it. */
export const CANCELLED = Symbol("cancelled");

/**
 * One run of a sequence. Every wait inside it ends early, by throwing, the
 * moment the run is cancelled, so a sequence reads top to bottom and still
 * stops wherever it happens to be.
 */
export class Run {
  alive = true;
  private stops = new Set<() => void>();

  cancel(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const stop of this.stops) stop();
    this.stops.clear();
  }

  private check(): void {
    if (!this.alive) throw CANCELLED;
  }

  wait(ms: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const stop = () => {
        window.clearTimeout(timer);
        reject(CANCELLED);
      };
      const timer = window.setTimeout(() => {
        this.stops.delete(stop);
        resolve();
      }, ms);
      this.stops.add(stop);
    });
  }

  /** The next animation frame, with its timestamp. */
  frame(): Promise<number> {
    this.check();
    return new Promise((resolve, reject) => {
      const stop = () => {
        cancelAnimationFrame(id);
        reject(CANCELLED);
      };
      const id = requestAnimationFrame((now) => {
        this.stops.delete(stop);
        resolve(now);
      });
      this.stops.add(stop);
    });
  }

  /** Calls `step` with 0…1 on every frame for `ms`, eased. */
  async tween(ms: number, step: (t: number) => void, easing: (t: number) => number = ease.inOut): Promise<void> {
    const start = await this.frame();
    for (;;) {
      const now = await this.frame();
      const t = clamp((now - start) / ms);
      step(easing(t));
      if (t >= 1) return;
    }
  }

  /** Runs a sequence to its end, or until this run is cancelled. */
  async play(sequence: (run: Run) => Promise<void>): Promise<void> {
    try {
      await sequence(this);
    } catch (error) {
      if (error !== CANCELLED) throw error;
    }
  }
}

/**
 * Counts the number in `el` from one value to another. Only the digits change:
 * the element keeps whatever it has around them.
 */
export function count(
  el: HTMLElement,
  from: number,
  to: number,
  format: (n: number) => string,
  ms = 520,
): void {
  if (still || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const t = clamp((now - start) / ms);
    el.textContent = format(lerp(from, to, ease.outQuint(t)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Tells `on` whenever `el` enters or leaves the viewport (by `threshold`). */
export function watch(
  el: Element,
  on: (visible: boolean) => void,
  options: IntersectionObserverInit = { threshold: 0.35 },
): void {
  if (!("IntersectionObserver" in window)) {
    on(true);
    return;
  }
  // Browsers disagree on whether `isIntersecting` respects the threshold when
  // an element is on its way out: go by the ratio.
  const least = Array.isArray(options.threshold) ? Math.min(...options.threshold) : (options.threshold ?? 0);
  new IntersectionObserver((entries) => {
    for (const entry of entries) on(entry.isIntersecting && entry.intersectionRatio >= least - 0.01);
  }, options).observe(el);
}

/** Runs `fn` when the browser has nothing more urgent to do. */
export function idle(fn: () => void): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1200 });
  else window.setTimeout(fn, 200);
}
