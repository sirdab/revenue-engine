# Internationalisation

The app speaks English and Arabic (right-to-left). This folder is the whole
mechanism.

`ar.json` was drafted with AI assistance; corrections from native speakers
are welcome.

## How it fits together

| File | What it is |
|---|---|
| `locales.ts` | Which languages exist, and their direction/tag. No messages, so `initLocale()` can run before React. |
| `en.json` / `ar.json` | Flat, dotted-key dictionaries. English is the source of truth for which keys exist. |
| `translate.ts` | Pure lookup, interpolation and plural selection. Unit-tested. |
| `formatting.ts` | Numbers, currency and dates. **The digit decision lives here.** |
| `i18n.tsx` | The provider, `useI18n()`, and `initLocale()`. |
| `static.ts` | `tStatic()` for plain modules with no component to translate in. |
| `../../components/layout/language-switcher.tsx` | The switcher, offered twice: a topbar toggle and an account-menu list. |
| `locale-parity.test.ts` | Fails the build when the dictionaries drift apart. |

## Adding a message

1. Add the key to `en.json` **and** `ar.json`. Flat and dotted, e.g.
   `"deals.table.value"`.
2. For anything counted, add `key#one`/`key#other` to English and all six of
   `zero/one/two/few/many/other` to Arabic, then call `tPlural`. Arabic
   grammar needs six forms and a `count === 1` ternary gets it wrong in a way
   an English speaker cannot see.
3. `pnpm --filter @workspace/login run test` — the parity test tells you what
   you missed.

```tsx
const { t, tPlural, formatCurrency } = useI18n();
t("deals.table.value");
t("deals.wonBy", { name: owner.name });
tPlural("deals.count", deals.length);
formatCurrency(amount);
```

## Rules that are not style preferences

**Use logical Tailwind classes** — `ms-`/`me-`/`ps-`/`pe-`/`text-start`/
`text-end`/`start-`/`end-`, never `ml-`/`mr-`/`pl-`/`pr-`/`text-left`/
`text-right`/`left-`/`right-`. A physical class pins an element to one side
of the screen and does the wrong thing the moment the page is RTL.

**User-entered data gets `dir="auto"`.** An organization name, an activity
subject, a note: the browser decides its direction from its own first strong
character, because an Arabic name inside an English page and an English name
inside an Arabic page both have to read correctly.

**The switcher is offered twice on purpose.** `LanguageToggle` is a button in
the topbar beside the theme toggle; `LanguageMenuSection` is the labelled list
in the account menu. A menu entry alone was too hard to find.

**Never concatenate a sentence from fragments.** Word order differs; pass
placeholders and let the translation put them where that language needs them.
