import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Encryption at rest for the secrets a workspace hands us (its AI provider
// key). AES-256-GCM, with the key derived from SESSION_SECRET by HKDF, so a
// database dump alone does not reveal them.
//
// SESSION_SECRET is already the one secret a deploy must keep stable (it signs
// the session cookies). Rotating it signs everyone out AND makes these values
// unreadable: `openSecret` then returns null and the workspace re-enters its
// key, which the settings card asks for.
//
// Sealed format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.

const VERSION = "v1";
const INFO = "revenue-engine/app-settings/v1";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to store secrets.");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), INFO, 32));
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** The plain value, or null when the value is malformed or was sealed under another key. */
export function openSecret(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
