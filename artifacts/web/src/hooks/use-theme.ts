import { useCallback, useEffect, useState } from "react";
import {
  useUserPreferences,
  usePreference,
} from "@/hooks/use-user-preferences";
import { getAtPath, sanitizeTheme } from "@/lib/preferences";

export type Theme = "light" | "dark";

const STORAGE_KEY = "crm.theme";

// Keep in sync with --background in index.css (:root / .dark).
const THEME_COLOR: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#000000",
};

function storedTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveInitialTheme(): Theme {
  // Explicit choice wins; otherwise follow the OS preference.
  return storedTheme() ?? systemTheme();
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Tint the browser chrome (mobile address bar, PWA title bar) to match.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[theme];
}

/** Apply the saved/system theme before React renders, to avoid a light flash. */
export function initTheme(): void {
  try {
    applyTheme(resolveInitialTheme());
  } catch {
    /* no DOM (e.g. SSR) — ignore */
  }
}

/**
 * Read + toggle the light/dark theme; server-backed (`layout.theme`) so it
 * syncs across browsers/devices. An explicit choice is mirrored to
 * localStorage so `initTheme()` can guess correctly before React (and any
 * network request) has run; users who never chose leave localStorage unset
 * and keep following the live OS preference.
 */
export function useTheme() {
  // The initial guess (same one initTheme() already applied synchronously
  // before this component mounted) doubles as usePreference's defaultValue,
  // so there's no flash/flicker while the real server value is loading.
  const initialGuess = resolveInitialTheme();
  const [rawTheme, setTheme] = usePreference<Theme>(
    "layout.theme",
    initialGuess,
  );

  // Whether the user has ever made an explicit choice, server-side — as
  // opposed to `theme` below, which is always defaulted and so can never be
  // undefined.
  const { preferences, isLoading } = useUserPreferences();
  const hasExplicitChoice = getAtPath(preferences, "layout.theme") !== undefined;

  // Live OS theme. It is only *used* while following the OS (no explicit
  // choice), but we hold it in React state so an OS light/dark switch triggers
  // a re-render that re-applies the theme WITHOUT persisting anything —
  // persisting would flip this user into an explicit-choice user. Seeded from
  // resolveInitialTheme() (which prefers any explicit localStorage mirror) so
  // that, before the server prefs have loaded, an explicit-choice user shows
  // their stored theme rather than a brief OS-derived flash.
  const [osTheme, setOsTheme] = useState<Theme>(resolveInitialTheme);

  // Explicit server-backed choice wins; otherwise follow the live OS theme.
  const theme = hasExplicitChoice
    ? (sanitizeTheme(rawTheme) ?? osTheme)
    : osTheme;

  useEffect(() => {
    applyTheme(theme);
    // Mirror to localStorage ONLY for an explicit choice: that mirror is the
    // exact signal the synchronous initTheme() reads on the next load as "the
    // user chose this". Follow-OS users must leave the key unset so initTheme()
    // falls back to the live prefers-color-scheme query — writing an
    // OS-derived value here would produce a wrong-theme flash on reload after
    // the OS theme changed between sessions.
    if (hasExplicitChoice) {
      localStorage.setItem(STORAGE_KEY, theme);
    } else if (!isLoading) {
      // Prefs have loaded and confirm no explicit choice → this user follows
      // the OS, so clear any stale mirror. Guarded by !isLoading so we don't
      // wipe an explicit user's mirror during the brief pre-fetch window
      // (when hasExplicitChoice is still false only because prefs aren't in
      // yet), which would flash the wrong theme on an offline reload.
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [theme, hasExplicitChoice, isLoading]);

  // Until the user makes an explicit choice, track live OS theme changes.
  // Apply-only: this updates the resolved/applied theme via local state and
  // must NEVER call the persisting setter — doing so would write layout.theme
  // on the first OS transition, flip hasExplicitChoice to true, and tear this
  // very listener down, freezing never-chosen users on that first value.
  useEffect(() => {
    if (hasExplicitChoice) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    // Sync once on (re)attach in case the OS changed between renders.
    setOsTheme(mq.matches ? "dark" : "light");
    const onChange = (e: MediaQueryListEvent) => {
      setOsTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [hasExplicitChoice]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, [setTheme]);

  return { theme, toggle };
}
