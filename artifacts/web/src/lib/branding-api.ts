import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// The workspace's logo (Settings › Workspace), shown in place of the default
// mark in the sidebar. Hand-written fetch like the other settings/* routes.

const KEY = ["workspace-branding"];

// The last logo seen, per workspace, so the sidebar can draw it on the first
// frame of the next visit instead of flashing the default mark while the
// request is in flight. A per-viewer convenience: the server stays the source
// of truth and the query still refetches.
const cacheKey = (tenantId: number) => `crm.workspaceLogo.${tenantId}`;

function readCached(tenantId: number | undefined): Branding | undefined {
  if (tenantId == null) return undefined;
  try {
    const raw = localStorage.getItem(cacheKey(tenantId));
    return raw === null ? undefined : { logo: raw || null };
  } catch {
    return undefined;
  }
}

function writeCached(tenantId: number | undefined, logo: string | null): void {
  if (tenantId == null) return;
  try {
    localStorage.setItem(cacheKey(tenantId), logo ?? "");
  } catch {
    // Storage full or blocked: the logo still loads, just not instantly.
  }
}

interface Branding {
  logo: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * The logo as a data URL, or null. Only fetched while signed in (`tenantId`
 * set). Starts from the last logo this browser saw for the workspace.
 */
export function useWorkspaceLogo(tenantId: number | undefined) {
  return useQuery({
    queryKey: [...KEY, tenantId],
    queryFn: async () => {
      const data = await json<Branding>(
        await fetch("/api/settings/branding", { credentials: "same-origin" }),
      );
      writeCached(tenantId, data.logo);
      return data;
    },
    enabled: tenantId != null,
    initialData: () => readCached(tenantId),
    // The cached copy may be stale: always confirm it with the server.
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    select: (d) => d.logo,
  });
}

export function useSetWorkspaceLogo(tenantId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (logo: string | null) =>
      json<Branding>(
        await fetch("/api/settings/branding/logo", {
          method: logo ? "PUT" : "DELETE",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: logo ? JSON.stringify({ logo }) : undefined,
        }),
      ),
    onSuccess: (data) => {
      writeCached(tenantId, data.logo);
      queryClient.setQueryData([...KEY, tenantId], data);
    },
  });
}

const MAX_SIDE = 256;
const MAX_BYTES = 300 * 1024;

/**
 * Reads an image file and redraws it at most 256px on its longer side, as
 * PNG (keeps transparency), falling back to WebP if the PNG is still too
 * large. Any image the browser can draw works, SVG included, and what is
 * uploaded is always a small raster.
 */
export async function prepareLogo(file: File): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = src;
    });
    const w = img.naturalWidth || MAX_SIDE;
    const h = img.naturalHeight || MAX_SIDE;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (png.length * 0.75 <= MAX_BYTES) return png;
    return canvas.toDataURL("image/webp", 0.9);
  } finally {
    URL.revokeObjectURL(src);
  }
}
