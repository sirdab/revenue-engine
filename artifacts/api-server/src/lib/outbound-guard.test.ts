import test, { mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import {
  allowPrivateWebhookTargets,
  publicOnlyLookup,
  webhookUrlProblem,
} from "./outbound-guard.ts";

test("a public https URL may be called, on any port", () => {
  for (const url of [
    "https://hooks.example.com/crm",
    "https://example.com:8443/hook?x=1",
    "https://8.8.8.8/hook",
    "https://[2001:4860:4860::8888]/hook",
  ]) {
    assert.equal(webhookUrlProblem(url), null, url);
  }
});

test("anything but https is refused", () => {
  for (const url of ["http://example.com/hook", "ftp://example.com/x", "file:///etc/passwd", "example.com"]) {
    assert.ok(webhookUrlProblem(url), url);
  }
});

test("an IP literal on a private, local or reserved network is refused", () => {
  for (const url of [
    "https://127.0.0.1/",
    "https://127.1/", // a short spelling of 127.0.0.1
    "https://2130706433/", // and its decimal one
    "https://10.0.0.5/hook",
    "https://172.16.4.1/hook",
    "https://192.168.1.10/hook",
    "https://169.254.169.254/latest/meta-data", // cloud metadata
    "https://0.0.0.0/",
    "https://[::1]/",
    "https://[fdaa:3:8280::d]/", // a Fly private-network address
    "https://[fe80::1]/",
    "https://[::ffff:10.0.0.1]/", // IPv4-mapped
  ]) {
    assert.ok(webhookUrlProblem(url), url);
  }
});

test("a deployment can opt in to private targets, but never to plain http", () => {
  assert.equal(webhookUrlProblem("https://10.0.0.5/hook", { allowPrivate: true }), null);
  assert.equal(webhookUrlProblem("https://[fdaa::1]/hook", { allowPrivate: true }), null);
  assert.ok(webhookUrlProblem("http://10.0.0.5/hook", { allowPrivate: true }));
});

test("private targets are off unless the setting says otherwise", () => {
  assert.equal(allowPrivateWebhookTargets({}), false);
  assert.equal(allowPrivateWebhookTargets({ WEBHOOK_ALLOW_PRIVATE_ADDRESSES: "" }), false);
  assert.equal(allowPrivateWebhookTargets({ WEBHOOK_ALLOW_PRIVATE_ADDRESSES: "0" }), false);
  assert.equal(allowPrivateWebhookTargets({ WEBHOOK_ALLOW_PRIVATE_ADDRESSES: "no" }), false);
  assert.equal(allowPrivateWebhookTargets({ WEBHOOK_ALLOW_PRIVATE_ADDRESSES: "1" }), true);
  assert.equal(allowPrivateWebhookTargets({ WEBHOOK_ALLOW_PRIVATE_ADDRESSES: " True " }), true);
});

// What a name resolves to is only known when it is resolved, so the lookup the
// socket uses is where a host NAME is judged.
type Answer = { address: string; family: number }[];

function resolveWith(answer: Answer | Error) {
  return mock.method(dns, "lookup", ((_host: string, _opts: unknown, cb: (e: Error | null, a: Answer) => void) => {
    if (answer instanceof Error) cb(answer, []);
    else cb(null, answer);
  }) as unknown as typeof dns.lookup);
}

function lookup(all: boolean): Promise<{ err: Error | null; address: unknown }> {
  return new Promise((resolve) => {
    publicOnlyLookup("hook.example.test", { all }, (err, address) => resolve({ err, address }));
  });
}

test("a name that resolves only to private addresses is never connected to", async (t) => {
  const stub = resolveWith([
    { address: "10.0.0.7", family: 4 },
    { address: "fdaa:3:8280::d", family: 6 },
  ]);
  t.after(() => stub.mock.restore());
  for (const all of [true, false]) {
    const { err } = await lookup(all);
    assert.match(String(err), /blocked non-public address/);
  }
});

test("a name with mixed answers is connected to on its public addresses only", async (t) => {
  const stub = resolveWith([
    { address: "192.168.1.9", family: 4 },
    { address: "93.184.216.34", family: 4 },
    { address: "::1", family: 6 },
  ]);
  t.after(() => stub.mock.restore());
  assert.deepEqual((await lookup(true)).address, [{ address: "93.184.216.34", family: 4 }]);
  assert.equal((await lookup(false)).address, "93.184.216.34");
});

test("a name that does not resolve fails as it always did", async (t) => {
  const stub = resolveWith(new Error("ENOTFOUND"));
  t.after(() => stub.mock.restore());
  assert.match(String((await lookup(true)).err), /ENOTFOUND/);
});
