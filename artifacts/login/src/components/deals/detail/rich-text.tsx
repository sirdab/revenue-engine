import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MENTION_CLASS } from "./rich-note-editor";

// Renders stored note/comment content safely.
//
// Notes are persisted as light HTML (legacy entries wrap text in <div>/<br> and
// leak entities like &nbsp;). We parse that markup and re-emit it as a fixed
// allowlist of React elements we construct ourselves — so tags and entities are
// never shown as literal text, and untrusted markup (e.g. <script>, onclick,
// javascript: URLs) can never execute. We never use dangerouslySetInnerHTML.

// Inline formatting we preserve; everything else degrades to its text content.
const INLINE_TAGS: Record<string, "strong" | "em" | "u" | "s"> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  s: "s",
  strike: "s",
  del: "s",
};
const BLOCK_TAGS = new Set(["p", "div", "li"]);

function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  const href = raw.trim();
  return /^(https?:|mailto:|tel:)/i.test(href) ? href : null;
}

// Inline images are ONLY ever our own attachment blobs, served same-origin at
// /api/files/<id>/content. Validate by parsing the attribute as a URL against
// the current origin and matching the pathname exactly — a pathname check, not
// a string prefix, so protocol-relative `//evil.com/...`, external hosts, path
// traversal, and query strings are all rejected. Anything else renders nothing.
const FILE_CONTENT_PATH = /^\/api\/files\/\d+\/content$/;
function safeImageSrc(raw: string | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.search || url.hash) return null;
  if (!FILE_CONTENT_PATH.test(url.pathname)) return null;
  return url.pathname;
}

function renderNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = renderChildren(el);

  // @mention chip — re-emit as our own styled span (text only, never markup).
  if (el.hasAttribute("data-mention")) {
    return (
      <span key={key} className={MENTION_CLASS}>
        {el.textContent}
      </span>
    );
  }

  if (tag === "br") return <br key={key} />;
  if (tag === "a") {
    const href = safeHref(el.getAttribute("href"));
    return href ? (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-brand underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <Fragment key={key}>{children}</Fragment>
    );
  }
  if (tag === "ul") return <ul key={key} className="list-disc ps-5">{children}</ul>;
  if (tag === "ol") return <ol key={key} className="list-decimal ps-5">{children}</ol>;

  // Inline image attachment. Emit a fresh element carrying only a validated
  // src + alt + lazy loading — never copy through other attributes (onerror,
  // srcset, style), which is how a stored <img> could smuggle script/leaks.
  if (tag === "img") {
    const src = safeImageSrc(el.getAttribute("src"));
    if (!src) return null;
    // Lazy-loaded, size-bounded, and click-to-open full size in a new tab.
    return (
      <a
        key={key}
        href={src}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 block w-fit"
      >
        <img
          src={src}
          alt={el.getAttribute("alt") ?? ""}
          loading="lazy"
          className="max-h-96 max-w-full rounded-md border border-border"
        />
      </a>
    );
  }

  // Code block: <pre><code>…</code></pre>. Emit clean elements (no class/style
  // passthrough); children are text/inline only.
  if (tag === "pre") {
    return (
      <pre
        key={key}
        className="my-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-[13px]"
      >
        {children}
      </pre>
    );
  }
  if (tag === "code") {
    // Inline code outside a <pre> gets a subtle chip; inside <pre> the parent
    // styles it, so keep this element unstyled-but-monospace either way.
    return (
      <code key={key} className="rounded-sm bg-muted px-1 py-0.5 text-[13px]">
        {children}
      </code>
    );
  }

  const inline = INLINE_TAGS[tag];
  if (inline) {
    const Tag = inline;
    return <Tag key={key}>{children}</Tag>;
  }
  if (BLOCK_TAGS.has(tag)) {
    // <div dir="rtl">…</div> — honour an explicit direction, default to auto.
    const dir = el.getAttribute("dir");
    return (
      <div key={key} dir={dir === "rtl" || dir === "ltr" ? dir : "auto"}>
        {children}
      </div>
    );
  }
  // Unknown/unsafe element: keep its text, drop the wrapper.
  return <Fragment key={key}>{children}</Fragment>;
}

function renderChildren(parent: Element): ReactNode[] {
  return Array.from(parent.childNodes).map((child, i) => renderNode(child, i));
}

export function RichText({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const hasMarkup = Array.from(doc.body.childNodes).some(
    (n) => n.nodeType === Node.ELEMENT_NODE,
  );

  // Pure plain text: keep its line breaks (pre-wrap). Real markup already
  // carries its own block structure, so pre-wrap would inject blank lines.
  if (!hasMarkup) {
    return (
      <div dir="auto" className={cn("whitespace-pre-wrap", className)}>
        {doc.body.textContent}
      </div>
    );
  }

  return (
    <div dir="auto" className={className}>
      {renderChildren(doc.body)}
    </div>
  );
}
