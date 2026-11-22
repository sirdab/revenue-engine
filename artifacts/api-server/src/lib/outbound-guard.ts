// Requests this server makes to an address a workspace chose.
//
// An automation's "call a webhook" action sends an HTTP request from here to a
// URL a workspace admin typed in. On a deployment anyone can sign up to, that
// admin is anyone on the internet, while the server usually sits on a private
// network beside databases and internal services that trust it. A webhook
// aimed at one of those (by address, by a DNS name that resolves to one, or by
// a public URL that redirects to one) would make this server a way in.
//
// So such a call only ever goes to a public address:
//   - the URL must be https, and an IP-literal host must be a public one
//     (`webhookUrlProblem`, checked when the automation is saved and again
//     when it fires);
//   - a host name is resolved here and only its public addresses are handed to
//     the socket (`publicOnlyLookup`), so the address checked is the address
//     connected to, with no window for the name to change in between;
//   - the caller must not follow redirects.
//
// A single-tenant deployment whose webhooks legitimately point at its own
// private network can turn the address rule off with
// WEBHOOK_ALLOW_PRIVATE_ADDRESSES=1. Never set that where sign-up is open.
//
// No database imports: this is unit-tested on its own.

import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { isGlobalUnicastAddress } from "./link-preview-validation";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for http(s).request that resolves the name, then offers the
 * socket only global-unicast (public) addresses. Private, loopback,
 * link-local, unique-local (Fly's fdaa::/16 among them) and reserved
 * addresses are never connected to; a name with nothing else fails.
 */
export function publicOnlyLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions,
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    // Keep every public candidate. The socket only ever connects to an address
    // returned here, so validating all of them closes the DNS-rebinding window
    // whichever one Happy Eyeballs races to.
    const safe = addresses.filter((a) => isGlobalUnicastAddress(a.address));
    if (safe.length === 0) {
      callback(new Error(`blocked non-public address for ${hostname}`), "", 0);
      return;
    }
    // Node's connect path enables autoSelectFamily (Happy Eyeballs) by default
    // since Node 20, calling lookup with { all: true } and REQUIRING the
    // array-form callback. Answering with the single-address form makes Node
    // read the address string as the address list ("Invalid IP address:
    // undefined"), so every request fails. Honor whichever form was requested.
    if (options.all) {
      callback(null, safe);
    } else {
      callback(null, safe[0].address, safe[0].family);
    }
  });
}

/** Whether this deployment lets webhooks reach private addresses. Off unless asked for. */
export function allowPrivateWebhookTargets(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.WEBHOOK_ALLOW_PRIVATE_ADDRESSES?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Why a webhook URL may not be called, or null when it may. Looks only at the
 * URL: a host NAME is judged when it is resolved (`publicOnlyLookup`), since
 * what it points at can change after this check.
 */
export function webhookUrlProblem(
  urlStr: string,
  { allowPrivate = false }: { allowPrivate?: boolean } = {},
): string | null {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return "Webhook URL is not a valid URL.";
  }
  if (url.protocol !== "https:") return "Webhook URL must use https://";
  if (allowPrivate) return null;
  // Node skips the `lookup` hook for an IP literal, so the literal is checked
  // here or not at all. (URL keeps the brackets on an IPv6 literal.)
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isGlobalUnicastAddress(host)) {
    return "Webhook URL must be a public address, not a private or local one.";
  }
  return null;
}

/**
 * One request to a webhook URL, answered with its status code.
 *
 * Not `fetch`: this has to decide which address the socket may connect to
 * (`publicOnlyLookup`, unless the deployment allows private targets), and it
 * must not follow redirects, which `https.request` never does. A redirect is
 * simply the status the caller gets back, because following one would let a
 * public URL hand the request on to a private address.
 *
 * Callers check `webhookUrlProblem` first: an IP-literal host never reaches
 * the lookup.
 */
export function sendToWebhook(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  { allowPrivate = false, timeoutMs = 5000 }: { allowPrivate?: boolean; timeoutMs?: number } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: init.method,
        headers: {
          ...init.headers,
          "content-length": String(Buffer.byteLength(init.body)),
        },
        ...(allowPrivate ? {} : { lookup: publicOnlyLookup }),
      },
      (res) => {
        // Only the status matters; drain the body so the socket is released.
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    // A wall-clock limit, from the first byte out to the status line back.
    // (http.request's own `timeout` option only measures socket inactivity.)
    const timer = setTimeout(
      () => req.destroy(new Error(`webhook timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end(init.body);
  });
}
