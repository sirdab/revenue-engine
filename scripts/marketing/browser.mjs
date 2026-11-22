// Finds a headless Chromium for the scripts in this folder.
//
// The repo does not depend on Playwright (the workspace's supply-chain guard
// keeps its dependency list short), so these scripts are run from a scratch
// folder that has it:
//
//   mkdir /tmp/shots && cd /tmp/shots && npm init -y && npm install playwright-core
//   node /path/to/repo/scripts/marketing/share-images.mjs https://crm.example.com
//
// `playwright-core` is resolved from the folder the script is RUN in, and it
// downloads nothing: the browser is one Playwright has already cached on this
// machine, or the path in CHROMIUM_PATH.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

function cachedHeadlessShell() {
  const caches = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
  ];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const builds = readdirSync(cache)
      .filter((d) => d.startsWith("chromium_headless_shell-"))
      .sort();
    for (const build of builds.reverse()) {
      const dir = path.join(cache, build);
      for (const flavour of readdirSync(dir)) {
        const exe = path.join(dir, flavour, "chrome-headless-shell");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

/** `args`: extra command-line switches for the browser. */
export async function launch(args = []) {
  let chromium;
  try {
    const require = createRequire(path.join(process.cwd(), "index.js"));
    ({ chromium } = require("playwright-core"));
  } catch {
    throw new Error(
      "playwright-core was not found in the current folder. Run this from a scratch folder after `npm install playwright-core` (see scripts/marketing/README.md).",
    );
  }
  const executablePath = process.env.CHROMIUM_PATH ?? cachedHeadlessShell();
  if (!executablePath) {
    throw new Error("No Chromium found. Set CHROMIUM_PATH to a Chrome or Chromium binary.");
  }
  return chromium.launch({ executablePath, headless: true, args });
}
