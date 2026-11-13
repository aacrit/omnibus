// R2 through its S3-compatible API with bucket-scoped credentials (CoS
// decision, 2026-11-13): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and
// R2_SECRET_ACCESS_KEY, an R2 API token with Object Read & Write on the named
// buckets only, so a leaked key cannot touch the rest of the account. No
// dependency: AWS Signature V4 is signed here (node:crypto), requests go
// through fetch, and syncS3 runs that client on a worker thread so the
// capture's synchronous store interface (scripts/lib/capture-store.mjs commit,
// scripts/lib/week-sources.mjs r2Reader) is unchanged.
//
// Founder's one-time setup (Cloudflare dashboard):
//   R2 -> Manage API tokens -> Create API token -> Permissions: Object Read & Write
//   -> Specify buckets: omnibus-capture and omnibus -> Create. Copy the Access
//   Key ID, the Secret Access Key and the account id into the repo secrets
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ACCOUNT_ID.
// An R2 token carries one permission for every bucket it names; the code
// reads `omnibus` only through readOnly(), which has no put or delete.

import { createHash, createHmac } from "node:crypto";
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";

export const ENV_NAMES = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
// RFC 3986 encoding of one path segment or query value, as SigV4 wants it.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** R2 credentials from an environment, or null when any is missing. */
export function r2Config(env = process.env) {
  if (!ENV_NAMES.every((k) => String(env[k] ?? "").trim())) return null;
  return { accountId: env.R2_ACCOUNT_ID.trim(), accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() };
}

/**
 * Pure: AWS Signature V4 headers for one request. `url` is absolute; headers
 * are lower-case names; body is a Buffer or string (or empty). Returns the
 * headers to send (the given ones plus x-amz-date, x-amz-content-sha256 and
 * authorization).
 */
export function signV4({ method, url, headers = {}, body = "", accessKeyId, secretAccessKey, region = "auto", service = "s3", now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = headers["x-amz-content-sha256"] ?? sha256hex(body ?? "");
  const all = { ...headers, host: u.host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const canonHeaders = names.map((k) => `${k}:${String(all[k]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signed = names.join(";");
  const path = u.pathname.split("/").map((seg) => enc(decodeURIComponent(seg))).join("/");
  const query = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [method, path, query, canonHeaders, signed, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

/** The object URL for a bucket and key on the account's R2 endpoint. */
export function objectUrl(accountId, bucket, key = "", query = "", endpoint = null) {
  const k = String(key).split("/").map(enc).join("/");
  const base = endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`;
  return `${base}/${enc(bucket)}${key ? `/${k}` : ""}${query ? `?${query}` : ""}`;
}

/** Pure: the keys and sizes of a ListObjectsV2 answer, and its continuation token. */
export function parseList(xml) {
  const items = [...String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? ""),
    size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0),
  }));
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
  return { items, next: truncated && next ? decodeXml(next) : null };
}

function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** The async client: get, put (optionally conditional), delete, list. Errors never carry the secret. */
export function s3Client(cfg, { fetchImpl = fetch, now = () => new Date(), timeoutMs = 120_000 } = {}) {
  const call = async (method, url, { body, headers = {} } = {}) => {
    const h = signV4({ method, url, headers, body: body ?? "", accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, now: now() });
    delete h.host;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(url, { method, headers: h, body: body ?? undefined, signal: AbortSignal.timeout(timeoutMs) });
        if (res.status >= 500 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= 2) throw new Error(`R2 ${method} ${new URL(url).pathname}: ${String(err?.message ?? err).split(cfg.secretAccessKey).join("[REDACTED]")}`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  };
  const fail = async (res, what) => new Error(`R2 ${what} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return {
    async get(bucket, key) {
      const res = await call("GET", objectUrl(cfg.accountId, bucket, key, "", cfg.endpoint));
      if (res.status === 404) return null;
      if (!res.ok) throw await fail(res, `GET ${key}`);
      return { body: Buffer.from(await res.arrayBuffer()), etag: res.headers.get("etag") };
    },
    async put(bucket, key, body, { contentType = "application/octet-stream", ifMatch = null, ifNoneMatch = null } = {}) {
      const headers = { "content-type": contentType };
      if (ifMatch) headers["if-match"] = ifMatch;
      if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
      const res = await call("PUT", objectUrl(cfg.accountId, bucket, key, "", cfg.endpoint), { body: Buffer.from(body), headers });
      if (res.status === 412) return { ok: false, status: 412 };
      if (!res.ok) throw await fail(res, `PUT ${key}`);
      return { ok: true, etag: res.headers.get("etag") };
    },
    async delete(bucket, key) {
      const res = await call("DELETE", objectUrl(cfg.accountId, bucket, key, "", cfg.endpoint));
      if (!res.ok && res.status !== 404) throw await fail(res, `DELETE ${key}`);
    },
    async list(bucket, prefix) {
      const out = [];
      let token = null;
      do {
        const q = new URLSearchParams({ "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
        const res = await call("GET", objectUrl(cfg.accountId, bucket, "", q.toString(), cfg.endpoint));
        if (!res.ok) throw await fail(res, `LIST ${prefix}`);
        const page = parseList(await res.text());
        out.push(...page.items);
        token = page.next;
      } while (token);
      return out;
    },
  };
}

// The worker thread: the async client behind a synchronous call.
const WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
parentPort.once("message", async ({ port, flag, modUrl }) => {
  const { s3Client } = await import(modUrl);
  const client = s3Client(workerData);
  port.on("message", async ({ op, args }) => {
    let reply;
    try { reply = { value: await client[op](...args) }; } catch (err) { reply = { error: String(err && err.message || err) }; }
    port.postMessage(reply);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  });
});`;

/** The client with synchronous methods (one worker thread per store; unref'd so it never holds the process open). */
export function syncS3(cfg) {
  const worker = new Worker(WORKER, { eval: true, workerData: cfg });
  worker.unref();
  const { port1, port2 } = new MessageChannel();
  const flag = new Int32Array(new SharedArrayBuffer(4));
  worker.postMessage({ port: port2, flag, modUrl: import.meta.url }, [port2]);
  port1.unref();
  const callSync = (op, ...args) => {
    Atomics.store(flag, 0, 0);
    port1.postMessage({ op, args });
    if (Atomics.wait(flag, 0, 0, 10 * 60_000) === "timed-out") throw new Error(`R2 ${op} timed out`);
    const msg = receiveMessageOnPort(port1)?.message;
    if (!msg) throw new Error(`R2 ${op}: no answer from the worker`);
    if (msg.error) throw new Error(msg.error);
    return msg.value;
  };
  return {
    get: (bucket, key) => {
      const r = callSync("get", bucket, key);
      return r ? { body: Buffer.from(r.body), etag: r.etag } : null;
    },
    put: (bucket, key, body, opts) => callSync("put", bucket, key, Buffer.from(body), opts),
    delete: (bucket, key) => callSync("delete", bucket, key),
    list: (bucket, prefix) => callSync("list", bucket, prefix),
    close: () => worker.terminate(),
  };
}

/** A read-only view of one bucket for r2Reader ({ get(key) -> text | null }). */
export function readOnly(client, bucket) {
  return {
    label: `r2://${bucket}`,
    get: (key) => {
      const r = client.get(bucket, key);
      return r ? r.body.toString("utf8") : null;
    },
  };
}
