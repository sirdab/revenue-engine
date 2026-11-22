// Run your pipeline: a deal is dragged to the next stage, the stage asks for
// the fields it requires, they are filled in, and the move goes through.
//
// This is what the app does. A stage can require fields; dropping a deal that
// lacks one sends the card back and opens "Required fields for …", whose
// button reads "Fill 1 more to move" until nothing is missing.

import { clamp, lerp } from "../core";
import { type Scene, $, $$, GLIDE, SPRING, count, enter, flip, leave, money, pop, retrigger, type, typed } from "./kit";

/** What the dialog says once its last field is filled, and what is typed into it. */
interface Copy {
  filled: string;
  go: string;
  value: string;
}

const cardsIn = (col: HTMLElement) => $$<HTMLElement>(":scope > .v-deal[data-value]", col);

/** A column's count and total follow the cards in it. */
function recount(col: HTMLElement, animate: boolean): void {
  const deals = cardsIn(col);
  const total = deals.reduce((sum, deal) => sum + Number(deal.dataset.value), 0);
  const n = $<HTMLElement>("[data-n]", col);
  if (n && n.textContent !== String(deals.length)) {
    n.textContent = String(deals.length);
    if (animate) pop(n, 1.5);
  }
  const sum = $<HTMLElement>("[data-sum]", col);
  if (!sum) return;
  const from = Number(col.dataset.sum ?? total);
  col.dataset.sum = String(total);
  if (animate) count(sum, from, total, money);
  else sum.textContent = money(total);
}

export const pipeline: Scene = {
  // The still shows the card in the hand and the dialog open. The sequence
  // starts a moment earlier: the card in its column, nothing asked yet.
  setup({ root }) {
    $("[data-lift]", root)?.classList.remove("v-deal--lift");
    $(".v-deal--slot", root)?.remove();
    const req = $<HTMLElement>("[data-req]", root);
    if (req) req.hidden = true;
    for (const col of $$<HTMLElement>(".v-col", root)) recount(col, false);
  },

  async play(run, { root, cursor, data }) {
    const copy = data as Copy;
    const [home, target] = $$<HTMLElement>(".v-col", root);
    const card = $<HTMLElement>("[data-lift]", root);
    const req = $<HTMLElement>("[data-req]", root);
    const toast = $<HTMLElement>("[data-toast]", root);
    const head = target && $<HTMLElement>(".v-col__head", target);
    if (!home || !target || !head || !card || !req) return;
    const others = () => $$<HTMLElement>(".v-deal[data-value]", root).filter((deal) => deal !== card);

    await run.wait(900);
    cursor.show();
    await cursor.glide(run, () => cursor.spot(card, 0.5, 0.5));
    cursor.down();
    await run.wait(140);

    // Picked up: it leaves a gap where it was and follows the pointer.
    const height = card.offsetHeight;
    const corner = cursor.spot(card, 0, 0);
    const grip = { x: cursor.at.x - corner.x, y: cursor.at.y - corner.y };
    const gap = document.createElement("div");
    gap.className = "v-deal v-deal--slot v-deal--gap";
    gap.style.height = `${height}px`;
    card.style.width = `${card.offsetWidth}px`;
    card.before(gap);
    card.classList.add("v-deal--drag");
    root.append(card);
    let lean = 0;
    let lastX = cursor.at.x;
    const follow = () => {
      // It leans into the direction it is carried.
      lean = lerp(lean, clamp((cursor.at.x - lastX) * 0.9, -6, 6), 0.18);
      lastX = cursor.at.x;
      card.style.transform = `translate3d(${cursor.at.x - grip.x}px, ${cursor.at.y - grip.y}px, 0) rotate(${lean.toFixed(2)}deg) scale(1.03)`;
    };
    follow();
    await run.wait(160);

    // Over the next stage, a place opens for it.
    const slot = document.createElement("div");
    slot.className = "v-deal v-deal--slot";
    slot.style.height = `${height}px`;
    let over = false;
    await cursor.glide(
      run,
      () => {
        const below = cursor.spot(head, 0.5, 1);
        return { x: below.x, y: below.y + height * 0.8 };
      },
      980,
      () => {
        follow();
        const edge = target.getBoundingClientRect();
        const x = cursor.onScreen().x;
        if (over || x < edge.left || x > edge.right) return;
        over = true;
        target.classList.add("is-target");
        flip(others(), () => head.after(slot));
      },
    );
    await run.wait(280);
    cursor.up();

    // The stage requires a field this deal has not got. The card goes back…
    target.classList.remove("is-target");
    flip(others(), () => slot.remove());
    const origin = cursor.spot(gap, 0, 0);
    const back = card.animate(
      [
        { transform: card.style.transform },
        { transform: `translate3d(${origin.x}px, ${origin.y}px, 0) rotate(0deg) scale(1)` },
      ],
      { duration: 480, easing: SPRING, fill: "forwards" },
    );
    await run.wait(480);
    gap.replaceWith(card);
    card.classList.remove("v-deal--drag");
    card.removeAttribute("style");
    back.cancel();

    // …and the app asks for it.
    req.hidden = false;
    req.animate(
      [
        { opacity: 0, scale: 0.94, translate: "0 0.8em" },
        { opacity: 1, scale: 1, translate: "0 0" },
      ],
      { duration: 440, easing: SPRING },
    );
    await run.wait(1000);

    const field = $<HTMLElement>("[data-req-field]", req);
    const box = field && $<HTMLElement>(".v-req__v", field);
    const go = $<HTMLElement>("[data-req-go]", req);
    if (!field || !box || !go) return;
    await cursor.click(run, box, () => field.classList.add("is-focus"), 0.35, 0.5);
    await run.wait(260);
    await type(run, box, copy.value, 90);
    await run.wait(320);
    typed(box);
    field.classList.remove("is-focus");
    field.classList.add("is-filled");
    const tick = $(".g-check", field);
    if (tick) {
      tick.classList.add("g-check--on");
      pop(tick);
    }
    $<HTMLElement>("[data-req-bar]", req)?.style.setProperty("--w", "1");
    const counter = $("[data-req-count]", req);
    if (counter) counter.textContent = copy.filled;
    req.classList.add("is-complete");
    go.textContent = copy.go;
    go.classList.remove("is-off");
    pop(go, 0.9);
    await run.wait(750);

    // Nothing is missing now: the same move goes through.
    await cursor.click(run, go, () => undefined);
    await leave(run, req, { scale: 0.96, translate: "0 0.5em" }, 200);
    req.hidden = true;
    const from = card.getBoundingClientRect();
    flip(others(), () => head.after(card));
    const to = card.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    card.animate(
      [
        { translate: `${dx}px ${dy}px`, zIndex: 5 },
        { translate: `${dx / 2}px ${dy / 2 - 16}px`, scale: 1.05, rotate: dx < 0 ? "2deg" : "-2deg", zIndex: 5 },
        { translate: "0 0", scale: 1, rotate: "0deg", zIndex: 5 },
      ],
      { duration: 660, easing: GLIDE },
    );
    recount(home, true);
    recount(target, true);
    await run.wait(660);
    retrigger(card, "is-landed");
    if (toast) {
      toast.hidden = false;
      enter(toast, { translate: "0 0.8em" });
    }
    await run.wait(700);
    cursor.hide();
    await run.wait(1900);
    if (toast) {
      await leave(run, toast, { translate: "0 0.5em" });
      toast.hidden = true;
    }
  },
};
