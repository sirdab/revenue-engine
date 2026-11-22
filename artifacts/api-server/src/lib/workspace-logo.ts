import { clearSetting, getSetting, setSetting } from "./app-settings";

// The workspace's own logo, shown in place of the default mark at the top of
// the sidebar for everyone in the workspace (Settings › Workspace).
//
// Kept in `app_settings` as a data URL rather than in object storage: the
// browser shrinks the image to at most 256px before upload, so it is a few
// tens of KB, every machine can serve it without S3, and a self-hosted
// install without storage still gets it.
//
// Raster formats only. An SVG can carry script, and this one is served from
// the app's own origin.

const LOGO_KEY = "workspace_logo";
export const MAX_LOGO_BYTES = 300 * 1024;

const TYPES = {
  "image/png": (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b: Buffer) =>
    b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
} as const;

export class LogoError extends Error {}

/**
 * Checks a `data:image/...;base64,` URL: an allowed type, a body that really
 * is that type (by its magic bytes, not the label), and within the size cap.
 */
export function parseLogoDataUrl(value: unknown): string {
  if (typeof value !== "string") throw new LogoError("Send the logo as an image data URL.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new LogoError("The logo must be a PNG, JPEG or WebP image.");
  const type = match[1] as keyof typeof TYPES;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) throw new LogoError("The logo image is empty.");
  if (bytes.length > MAX_LOGO_BYTES) throw new LogoError("The logo is too large (300 KB at most).");
  if (!TYPES[type](bytes)) throw new LogoError("The file isn't a valid PNG, JPEG or WebP image.");
  return value;
}

export async function getWorkspaceLogo(): Promise<string | null> {
  return getSetting(LOGO_KEY);
}

export async function setWorkspaceLogo(dataUrl: string): Promise<void> {
  await setSetting(LOGO_KEY, parseLogoDataUrl(dataUrl));
}

export async function clearWorkspaceLogo(): Promise<void> {
  await clearSetting(LOGO_KEY);
}
