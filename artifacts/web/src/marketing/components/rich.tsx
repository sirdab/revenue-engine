import { Fragment, type ReactNode } from "react";
import { PAGES, SITE, pagePath, repoFile, type Locale, type PageId } from "../site";

// Copy may name a link target instead of spelling out its URL, so the same
// sentence works in every language and a moved page is fixed in one place.
const NAMED: Record<string, string> = {
  github: SITE.githubUrl,
  license: SITE.licenseUrl,
  company: SITE.companyUrl,
  one: SITE.designSystemUrl,
  trademarks: repoFile("TRADEMARKS.md"),
  contributing: repoFile("CONTRIBUTING.md"),
  security: repoFile("SECURITY.md"),
  deploy: repoFile("DEPLOY.md"),
  schema: repoFile("SCHEMA.md"),
};

export function resolveHref(target: string, locale: Locale): string {
  if ((PAGES as readonly string[]).includes(target)) {
    return pagePath(target as PageId, locale);
  }
  return NAMED[target] ?? target;
}

export const isExternal = (href: string): boolean => /^https?:\/\//.test(href);

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g;

/**
 * Inline markup for copy: `**strong**`, `[label](target)` and `` `code` ``.
 * Everything else is text, escaped by React like any other string.
 */
export function Rich({ text, locale }: { text: string; locale: Locale }): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = resolveHref(link[2], locale);
      return (
        <a key={i} className="link" href={href} {...(isExternal(href) ? { rel: "noopener" } : {})}>
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
