#!/usr/bin/env node
// C6: the stores the footage capture writes through (scripts/lib/capture-store.mjs
// holds every key, cap and plan). Two stores, one interface
// { get(key) -> text | null, put(key, body), delete(key) }:
//   captureStore()    the private R2 bucket `omnibus-capture`: through R2's S3 API
//                     with the bucket-scoped secrets R2_ACCOUNT_ID, R2_ACCESS_KEY_ID
//                     and R2_SECRET_ACCESS_KEY (scripts/lib/r2-s3.mjs) when they are
//                     set (Actions), else through wrangler's own login (a laptop)
//   dirStore(root)    a directory laid out by the same keys: the workflow
//                     artifact a run keeps when R2 is not configured
//
// Backfill: every capture/index.json under <root> (downloaded workflow
// artifacts, at any depth up to four), oldest first, merged into R2 item by
// item through planPut, so the caps, dedupe and the evidence lint apply as
// they do on a live run. A backfill never writes the heartbeat.
//
//   node scripts/capture-r2.mjs --root <downloaded artifacts>
//
// The bucket is created once, by hand, with the same token:
//   npx wrangler r2 bucket create omnibus-capture

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinPath } from "./lib/run-bin.mjs";
import { BUCKET, INDEX_KEY, PREFIX, commit, pin, planPut, readIndex, serialiseIndex } from "./lib/capture-store.mjs";
import { r2Config, readOnly, syncS3 } from "./lib/r2-s3.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TYPES = { json: "application/json", gz: "application/gzip", webm: "video/webm", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", ogv: "video/ogg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
export const contentType = (key) => TYPES[String(key).split(".").pop().toLowerCase()] ?? "application/octet-stream";

/** A key the capture may write: under capture/, no dot segments, no backslashes. */
export function assertKey(key) {
  const k = String(key);
  if (!k.startsWith(`${PREFIX}/`) || k.includes("\\") || k.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error(`not a capture key: ${k}`);
  return k;
}

/** The capture bucket through R2's S3 API (bucket-scoped keys): get, put, conditional put, delete, list. */
export function captureS3Store(cfg, { bucket = BUCKET, client = syncS3(cfg) } = {}) {
  return {
    label: `r2://${bucket}`,
    conditional: true,
    get: (key) => client.get(bucket, assertKey(key))?.body.toString("utf8") ?? null,
    getBytes: (key) => client.get(bucket, assertKey(key))?.body ?? null,
    getWithEtag(key) {
      const r = client.get(bucket, assertKey(key));
      return r ? { text: r.body.toString("utf8"), etag: r.etag } : { text: null, etag: null };
    },
    put: (key, body) => void client.put(bucket, assertKey(key), body, { contentType: contentType(key) }),
    /** Writes only if the object is still the one read (etag), or absent (null). False when another writer got there first. */
    putIfMatch: (key, body, etag) => client.put(bucket, assertKey(key), body, { contentType: contentType(key), ...(etag ? { ifMatch: etag } : { ifNoneMatch: "*" }) }).ok,
    delete: (key) => client.delete(bucket, assertKey(key)),
    list(prefix) {
      if (!String(prefix).startsWith(`${PREFIX}/`)) throw new Error(`not a capture prefix: ${prefix}`);
      return client.list(bucket, prefix);
    },
  };
}

/** The capture store for this environment: S3 with the R2 secrets, else wrangler's login. */
export function captureStore(env = process.env) {
  const cfg = r2Config(env);
  return cfg ? captureS3Store(cfg) : captureWranglerStore();
}

/** The snapshot bucket `omnibus`, read only: S3 with the R2 secrets, else wrangler's login. */
export async function snapshotReadStore(env = process.env) {
  const cfg = r2Config(env);
  if (cfg) return readOnly(syncS3(cfg), "omnibus");
  const { wranglerStore } = await import("./snapshot-r2.mjs");
  return wranglerStore();
}

/** The R2 bucket through wrangler (a laptop's `wrangler login`). get() is null only for a key that does not exist. */
export function captureWranglerStore(bucket = BUCKET) {
  const bin = resolveBinPath("wrangler", "wrangler");
  const once = (args) => {
    const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: repoRoot, timeout: 300_000 });
    if (r.error) throw r.error;
    return r;
  };
  const missingKey = (r) => /specified key does not exist/i.test(r.stderr + r.stdout);
  // wrangler sometimes exits non-zero with no output (a dropped connection): two retries, never for an absent key.
  const run = (args) => {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * attempt);
      r = once(args);
      if (r.status === 0 || missingKey(r)) return r;
    }
    return r;
  };
  const why = (r) => `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}: ${(r.stderr || r.stdout || "no output").trim().split("\n").slice(-3).join(" ")}`;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "omnibus-capture-r2-"));
  let n = 0;
  return {
    label: `r2://${bucket}`,
    get(key) {
      const r = run(["r2", "object", "get", `${bucket}/${assertKey(key)}`, "--remote", "--pipe"]);
      if (r.status === 0) return r.stdout;
      if (missingKey(r)) return null;
      throw new Error(`wrangler r2 object get ${key} failed, ${why(r)}`);
    },
    put(key, body) {
      const file = path.join(tmp, `${n++}.${String(key).split(".").pop()}`);
      writeFileSync(file, body);
      try {
        const r = run(["r2", "object", "put", `${bucket}/${assertKey(key)}`, "--file", file, "--remote", "--content-type", contentType(key)]);
        if (r.status !== 0) throw new Error(`wrangler r2 object put ${key} failed, ${why(r)}`);
      } finally {
        unlinkSync(file);
      }
    },
    delete(key) {
      const r = run(["r2", "object", "delete", `${bucket}/${assertKey(key)}`, "--remote"]);
      if (r.status !== 0 && !missingKey(r)) throw new Error(`wrangler r2 object delete ${key} failed, ${why(r)}`);
    },
  };
}

