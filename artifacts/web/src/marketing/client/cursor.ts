// The pointer that demonstrates the drawings: it glides to things along a
// slight curve, presses, and leaves a ripple where it clicked. The hero's
// product window and the illustrations below it share this one.
//
// Positions are in the root's own layout pixels, from its top left corner, so
// the page scrolling underneath (or the root being drawn scaled) changes
// nothing.

import { type Run, clamp, lerp } from "./core";

export interface Point {
  x: number;
  y: number;
}

export class Cursor {
  /** Where it is. */
  readonly at: Point;
  private readonly ghost: HTMLElement;
  private bend = 1;

  /**
   * `root` must be positioned. `arrow` is the pointer's drawing: the markup
   * already has one (an icon), which this takes and carries around.
   */
  constructor(
    private readonly root: HTMLElement,
    arrow: Element | null,
  ) {
    this.ghost = document.createElement("div");
    this.ghost.className = "ghost";
    if (arrow) this.ghost.append(arrow);
    root.append(this.ghost);
    this.at = { x: root.offsetWidth * 0.5, y: root.offsetHeight * 0.75 };
    this.draw();
  }

  /** Layout pixels and viewport pixels differ by this when the root is scaled. */
  private scale(): number {
    return this.root.getBoundingClientRect().width / this.root.offsetWidth || 1;
  }

  /** A point inside `el`, by fractions of its width and height. */
  spot(el: Element, fx = 0.5, fy = 0.5): Point {
    const r = el.getBoundingClientRect();
    const b = this.root.getBoundingClientRect();
    const k = this.scale();
    return { x: (r.left + r.width * fx - b.left) / k, y: (r.top + r.height * fy - b.top) / k };
  }

  /** The same point in viewport pixels (where a real pointer event would be). */
  onScreen(p: Point = this.at): Point {
    const b = this.root.getBoundingClientRect();
    const k = this.scale();
    return { x: b.left + p.x * k, y: b.top + p.y * k };
  }

  draw(): void {
    this.ghost.style.transform = `translate3d(${this.at.x}px, ${this.at.y}px, 0)`;
  }

  /** Puts it somewhere without travelling there. */
  jump(p: Point): void {
    this.at.x = p.x;
    this.at.y = p.y;
    this.draw();
  }

  show(): void {
    this.ghost.classList.add("is-on");
  }

  hide(): void {
    this.ghost.classList.remove("is-on", "is-down");
  }

  down(): void {
    this.ghost.classList.add("is-down");
  }

  up(): void {
    this.ghost.classList.remove("is-down");
  }

  /**
   * Moves to a target along a slight curve, as a hand would. The target is
   * asked for on every frame, so it may move while the pointer travels.
   */
  async glide(run: Run, target: () => Point, ms?: number, onMove?: () => void): Promise<void> {
    const from = { ...this.at };
    const aim = target();
    const distance = Math.hypot(aim.x - from.x, aim.y - from.y);
    const arc = clamp(distance * 0.1, 0, 42) * (this.bend = -this.bend);
    await run.tween(ms ?? clamp(distance * 2.1, 420, 1150), (t) => {
      const to = target();
      const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const lift = Math.sin(Math.PI * t) * arc;
      this.at.x = lerp(from.x, to.x, t) - ((to.y - from.y) / span) * lift;
      this.at.y = lerp(from.y, to.y, t) + ((to.x - from.x) / span) * lift;
      this.draw();
      onMove?.();
    });
  }

  /** Travels to `el`, presses, runs `act` and lets go. Does nothing if `el` is not on show. */
  async click(run: Run, el: Element | null, act: () => void, fx = 0.5, fy = 0.5): Promise<void> {
    if (!el || (el as HTMLElement).offsetParent === null) return;
    await this.glide(run, () => this.spot(el, fx, fy));
    this.down();
    await run.wait(110);
    act();
    this.ghost.classList.remove("is-click");
    void this.ghost.offsetWidth;
    this.ghost.classList.add("is-click");
    this.up();
    await run.wait(120);
  }
}
