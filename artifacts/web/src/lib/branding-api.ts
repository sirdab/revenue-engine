import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// The workspace's logo (Settings › Workspace), shown in place of the default
// mark in the sidebar. Hand-written fetch like the other settings/* routes.

const KEY = ["workspace-branding"];

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

/** The logo as a data URL, or null. Only fetched while signed in. */
export function useWorkspaceLogo(enabled: boolean) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () =>
      json<Branding>(await fetch("/api/settings/branding", { credentials: "same-origin" })),
    enabled,
    staleTime: 5 * 60_000,
    select: (d) => d.logo,
  });
}

export function useSetWorkspaceLogo() {
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
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
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
