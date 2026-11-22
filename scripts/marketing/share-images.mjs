#!/usr/bin/env node
// Redraws the share images (artifacts/web/public/og-en.jpg, og-ar.jpg) from
// the landing page's own hero, so a link preview always shows the real page.
// Run it after the hero's copy or product window changes:
//
//   node scripts/marketing/share-images.mjs <site url> [out dir]
//
// `site url` is a running copy of the site: `pnpm dev` (http://localhost:3210)
// or the deployed one. See browser.mjs for how to run it.
import path from "node:path";
import { launch } from "./browser.mjs";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: node scripts/marketing/share-images.mjs <site url> [out dir]");
  process.exit(2);
}
const out = path.resolve(
  process.argv[3] ?? path.join(import.meta.dirname, "../../artifacts/web/public"),
);

// The hero, rearranged for a 1200x630 card: the brand and headline at the
// leading edge, the product window below, everything else out of the frame.
const card = (locale) => `
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .skip, .hero__cta, .hero__note, .chip, .hero__copy .lead, .nav__actions, .nav__sheet, .drawer { display: none !important; }
  html, body { overflow: hidden !important; }
  .nav { position: absolute !important; inset-block-start: 44px !important; }
  .nav__row { width: 1072px !important; }
  .nav__tile { background: none !important; box-shadow: none !important; backdrop-filter: none !important; padding: 0 !important; height: auto !important; }
  .nav__brand { font-size: 25px !important; gap: 14px !important; padding: 0 !important; }
  .nav__mark { width: 40px !important; height: 40px !important; border-radius: 10px !important; }
  .hero { padding: 132px 0 0 !important; height: 630px !important; }
  .hero__copy { width: 1072px !important; justify-items: start !important; text-align: start !important; }
  .hero__copy .display { font-size: ${locale === "ar" ? 84 : 80}px !important; max-width: none !important; }
  .hero__stage { width: 1072px !important; margin-top: 54px !important; }
  .hero__glow { inset-block: 18% 0 !important; }
  .app { font-size: 11.6px !important; }
  .app__window { height: 60em !important; }
  .deal--held { translate: 0 0 !important; }
`;

const browser = await launch();
for (const [locale, route] of [
  ["en", "/"],
  ["ar", "/ar"],
]) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: card(locale) });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const file = path.join(out, `og-${locale}.jpg`);
  await page.screenshot({
    path: file,
    type: "jpeg",
    quality: 90,
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await context.close();
  console.log("wrote", file);
}
await browser.close();