// ---- Pins ------------------------------------------------------------------------
// An episode's pinned items stay past the 14-day sweep until it airs plus 30
// days. `rights.mjs candidates` writes the pin request capture/pins/<issue>.json
// and, where the store can write conditionally (R2's S3 API), pins the index
// at once (If-Match, retried on a lost race); every capture run applies every
// pin request before it sweeps, so a pin is never lost to a race with a run.

export const PINS_PREFIX = `${PREFIX}/pins/`;
export const PIN_SCHEMA = "omnibus.capture-pins/1";
export const pinRequestKey = (issue) => {
  if (!Number.isInteger(issue) || issue < 1) throw new Error(`not an issue: ${issue}`);
  return `${PINS_PREFIX}${issue}.json`;
};

/** Pure: the index with every pin request applied; sids the index no longer holds are skipped and named. */
export function applyPins(indexIn, requests) {
  let index = indexIn;
  const missing = [];
  for (const r of requests) {
    if (r?.schema !== PIN_SCHEMA || !Number.isInteger(r.issue) || !Array.isArray(r.sids)) continue;
    for (const sid of r.sids) {
      if (!index.items[sid]) {
        missing.push(sid);
        continue;
      }
      const cur = index.items[sid].pinned;
      if (cur?.issue === r.issue && cur?.airs_on === (r.airs_on ?? null)) continue;
      index = pin(index, sid, { issue: r.issue, airs_on: r.airs_on ?? null });
    }
  }
  return { index, missing };
}

