# Marketing assets

Two images on the public pages are generated rather than drawn by hand. These
scripts regenerate them. Neither runs during a build: their output is
committed.

| Script | Output | Run it when |
|---|---|---|
| `share-images.mjs` | `artifacts/web/public/og-{en,ar}.jpg`, the 1200×630 link-preview images | the landing hero's headline or product window changes |
| `backdrops.mjs` | the marbled textures in `artifacts/web/src/marketing/art/` | you want a new backdrop or different colours |

Both drive a headless Chromium through `playwright-core`, which the repo does
not depend on. Run them from a scratch folder that has it:

```bash
mkdir /tmp/marketing-shots && cd /tmp/marketing-shots
npm init -y && npm install playwright-core

# with `pnpm dev` running in the repo
node /path/to/repo/scripts/marketing/share-images.mjs http://localhost:3210

node /path/to/repo/scripts/marketing/backdrops.mjs ./backdrops
cwebp -q 78 -m 6 backdrops/copper.png -o /path/to/repo/artifacts/web/src/marketing/art/copper.webp
```

The browser is one Playwright has already cached on the machine; set
`CHROMIUM_PATH` to use another Chrome or Chromium.
