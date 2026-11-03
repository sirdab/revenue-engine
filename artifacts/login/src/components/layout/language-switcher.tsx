import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/i18n";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_INFO,
  isLocale,
  type Locale,
} from "@/lib/i18n/locales";

// The language switcher. Language is a property of the person
// rather than of the screen, so it is an account-level preference and not a
// per-page control.
//
// It is offered TWICE, deliberately. `LanguageToggle` is a button in the
// topbar beside the theme toggle; `LanguageMenuSection` is the labelled list
// in the account menu. The menu entry alone was the original design, on the
// reasoning that account preferences belong in the account menu -- which is
// a sound answer to where it belongs and no answer at all to whether anyone
// can find it. The first person to look for it could not: it sat two clicks
// deep behind an unlabelled avatar while the theme, which is no more
// switchable, had a button of its own in plain sight.
//
// The toggle is a plain button rather than a dropdown because there are two
// languages; if a third is ever added it must become a menu, and the
// account-menu list is already that menu.
//
// Each language is named in itself -- somebody looking for Arabic is looking
// for "العربية", not for "Arabic" -- with the English name alongside so an
// English reader who opened this by accident can find their way back.

/** The language a single click would move to. With two locales this is "the
 *  other one"; it is written as a search so adding a third fails loudly at
 *  the type level rather than silently toggling between the first two. */
function nextLocale(current: Locale): Locale {
  return LOCALES.find((code) => code !== current) ?? DEFAULT_LOCALE;
}

/**
 * One-click en <-> ar, in the topbar next to the theme toggle.
 *
 * Shows the language it would switch TO, not the one in use: the label is a
 * button, so it says what pressing it does. The script itself is the icon --
 * "ع" is unmistakable to a reader of either language in a way a globe is not.
 */
export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const target = nextLocale(locale);
  const info = LOCALE_INFO[target];

  return (
    <button
      type="button"
      onClick={() => setLocale(target)}
      aria-label={t("language.switchTo", { language: info.englishName })}
      title={t("language.switchTo", { language: info.nativeName })}
      className={cn(
        "flex h-9 min-w-9 flex-shrink-0 items-center justify-center gap-1 rounded-md px-2",
        "text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <Languages className="h-5 w-5 shrink-0" />
      <span
        dir={info.dir}
        aria-hidden="true"
        className="text-xs font-semibold leading-none"
      >
        {/* The target language's own name, kept to the script's shortest
            recognisable form so the button stays a button and not a word. */}
        {target === "ar" ? "ع" : "EN"}
      </span>
    </button>
  );
}

export function LanguageMenuSection() {
  const { locale, setLocale, t } = useI18n();

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-slate-500">
        <Languages className="h-3.5 w-3.5" />
        {t("language.label")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={locale}
        onValueChange={(next) => {
          // Radix hands back a plain string; anything but a known locale
          // would otherwise be written straight into the preferences
          // document and come back as a language that does not exist.
          if (isLocale(next)) setLocale(next);
        }}
      >
        {LOCALES.map((code) => {
          const info = LOCALE_INFO[code];
          return (
            <DropdownMenuRadioItem
              key={code}
              value={code}
              className="cursor-pointer"
            >
              <span dir={info.dir} className="font-medium">
                {info.nativeName}
              </span>
              {info.nativeName !== info.englishName && (
                <span className="ms-2 text-xs text-slate-400">
                  {info.englishName}
                </span>
              )}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
}