/** Every pin request the store holds (a store without list() holds none it can find). */
export function readPinRequests(store) {
  if (typeof store.list !== "function") return [];
  return store
    .list(PINS_PREFIX)
    .filter((o) => /^capture\/pins\/\d+\.json$/.test(o.key))
    .map((o) => {
      try {
        return JSON.parse(store.get(o.key) ?? "null");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Pins an episode's captured items: writes the pin request, then (on a
 * conditional store) pins the index itself, retrying a lost race. Returns
 * { request, pinned_now, missing }.
 */
export function pinCaptured({ store, issue, sids, airsOn = null, now = () => new Date() }) {
  const request = { schema: PIN_SCHEMA, issue, airs_on: airsOn, sids: [...new Set(sids)].sort(), written_at: now().toISOString() };
  store.put(pinRequestKey(issue), `${JSON.stringify(request, null, 1)}\n`);
  if (!store.conditional) return { request, pinned_now: false, missing: [] };
  for (let attempt = 0; attempt < 5; attempt++) {
    const { text, etag } = store.getWithEtag(INDEX_KEY);
    const { index, missing } = applyPins(readIndex(text), [request]);
    if (store.putIfMatch(INDEX_KEY, serialiseIndex(index), etag)) return { request, pinned_now: true, missing };
  }
  return { request, pinned_now: false, missing: [] };
}

/** A directory laid out by the capture's keys (the workflow artifact). */
export function dirStore(root) {
  const file = (key) => path.join(root, ...assertKey(key).split("/"));
  return {
    label: path.resolve(root),
    get(key) {
      const f = file(key);
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    getBytes(key) {
      const f = file(key);
      return existsSync(f) ? readFileSync(f) : null;
    },
    put(key, body) {
      const f = file(key);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, body);
    },
    delete(key) {
      rmSync(file(key), { force: true });
    },
    list(prefix) {
      const out = [];
      const walk = (dir, rel) => {
        if (!existsSync(dir)) return;
        for (const name of readdirSync(dir)) {
          const p = path.join(dir, name);
          const k = rel ? `${rel}/${name}` : name;
          if (statSync(p).isDirectory()) walk(p, k);
          else if (k.startsWith(prefix)) out.push({ key: k, size: statSync(p).size });
        }
      };
      walk(path.join(root, PREFIX), PREFIX);
      return out;
    },
  };
}

/** Every directory under root holding capture/index.json, at most `depth` levels down, oldest index first. */
export function findCaptureRoots(root, depth = 4) {
  const found = [];
  const walk = (dir, left) => {
    if (existsSync(path.join(dir, PREFIX, "index.json"))) found.push(dir);
    if (left <= 0) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (name !== PREFIX && statSync(p).isDirectory()) walk(p, left - 1);
    }
  };
  walk(root, depth);
  const newest = (dir) => {
    const idx = readIndex(readFileSync(path.join(dir, PREFIX, "index.json"), "utf8"));
    return Object.values(idx.items).map((e) => e.evidence?.captured_at ?? e.listed_at ?? "").sort().at(-1) ?? "";
  };
  return found.map((d) => ({ d, t: newest(d) })).sort((a, b) => a.t.localeCompare(b.t) || a.d.localeCompare(b.d)).map((x) => x.d);
}

/**
 * Merges one local capture (a dirStore root) into `store`, item by item through
 * planPut: what the remote already holds by source id is skipped, caps and the
 * evidence lint apply, and the remote index is written after the puts.
 * Returns counts by planPut action.
 */
export function backfillOne({ localRoot, store, now = () => new Date(), log = () => {} }) {
  const local = dirStore(localRoot);
  const localIndex = readIndex(local.get(INDEX_KEY));
  let index = readIndex(store.get(INDEX_KEY));
  const puts = [];
  const mediaFiles = new Map();
  const counts = {};
  for (const e of Object.values(localIndex.items)) {
    const blobs = [];
    for (const sha of e.evidence_keys ?? []) {
      const gz = local.getBytes(`${PREFIX}/evidence/${sha}.gz`);
      const meta = localIndex.evidence[sha];
      if (gz && meta) blobs.push({ sha256: sha, gz, kind: meta.kind, url: meta.url });
    }
    let media = null;
    if (e.media) {
      const key = `${PREFIX}/media/${e.media.sha256}.${e.media.ext}`;
      if (existsSync(path.join(localRoot, ...key.split("/")))) {
        media = { sha256: e.media.sha256, ext: e.media.ext, bytes: e.media.bytes };
        mediaFiles.set(e.media.sha256, path.join(localRoot, ...key.split("/")));
      }
    }
    const plan = planPut({ index, item: { source: e.source, id: e.id, url: e.url, title: e.title, description: e.description, captured_at: e.listed_at }, evidence: { record: e.evidence, blobs }, media, now: now() });
    counts[plan.action] = (counts[plan.action] ?? 0) + 1;
    index = plan.index;
    puts.push(...plan.puts);
  }
  commit(store, { puts, deletes: [], index }, { mediaBody: (sha) => readFileSync(mediaFiles.get(sha)) });
  log(`capture-r2: ${localRoot}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"}`);
  return counts;
}

export function backfill({ root, store, now, log = console.log }) {
  const roots = findCaptureRoots(root);
  if (!roots.length) throw new Error(`no capture/index.json under ${root}`);
  return roots.map((localRoot) => backfillOne({ localRoot, store, now, log }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--root");
  const root = i > 0 ? process.argv[i + 1] : null;
  if (!root) {
    console.error("usage: node scripts/capture-r2.mjs --root <downloaded capture artifacts>");
    process.exit(2);
  }
  try {
    backfill({ root: path.resolve(root), store: captureStore() });
  } catch (err) {
    console.error(`capture-r2: ${err.message}`);
    process.exit(1);
  }
}
