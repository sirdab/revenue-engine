import { Link2 } from "lucide-react";
import type { LinkPreviewCard as LinkPreviewCardData } from "@workspace/api-client-react";

// Unfurled link preview card (R11). Text-only by default: the OG image URL is
// an external host, and loading it from the browser is a tracking-pixel vector
// the render allowlist (rich-text.tsx) deliberately avoids — so we show title,
// description, and domain, never the remote image. (Proxying preview images is
// deferred — see Scope Boundaries.)
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkPreviewCards({
  previews,
}: {
  previews: LinkPreviewCardData[];
}) {
  if (!previews.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {previews.map((p) => (
        <a
          key={p.url}
          href={p.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-gray-alpha-50"
        >
          <div className="flex items-center gap-1 text-[11px] text-subtle">
            <Link2 className="h-3 w-3" />
            <span className="truncate">{p.siteName || domainOf(p.url)}</span>
          </div>
          {p.title && (
            <div className="mt-0.5 truncate text-body font-medium text-foreground">
              {p.title}
            </div>
          )}
          {p.description && (
            <div className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
              {p.description}
            </div>
          )}
        </a>
      ))}
    </div>
  );
}
