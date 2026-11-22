// At home in English and Arabic: one small app window whose language and
// theme switches work. Switching language mirrors the whole layout, and every
// part of it slides to its new side; switching theme repaints it. A visitor
// can press the two switches themselves.
//
// As in the app: both are icon buttons in the top bar, both apply at once, and
// the language button names the language it switches to.

import { type Scene, $, $$, GLIDE } from "./kit";

/** English to Arabic or back: the layout mirrors, and its parts travel across. */
function toggleLanguage(root: HTMLElement): void {
  const app = $<HTMLElement>("[data-live]", root);
  if (!app) return;
  const parts = $$<HTMLElement>("[data-flip]", app);
  const before = parts.map((part) => part.getBoundingClientRect());
  const to = app.lang === "ar" ? "en" : "ar";
  app.lang = to;
  app.dir = to === "ar" ? "rtl" : "ltr";
  for (const text of $$<HTMLElement>("[data-en]", app)) text.textContent = text.dataset[to] ?? "";
  parts.forEach((part, i) => {
    const after = part.getBoundingClientRect();
    // Each part keeps hold of its leading edge: the one its text starts from.
    const dx = to === "ar" ? before[i].left - after.right + after.width : before[i].right - after.left - after.width;
    part.animate(
      [
        // Dimmed, not gone: the card should read as moving, never as blank.
        { translate: `${dx}px ${before[i].top - after.top}px`, opacity: 0.55 },
        { opacity: 1, offset: 0.4 },
        { translate: "0 0", opacity: 1 },
      ],
      { duration: 620, easing: GLIDE, delay: Math.min(i, 8) * 16, fill: "backwards" },
    );
  });
}

function toggleTheme(root: HTMLElement): void {
  $("[data-live]", root)?.classList.toggle("is-dark");
}

export const languages: Scene = {
  // The still shows both languages side by side. The scene shows one window
  // that can be switched between them.
  setup({ root }) {
    const still = $<HTMLElement>("[data-still]", root);
    const live = $<HTMLElement>("[data-live]", root);
    if (!still || !live) return;
    still.hidden = true;
    live.hidden = false;
  },

  async play(run, { root, cursor }) {
    const language = () => $('[data-switch="lang"]', root);
    const theme = () => $('[data-switch="theme"]', root);
    await run.wait(1500);
    cursor.show();
    for (;;) {
      await cursor.click(run, language(), () => toggleLanguage(root));
      await run.wait(2300);
      await cursor.click(run, theme(), () => toggleTheme(root));
      await run.wait(2300);
    }
  },

  click(target, { root }) {
    const button = target.closest<HTMLElement>("[data-switch]");
    if (!button) return false;
    if (button.dataset.switch === "lang") toggleLanguage(root);
    else toggleTheme(root);
    return true;
  },
};
