// The only script on the marketing pages. Everything it does is an
// enhancement: the pages read and navigate the same without it.
//
// No framework and no dependencies, on purpose. What a landing page needs from
// JavaScript is a menu, a little motion and a copy button.

import { idle } from "./client/core";

const $$ = <T extends Element>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

// ---- Mobile menu ------------------------------------------------------------
function menu(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const sheet = document.getElementById("nav-sheet");
  if (!toggle || !sheet) return;

  const set = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    sheet.hidden = !open;
  };
  toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true"));
  sheet.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) {
      set(false);
      toggle.focus();
    }
  });
  // Rotating a phone or widening the window past the breakpoint leaves the
  // sheet behind otherwise.
  window.matchMedia("(min-width: 60.01rem)").addEventListener("change", (e) => {
    if (e.matches) set(false);
  });
}

// ---- The navigation takes the colour of what is behind it ---------------------
function navTheme(): void {
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  const dark = $$<HTMLElement>('[data-nav-theme="dark"]');
  if (!nav || dark.length === 0) return;

  let queued = false;
  const update = () => {
    queued = false;
    // The line the navigation's tiles sit on.
    const y = nav.getBoundingClientRect().top + nav.offsetHeight / 2;
    const over = dark.some((el) => {
      const r = el.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
    nav.classList.toggle("nav--dark", over);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  update();
}

// ---- Sections rise into place as they are reached ----------------------------
// The stylesheet hides nothing until `.motion` is on <html>, and that is set
// here, only after whatever is already on screen has been marked as shown.
// So the page never depends on this script to be readable.
function reveal(): void {
  const items = $$<HTMLElement>(".reveal");
  if (items.length === 0 || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const fold = window.innerHeight;
  const waiting = items.filter((el) => {
    if (el.getBoundingClientRect().top >= fold) return true;
    el.classList.add("in");
    return false;
  });
  document.documentElement.classList.add("motion");

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  waiting.forEach((el) => observer.observe(el));
}

// ---- The side list marks the section being read -------------------------------
function spy(): void {
  for (const list of $$<HTMLElement>("[data-spy]")) {
    const links = $$<HTMLAnchorElement>("a[href^='#']", list);
    const targets = links
      .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) continue;

    const mark = (id: string) => {
      for (const a of links) {
        if (a.hash === `#${id}`) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    };
    let queued = false;
    const update = () => {
      queued = false;
      // The last section whose top has passed a line a third of the way down.
      const line = window.innerHeight * 0.34;
      let current = targets[0];
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= line) current = el;
      }
      mark(current.id);
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    update();
  }
}

// ---- Copy buttons on code blocks ---------------------------------------------
function copy(): void {
  for (const button of $$<HTMLButtonElement>("[data-copy]")) {
    const label = button.querySelector("span");
    const original = label?.textContent ?? "";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy ?? "");
      } catch {
        return; // No clipboard access (an insecure origin, say): do nothing.
      }
      if (!label) return;
      label.textContent = button.dataset.copied ?? original;
      window.setTimeout(() => {
        label.textContent = original;
      }, 1800);
    });
  }
}

menu();
navTheme();
reveal();
spy();
copy();

// Everything below is its own chunk, fetched once the page has settled, so it
// costs the first paint nothing.

// The hero's product window works: see client/board.ts.
const live = document.querySelector<HTMLElement>("[data-board]");
if (live) idle(() => void import("./client/board").then((m) => m.board(live)));

// The marbled backdrops drift: see client/paint.ts.
if (document.querySelector("[data-paint]")) idle(() => void import("./client/paint").then((m) => m.paint()));

// The illustrations play: see client/scenes.ts.
if (document.querySelector("[data-scene]")) idle(() => void import("./client/scenes").then((m) => m.scenes()));
