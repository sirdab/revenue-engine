# Fonts on the marketing pages

Self-hosted so the public pages make no third-party request. All are under the
SIL Open Font License 1.1; the notices are in `licenses/`. The files are the
unmodified WOFF2 subsets published by [Fontsource](https://fontsource.org)
(version 5.3.0 of each package).

| File | Family | Used for | Package |
|---|---|---|---|
| `geist-latin-wght-normal.woff2` | Geist (variable, 100–900) | Body and UI text | `@fontsource-variable/geist` |
| `geist-mono-latin-wght-normal.woff2` | Geist Mono (variable) | IDs, code, keyboard keys | `@fontsource-variable/geist-mono` |
| `eb-garamond-latin-wght-normal.woff2` | EB Garamond (variable, 400–800) | Headlines | `@fontsource-variable/eb-garamond` |
| `ibm-plex-sans-arabic-arabic-{400,500,600}-normal.woff2` | IBM Plex Sans Arabic | All Arabic text: body and UI (400, 500) and headlines (600, which also serves 700) | `@fontsource/ibm-plex-sans-arabic` |

The Arabic faces are declared with an Arabic `unicode-range`, so an English
page never downloads them. To update a font, replace the file with the same
subset from a newer package version and keep its licence file in step.
