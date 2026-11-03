import type { ReactNode } from "react";

// Detects http(s) URLs and bare "www."-prefixed domains in plain text and
// renders them as real, clickable links; everything else passes through as
// plain text. Mirrors the http(s)-only href allowlist other read-view
// renderers in this app use for user-typed text (e.g. rich-text.tsx's
// safeHref) — we never turn a javascript:/data: scheme into a clickable href.
const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Splitting on a single-capture-group regex interleaves plain text (even
// indices) with the captured URL matches (odd indices) — see MDN's
// String.prototype.split with a capturing-group separator.
export function linkifyText(text: string): ReactNode[] {
  return text.split(URL_PATTERN).map((part, i) => {
    if (!part) return null;
    if (i % 2 === 0) return part;

    const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const url = trailing ? part.slice(0, part.length - trailing.length) : part;

    return (
      <span key={i}>
        <a
          href={toHref(url)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          // Clicking a link focuses it, and React's onFocus (backed by the
          // bubbling `focusin`) would otherwise reach the read-view div's own
          // onFocus and flip it into edit mode before the browser navigates —
          // stopping only the click's propagation isn't enough.
          onFocus={(e) => e.stopPropagation()}
          className="text-teal-700 underline underline-offset-2"
        >
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}
