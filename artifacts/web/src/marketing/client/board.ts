// The hero's product window, made to work.
//
// components/app-window.tsx draws the deals page as a still. This script lets
// a visitor use it: drag a card to another stage (the counts and totals follow),
// switch between the four views, open a deal in the side drawer and move it
// from there, and search. Until they do, a tour plays: a cursor that carries
// out those same actions, through the same code paths, so nothing it shows is
// faked.
//
// All copy and all data are in the markup. Nothing here is fetched.

import { $, $$, Run, clamp, count, fine, lerp, money, still, watch } from "./core";
import { Cursor } from "./cursor";

/** Win probability of each stage, in percent. Mirrors app-window.tsx. */
const PROBABILITY = [10, 20, 40, 60, 80];
const SPRING = "cubic-bezier(0.25, 1.35, 0.4, 1)";
const GLIDE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

type View = "pipeline" | "list" | "forecast" | "funnel";
/** A card that has been picked up. Positions are in viewport pixels. */
interface Drag {
  card: HTMLElement;
  /** The gap that shows where it will land. */
  slot: HTMLElement;
  from: HTMLElement | null;
  /** Where on the card it is held. */
  gx: number;
  gy: number;
  w: number;
  h: number;
  /** Where the pointer wants it, and where it has got to (it trails a little). */
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot: number;
  frame: number;
  /** Picked up by the tour's cursor rather than the visitor's. */
  synthetic: boolean;
}

