# Internationalisation

The app speaks English and Arabic. This folder is the whole mechanism.

## Status

**`ar.json` is an AI-authored draft and has NOT been reviewed by a native
speaker yet.** Get it reviewed before shipping Arabic to customers.

## How it fits together

| File | What it is |
|---|---|
| `locales.ts` | Which languages exist, and their direction/tag. No messages, so `initLocale()` can run before React. |
| `en.json` / `ar.json` | Flat, dotted-key dictionaries. English is the source of truth for which keys exist. |
| `translate.ts` | Pure lookup, interpolation and plural selection. Unit-tested. |
| `formatting.ts` | Numbers, currency and dates. **The digit decision lives here.** |
| `i18n.tsx` | The provider, `useI18n()`, and `initLocale()`. |
| `../../components/layout/language-switcher.tsx` | The switcher, offered twice: a topbar toggle and an account-menu list. |
| `locale-parity.test.ts` | Fails the build when the dictionaries drift apart. |

## Adding a message

1. Add the key to `en.json` **and** `ar.json`. Flat and dotted, e.g.
   `"deals.field.lostReason"`.
2. For anything counted, add `key#one`/`key#other` to English and all six of
   `zero/one/two/few/many/other` to Arabic, then call `tPlural`. Arabic
   grammar needs six forms and a `count === 1` ternary gets it wrong in a way
   an English speaker cannot see.
3. `pnpm --filter @workspace/web run test` — the parity test tells you what
   you missed.

```tsx
const { t, tPlural } = useI18n();
t("deals.field.lostReason");
t("auth.signup.welcomeTitle", { workspace: workspace.name });
tPlural("deals.merge.files", files.length);
```

## Rules that are not style preferences

**Direction is per route; language is per component.** A shared component
translated in phase 1 shows its Arabic wherever it renders, including on
pages that are otherwise English. That is progress, not a bug.

**Use logical Tailwind classes** — `ms-`/`me-`/`ps-`/`pe-`/`text-start`/
`text-end`/`start-`/`end-`, never `ml-`/`mr-`/`pl-`/`pr-`/`text-left`/
`text-right`/`left-`/`right-`. A physical class pins an element to one side
of the screen and does the wrong thing the moment the page is RTL. The whole
frontend was swept over to logical classes in one commit; keep it that way.

**User-entered data gets `dir="auto"`.** An organization name, an activity
subject, a typed note: the browser decides its direction from its own first strong
character, because an Arabic name inside an English page and an English name
inside an Arabic page both have to read correctly. This predates i18n in this
codebase and is why record names already carry it.

**The switcher is offered twice on purpose.** `LanguageToggle` is a button in
the topbar beside the theme toggle; `LanguageMenuSection` is the labelled list
in the account menu. The menu entry alone was the original design and it
failed its first contact with a user, who could not find it: it sat two clicks
deep behind an unlabelled avatar while the theme, no more switchable, had a
button in plain sight. The toggle is a plain button because there are two
languages. A third makes it a menu — and the account-menu list already is one.

**Never concatenate a sentence from fragments.** Word order differs; pass
placeholders and let the translation put them where that language needs them.