export function board(root: HTMLElement): void {
  const drawer = $<HTMLElement>("[data-board-drawer]", root);
  const tabs = $<HTMLElement>("[data-board-tabs]", root);
  const palette = $<HTMLElement>("[data-board-palette]", root);
  const input = palette && $<HTMLInputElement>("input", palette);
  const cols = $$<HTMLElement>(".board__col", root);
  const cards = $$<HTMLElement>(".deal[data-deal]", root);
  if (!drawer || !tabs || !palette || !input || cols.length === 0 || cards.length === 0) return;

  const wide = window.matchMedia("(min-width: 60.01rem)");
  const rtl = getComputedStyle(root).direction === "rtl";
  const dealsIn = (col: HTMLElement) => $$<HTMLElement>(":scope > .deal[data-deal]", col);
  /** Where every card starts, so the tour can be replayed from the top. */
  const home = cols.map(dealsIn);
  const rich = cards.find((card) => card.hasAttribute("data-rich")) ?? cards[0];
  const held = $<HTMLElement>(".deal--held", root);
  const drawnSlot = $<HTMLElement>(".deal--slot", root);
  const chips = $$<HTMLElement>("[data-stage]", drawer);
  const rows = $$<HTMLElement>(".palette__row", palette);
  const groups = $$<HTMLElement>(".palette__group", palette);
  const none = $<HTMLElement>(".palette__none", palette);

  const box = () => root.getBoundingClientRect();
  /** The window may be drawn scaled; layout pixels and viewport pixels differ by this. */
  const scale = () => box().width / root.offsetWidth || 1;
  const byId = (id: string | undefined) => cards.find((card) => card.dataset.deal === id) ?? null;
  const stageOf = (card: HTMLElement) => Math.max(0, cols.indexOf(card.closest<HTMLElement>(".board__col") ?? cols[0]));
  const text = (el: Element, selector: string) => $(selector, el)?.textContent ?? "";

  // ---- What the script adds to the drawing ---------------------------------
  const layer = document.createElement("div");
  layer.className = "app__layer";
  root.append(layer);
  // The tour's pointer: the one drawn on the held card, set free.
  const cursor = new Cursor(root, $(".app__cursor", root));
  const pill = document.createElement("i");
  pill.className = "app__seg-pill";
  tabs.prepend(pill);

  let view: View = "pipeline";
  let open: HTMLElement | null = rich;
  let drag: Drag | null = null;
  let busy = false;
  let suppressClick = false;

  // ---- Columns: counts and totals ------------------------------------------
  function pulse(el: HTMLElement): void {
    if (still) return;
    el.animate([{ transform: "scale(1)" }, { transform: "scale(1.4)" }, { transform: "scale(1)" }], {
      duration: 420,
      easing: GLIDE,
    });
  }

  function refresh(col: HTMLElement, animate = true): void {
    const deals = dealsIn(col);
    const total = deals.reduce((sum, card) => sum + Number(card.dataset.value), 0);
    const n = $<HTMLElement>(".board__n", col);
    if (n && n.textContent !== String(deals.length)) {
      n.textContent = String(deals.length);
      if (animate) pulse(n);
    }
    const sum = $<HTMLElement>(".board__sum", col);
    if (sum) {
      const from = Number(col.dataset.sum ?? total);
      col.dataset.sum = String(total);
      if (animate) count(sum, from, total, money);
      else sum.textContent = money(total);
    }
  }

  /** The forecast's weighted values follow the stage each deal is in. */
  function forecast(animate: boolean): void {
    const max = Number($<HTMLElement>("[data-axis-max]", root)?.dataset.axisMax ?? 1);
    const byMonth = [0, 0, 0];
    for (const card of cards) {
      byMonth[Number(card.dataset.month)] += (Number(card.dataset.value) * PROBABILITY[stageOf(card)]) / 100;
    }
    for (const bar of $$<HTMLElement>("[data-wbar]", root)) {
      bar.style.setProperty("--h", (byMonth[Number(bar.dataset.wbar)] / max).toFixed(4));
    }
    const tile = $<HTMLElement>("[data-weighted]", root);
    if (!tile) return;
    const total = byMonth.reduce((sum, value) => sum + value, 0);
    const from = Number(tile.dataset.weighted ?? total);
    tile.dataset.weighted = String(Math.round(total));
    if (animate) count(tile, from, total, money, 700);
    else tile.textContent = money(total);
  }

  /** A card has a new place: bring everything that shows it up to date. */
  function commit(card: HTMLElement, from: HTMLElement | null, animate = true): void {
    const to = card.closest<HTMLElement>(".board__col");
    if (from) refresh(from, animate);
    if (to && to !== from) refresh(to, animate);
    const cell = $<HTMLElement>(`[data-row="${card.dataset.deal}"] [data-row-stage]`, root);
    if (cell && to) cell.textContent = text(to, ".board__name");
    forecast(animate && view === "forecast");
    if (open === card) renderDrawer(card, false);
  }

  /** Moves cards in the document, then slides each from where it was. */
  function flip(mutate: () => void, lifted?: HTMLElement): void {
    const items = $$<HTMLElement>(".board .deal[data-deal]", root);
    const first = items.map((el) => el.getBoundingClientRect());
    mutate();
    if (still) return;
    const k = scale();
    items.forEach((el, i) => {
      const last = el.getBoundingClientRect();
      const dx = (first[i].left - last.left) / k;
      const dy = (first[i].top - last.top) / k;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      if (el === lifted) {
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)`, zIndex: 5 },
            { transform: `translate(${dx / 2}px, ${dy / 2 - 14}px) scale(1.05) rotate(${dx < 0 ? 2 : -2}deg)`, zIndex: 5 },
            { transform: "none", zIndex: 5 },
          ],
          { duration: 620, easing: GLIDE },
        );
      } else {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: 300,
          easing: GLIDE,
        });
      }
    });
  }

  function land(card: HTMLElement): void {
    if (still) return;
    card.classList.remove("deal--landed");
    void card.offsetWidth;
    card.classList.add("deal--landed");
  }

  // ---- Dragging ------------------------------------------------------------
  function place(d: Drag): void {
    const b = box();
    const k = scale();
    d.card.style.transform = `translate3d(${(d.cx - b.left) / k}px, ${(d.cy - b.top) / k}px, 0) rotate(${d.rot.toFixed(2)}deg) scale(1.03)`;
  }

  function loop(): void {
    const d = drag;
    if (!d) return;
    const before = d.cx;
    d.cx = lerp(d.cx, d.x, 0.4);
    d.cy = lerp(d.cy, d.y, 0.4);
    // It leans into the direction it is being carried.
    d.rot = lerp(d.rot, clamp((d.cx - before) * 0.8, -7, 7), 0.16);
    place(d);
    const settled = Math.abs(d.cx - d.x) + Math.abs(d.cy - d.y) < 0.3 && Math.abs(d.rot) < 0.05;
    d.frame = settled ? 0 : requestAnimationFrame(loop);
  }

  /** `adopt`: the card is already drawn mid-drag, and this is its slot. */
  function begin(card: HTMLElement, px: number, py: number, synthetic: boolean, adopt?: HTMLElement): void {
    const k = scale();
    const rect = card.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const from = card.closest<HTMLElement>(".board__col");
    let slot: HTMLElement;
    let gx: number;
    let gy: number;
    if (adopt) {
      slot = adopt;
      gx = (w * k) / 2;
      gy = (h * k) / 2;
    } else {
      slot = document.createElement("div");
      slot.className = "deal deal--slot";
      slot.style.height = `${h}px`;
      card.before(slot);
      gx = px - rect.left;
      gy = py - rect.top;
    }
    card.style.width = `${w}px`;
    card.classList.remove("deal--held", "deal--landed");
    card.classList.add("deal--drag");
    layer.append(card);
    drag = {
      card,
      slot,
      from,
      gx,
      gy,
      w: w * k,
      h: h * k,
      x: px - gx,
      y: py - gy,
      cx: px - gx,
      cy: py - gy,
      rot: adopt ? (rtl ? -2.4 : 2.4) : 0,
      frame: 0,
      synthetic,
    };
    root.classList.add("is-dragging");
    place(drag);
  }

  /** `reslot: false` carries the card without reconsidering where it will land. */
  function moveTo(px: number, py: number, reslot = true): void {
    const d = drag;
    if (!d) return;
    d.x = px - d.gx;
    d.y = py - d.gy;
    if (!d.frame) d.frame = requestAnimationFrame(loop);
    if (!reslot) return;

    const mx = d.x + d.w / 2;
    const my = d.y + d.h / 2;
    let best = cols[0];
    let nearest = Infinity;
    for (const col of cols) {
      const r = col.getBoundingClientRect();
      const gap = mx < r.left ? r.left - mx : mx > r.right ? mx - r.right : 0;
      if (gap < nearest) {
        nearest = gap;
        best = col;
      }
    }
    // Layout positions, not drawn ones: cards sliding aside must not move the answer.
    const local = (my - best.getBoundingClientRect().top) / scale();
    const before = dealsIn(best).find((card) => local < card.offsetTop + card.offsetHeight / 2) ?? null;
    if (d.slot.parentElement !== best || d.slot.nextElementSibling !== before) {
      flip(() => best.insertBefore(d.slot, before));
      for (const col of cols) col.classList.toggle("is-target", col === best);
    }
  }

  async function end(instant = false): Promise<void> {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.frame);
    busy = true;
    root.classList.remove("is-dragging");
    for (const col of cols) col.classList.remove("is-target");
    let drop: Animation | null = null;
    if (!instant && !still) {
      const b = box();
      const k = scale();
      const target = d.slot.getBoundingClientRect();
      drop = d.card.animate(
        [
          { transform: d.card.style.transform },
          { transform: `translate3d(${(target.left - b.left) / k}px, ${(target.top - b.top) / k}px, 0) rotate(0deg) scale(1)` },
        ],
        { duration: 360, easing: SPRING, fill: "forwards" },
      );
      await drop.finished.catch(() => undefined);
    }
    d.slot.replaceWith(d.card);
    d.card.classList.remove("deal--drag");
    d.card.removeAttribute("style");
    drop?.cancel();
    busy = false;
    commit(d.card, d.from, !instant);
    if (!instant) land(d.card);
  }

  /** From the drawer: the card flies to its new stage. */
  function moveToStage(card: HTMLElement, stage: number): void {
    const to = cols[stage];
    const from = card.closest<HTMLElement>(".board__col");
    if (!to || to === from || busy || drag) return;
    const head = $(".board__head", to);
    flip(() => (head ? head.after(card) : to.prepend(card)), card);
    commit(card, from);
    land(card);
  }

  // ---- The side drawer -------------------------------------------------------
  const part = (name: string) => $<HTMLElement>(`[data-d="${name}"]`, drawer);

  function renderDrawer(card: HTMLElement, swap = true): void {
    const fill = (name: string, value: string | undefined) => {
      const el = part(name);
      if (el && el.textContent !== value) el.textContent = value ?? "";
    };
    fill("title", text(card, ".deal__title"));
    fill("value", text(card, ".deal__value"));
    fill("who", text(card, ".deal__who"));
    fill("owner", card.dataset.owner);
    fill("org", text(card, ".deal__org"));
    fill("close", card.dataset.close);
    fill("last", card.dataset.last);
    const stage = stageOf(card);
    chips.forEach((chip, i) => {
      chip.classList.toggle("is-on", i === stage);
      chip.classList.toggle("is-done", i < stage);
    });
    const probability = part("prob");
    const chance = `${PROBABILITY[stage]}%`;
    if (probability && probability.textContent !== chance) {
      probability.textContent = chance;
      if (!swap) pulse(probability);
    }
    // Only one deal has a task and a note drawn; the rest say what is next.
    const full = card.hasAttribute("data-rich");
    const task = part("task");
    const note = part("note");
    const next = part("next");
    if (task) task.hidden = !full;
    if (note) note.hidden = !full;
    if (next) next.hidden = full;
    if (!full) fill("next-t", $(`[data-legend="${card.dataset.tone}"]`, root)?.textContent ?? "");
    if (swap && !still) {
      $(".drawer__body", drawer!)?.animate(
        [
          { opacity: 0.15, transform: "translateY(0.6em)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 340, easing: GLIDE },
      );
    }
  }

  function openDeal(card: HTMLElement | null): void {
    if (!card) return;
    const closed = drawer!.classList.contains("is-closed");
    const changed = open !== card;
    open?.classList.remove("deal--open");
    open = card;
    card.classList.add("deal--open");
    renderDrawer(card, changed && !closed);
    drawer!.classList.remove("is-closed");
  }

  function closeDrawer(): void {
    drawer!.classList.add("is-closed");
    open?.classList.remove("deal--open");
  }

  // ---- The four views --------------------------------------------------------
  function movePill(): void {
    const on = $<HTMLElement>("[data-view].is-on", tabs!);
    if (!on) return;
    pill.style.width = `${on.offsetWidth}px`;
    pill.style.transform = `translateX(${on.offsetLeft}px)`;
  }

  function setView(next: View): void {
    if (next === view) return;
    view = next;
    for (const tab of $$<HTMLElement>("[data-view]", tabs!)) tab.classList.toggle("is-on", tab.dataset.view === next);
    for (const panel of $$<HTMLElement>("[data-panel]", root)) {
      const on = panel.dataset.panel === next;
      panel.hidden = !on;
      panel.classList.toggle("is-on", on);
    }
    movePill();
  }

  // ---- Search ---------------------------------------------------------------
  function filter(query: string): void {
    const needle = query.trim().toLowerCase();
    let first: HTMLElement | null = null;
    for (const row of rows) {
      const hit = !needle || (row.textContent ?? "").toLowerCase().includes(needle);
      row.hidden = !hit;
      row.classList.remove("is-on");
      if (hit && !first) first = row;
    }
    for (const group of groups) {
      group.hidden = !rows.some((row) => !row.hidden && row.dataset.group === group.dataset.group);
    }
    if (none) none.hidden = first !== null;
    first?.classList.add("is-on");
  }

  function openPalette(focus: boolean): void {
    input!.value = "";
    filter("");
    palette!.hidden = false;
    root.classList.add("is-searching");
    // A finger would bring up the keyboard and scroll the page: only focus for a mouse.
    if (focus && fine) input!.focus({ preventScroll: true });
  }

  function closePalette(): void {
    palette!.hidden = true;
    root.classList.remove("is-searching");
    input!.blur();
  }

  function choose(row: HTMLElement | null): void {
    closePalette();
    const card = byId(row?.dataset.open);
    if (!card) return;
    setView("pipeline");
    openDeal(card);
  }

  input.addEventListener("input", () => filter(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePalette();
    if (e.key === "Enter") choose($<HTMLElement>(".palette__row.is-on", palette));
  });

  // ---- The visitor's own pointer ---------------------------------------------
  root.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted) return;
    takeOver();
    const card = (e.target as Element).closest<HTMLElement>(".board .deal[data-deal]");
    // Fingers scroll the page; only a mouse or a pen picks a card up.
    if (!card || e.button !== 0 || e.pointerType === "touch" || busy || drag) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        started = true;
        begin(card, startX, startY, false);
      }
      moveTo(ev.clientX, ev.clientY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!started) return;
      // The click that follows a drag is not a request to open the card.
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 0);
      void end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  root.addEventListener("dragstart", (e) => e.preventDefault());

  root.addEventListener("click", (e) => {
    if (suppressClick) return;
    const target = e.target as Element;
    const tab = target.closest<HTMLElement>("[data-view]");
    if (tab) return setView(tab.dataset.view as View);
    if (target.closest("[data-drawer-close]")) return closeDrawer();
    const chip = target.closest<HTMLElement>("[data-stage]");
    if (chip) {
      if (open) moveToStage(open, Number(chip.dataset.stage));
      return;
    }
    if (target.closest("[data-board-search]")) return openPalette(true);
    const hit = target.closest<HTMLElement>(".palette__row");
    if (hit) return choose(hit);
    if (target.closest(".palette")) {
      if (!target.closest(".palette__box")) closePalette();
      return;
    }
    const row = target.closest<HTMLElement>("[data-row]");
    if (row) return openDeal(byId(row.dataset.row));
    const card = target.closest<HTMLElement>(".deal[data-deal]");
    if (card) openDeal(card);
  });

  // ---- The tour ---------------------------------------------------------------
  /** Drags a card to a stage: first in it, or last. */
  async function carry(run: Run, card: HTMLElement, stage: number, last = false): Promise<void> {
    const target = cols[stage];
    if (!target || view !== "pipeline" || target === card.closest(".board__col")) return;
    await cursor.glide(run, () => cursor.spot(card, 0.6, 0.45));
    cursor.down();
    await run.wait(130);
    const at = cursor.onScreen();
    begin(card, at.x, at.y, true);
    await run.wait(150);
    await cursor.glide(
      run,
      () => {
        const others = dealsIn(target);
        const anchor = last && others.length > 0 ? others[others.length - 1] : ($(".board__head", target) ?? target);
        const below = cursor.spot(anchor, 0.6, 1);
        return { x: below.x, y: below.y + card.offsetHeight * 0.55 };
      },
      undefined,
      () => {
        const p = cursor.onScreen();
        moveTo(p.x, p.y);
      },
    );
    await run.wait(170);
    cursor.up();
    await end();
  }

  /** The drawing shows a card mid-drag. The tour's first act is to finish it. */
  async function finishDrawnDrag(run: Run): Promise<void> {
    const d = drag;
    if (!d) return;
    const b = box();
    const k = scale();
    cursor.jump({ x: (d.cx + d.gx - b.left) / k, y: (d.cy + d.gy - b.top) / k });
    cursor.show();
    cursor.down();
    await run.wait(650);
    await cursor.glide(
      run,
      () => cursor.spot(d.slot),
      950,
      () => {
        // Its slot is already drawn where it is going.
        const p = cursor.onScreen();
        moveTo(p.x, p.y, false);
      },
    );
    await run.wait(170);
    cursor.up();
    await end();
  }

  async function type(run: Run, word: string): Promise<void> {
    for (let i = 1; i <= word.length; i++) {
      input!.value = word.slice(0, i);
      filter(input!.value);
      await run.wait(70 + Math.random() * 70);
    }
  }

  const traveller = held ?? cards[0];
  /** On a narrow screen only the first two stages are in view. */
  const nearCard = home[0][home[0].length - 1] ?? cards[0];
  const sought = home[2]?.[0] ?? cards[0];
  const closeButton = () => $("svg[data-drawer-close]", drawer!);
  const drawerShown = () => drawer!.offsetParent !== null && !drawer!.classList.contains("is-closed");

  async function forward(run: Run): Promise<void> {
    if (wide.matches) {
      await carry(run, traveller, 2);
      await run.wait(900);
      if (drawerShown()) {
        await cursor.click(run, closeButton(), closeDrawer);
        await run.wait(450);
      }
      await carry(run, rich, Math.min(stageOf(rich) + 1, cols.length - 1));
      await run.wait(500);
      await cursor.click(run, rich, () => openDeal(rich), 0.42, 0.5);
      await run.wait(2400);
      // The other views are wider than the board: put the drawer away first.
      await cursor.click(run, closeButton(), closeDrawer);
      await run.wait(350);
    } else {
      await carry(run, nearCard, 1);
      await run.wait(1300);
    }
    for (const next of ["list", "forecast", "funnel", "pipeline"] as const) {
      await cursor.click(run, $(`[data-view="${next}"]`, tabs!), () => setView(next));
      await run.wait(next === "pipeline" ? 900 : 2400);
    }
    if (wide.matches) {
      await cursor.click(run, $("[data-board-search]", root), () => openPalette(false), 0.3, 0.5);
      await run.wait(350);
      await type(run, text(sought, ".deal__title").split(/\s/)[0].toLowerCase());
      await run.wait(750);
      await cursor.click(run, $(".palette__row.is-on", palette!), () => choose($<HTMLElement>(".palette__row.is-on", palette!)), 0.3, 0.5);
      await run.wait(2400);
    }
  }

  async function back(run: Run): Promise<void> {
    if (!wide.matches) {
      await carry(run, nearCard, 0, true);
      return;
    }
    if (drawerShown()) {
      await cursor.click(run, closeButton(), closeDrawer);
      await run.wait(450);
    }
    await carry(run, traveller, 1, true);
    await run.wait(700);
    await carry(run, rich, 3);
    await run.wait(500);
    await cursor.click(run, rich, () => openDeal(rich), 0.42, 0.5);
    await run.wait(1600);
  }

  let tour: Run | null = null;
  let inView = false;
  let lastUse = -Infinity;
  let resume = 0;

  function startTour(delay = 800): void {
    if (tour || still || !inView) return;
    const run = (tour = new Run());
    void run
      .play(async () => {
        await run.wait(delay);
        cursor.show();
        if (drag?.synthetic) await finishDrawnDrag(run);
        for (;;) {
          await forward(run);
          await run.wait(2800);
          await back(run);
          await run.wait(2800);
        }
      })
      .finally(() => {
        if (tour === run) tour = null;
      });
  }

  function stopTour(): void {
    const run = tour;
    tour = null;
    run?.cancel();
    cursor.hide();
    if (drag?.synthetic) void end(true);
  }

  function takeOver(): void {
    lastUse = performance.now();
    stopTour();
    // Left alone for a while, it goes back to showing itself off.
    window.clearTimeout(resume);
    resume = window.setTimeout(() => startTour(0), 30_000);
  }

  /** Everything back where it started. */
  function reset(): void {
    if (drag) void end(true);
    closePalette();
    setView("pipeline");
    flip(() => home.forEach((deals, i) => deals.forEach((card) => cols[i].append(card))));
    for (const card of cards) commit(card, null, false);
    openDeal(rich);
  }

  const replay = $<HTMLElement>("[data-board-replay]", root.parentElement ?? document);
  // A visitor who asked for less motion gets no tour, so no button for one.
  if (replay && still) replay.hidden = true;
  replay?.addEventListener("click", () => {
    stopTour();
    window.clearTimeout(resume);
    reset();
    lastUse = -Infinity;
    root.scrollIntoView({ block: "center", behavior: "smooth" });
    startTour(900);
  });

  // ---- Start -------------------------------------------------------------------
  for (const col of cols) col.dataset.sum = String(Number(text(col, ".board__sum").replace(/[^\d]/g, "")));
  root.classList.add("is-live");
  const hint = $<HTMLElement>("[data-board-hint]", root.parentElement ?? document);
  if (hint) hint.hidden = false;
  movePill();
  if ("ResizeObserver" in window) new ResizeObserver(movePill).observe(tabs);

  if (held && drawnSlot) {
    if (still || !wide.matches) {
      // No tour to finish the drawn drag, or no room to show it: just land it.
      const from = held.closest<HTMLElement>(".board__col");
      drawnSlot.replaceWith(held);
      held.classList.remove("deal--held");
      commit(held, from, false);
    } else {
      const r = held.getBoundingClientRect();
      begin(held, r.left + r.width / 2, r.top + r.height / 2, true, drawnSlot);
    }
  }

  // Browsers without scroll-driven animations get the window's tilt from here.
  if (!CSS.supports("animation-timeline: view()") && !still) {
    const stage = root.parentElement ?? root;
    let flat = 1;
    let frame = 0;
    const target = () =>
      wide.matches ? clamp((window.innerHeight - stage.getBoundingClientRect().top) / (window.innerHeight * 0.5)) : 1;
    const step = () => {
      const goal = target();
      flat = Math.abs(goal - flat) < 0.003 ? goal : lerp(flat, goal, 0.2);
      root.style.setProperty("--flat", flat.toFixed(4));
      frame = flat === goal ? 0 : requestAnimationFrame(step);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    root.classList.add("is-tilting");
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick, { passive: true });
    kick();
  }

  watch(
    root,
    (visible) => {
      inView = visible;
      if (!visible) stopTour();
      else if (performance.now() - lastUse > 8000) startTour();
    },
    { threshold: wide.matches ? 0.55 : 0.35 },
  );
}
