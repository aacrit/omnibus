#!/usr/bin/env node
// Copies local snapshots (scripts/snapshot.mjs) to the R2 bucket `omnibus`
// under snapshots/<date>/ (keys and order: scripts/lib/snapshot-store.mjs),
// with wrangler. Before anything is sent, every file is re-hashed against
// its manifest and the size caps are checked again, and the bucket's size
// is read so it never grows past this product's share (R2 bills past its
// free tier). A date already stored with the same content is not
// re-uploaded; only the heartbeat is written.
//
//   node scripts/snapshot-r2.mjs --dir .cache/snapshots/2026-11-12
//   node scripts/snapshot-r2.mjs --root <dir>   # every date under <dir>, oldest first (backfill)
//
// Auth: wrangler's own (CLOUDFLARE_API_TOKEN in CI, `wrangler login` locally).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinPath } from "./lib/run-bin.mjs";
import { LIMITS, checkCaps, isDate, sha256Hex, validateManifest } from "./lib/snapshot.mjs";
import { BUCKET, BUCKET_CAP_BYTES, INDEX_KEY, LATEST_KEY, manifestKey, planBytes, planUpload } from "./lib/snapshot-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** "923 MB" (wrangler's bucket_size) in bytes, read with binary units so the estimate errs high. */
export function parseSize(text) {
  const m = /^([\d.]+)\s*([kKMGT]?)i?B$/.exec(String(text).trim());
  if (!m) throw new Error(`unreadable bucket size ${JSON.stringify(text)}`);
  const pow = { "": 0, k: 1, K: 1, M: 2, G: 3, T: 4 }[m[2]];
  return Math.ceil(Number(m[1]) * 1024 ** pow);
}

/** The R2 store, through wrangler. get() is null only for a key that does not exist. */
export function wranglerStore(bucket = BUCKET) {
  const bin = resolveBinPath("wrangler", "wrangler");
  const once = (args) => {
    const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: repoRoot, timeout: 120_000 });
    if (r.error) throw r.error;
    return r;
  };
  const missingKey = (r) => /specified key does not exist/i.test(r.stderr + r.stdout);
  // wrangler sometimes exits non-zero with no output (a dropped connection);
  // each call is retried twice with a pause, never for a key that is absent.
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
  return {
    get(key) {
      const r = run(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--pipe"]);
      if (r.status === 0) return r.stdout;
      if (missingKey(r)) return null;
      throw new Error(`wrangler r2 object get ${key} failed, ${why(r)}`);
    },
    put(key, file) {
      const r = run(["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote", "--content-type", "application/json"]);
      if (r.status !== 0) throw new Error(`wrangler r2 object put ${key} failed, ${why(r)}`);
    },
    bucketBytes() {
      const r = run(["r2", "bucket", "info", bucket, "--json"]);
      if (r.status !== 0) throw new Error(`wrangler r2 bucket info failed, ${why(r)}`);
      const json = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
      return parseSize(json.bucket_size);
    },
  };
}

/** Reads a local snapshot and proves every file matches its manifest. */
export function readLocalSnapshot(dir, limits = LIMITS) {
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) throw new Error(`${dir} has no manifest.json`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
  if (path.basename(dir) !== manifest.date) throw new Error(`${dir} holds the manifest for ${manifest.date}`);
  for (const f of manifest.files) {
    const bytes = readFileSync(path.join(dir, f.path));
    if (bytes.byteLength !== f.bytes || sha256Hex(bytes) !== f.sha256) throw new Error(`${f.path} does not match its manifest entry`);
  }
  const caps = checkCaps(manifest.files, limits);
  if (caps.length) throw new Error(caps.join("; "));
  return manifest;
}

/** Uploads one local snapshot directory. Returns the plan's action. */
export function uploadSnapshot({ dir, store, now = () => new Date(), capBytes = BUCKET_CAP_BYTES, log = () => {} }) {
  const manifest = readLocalSnapshot(dir);
  const remote = { manifest: store.get(manifestKey(manifest.date)), index: store.get(INDEX_KEY), latest: store.get(LATEST_KEY) };
  const { action, puts } = planUpload({ manifest, remote, ranAt: now().toISOString() });
  if (action !== "unchanged") {
    const used = store.bucketBytes();
    const adding = planBytes(manifest, puts);
    if (used + adding > capBytes) {
      throw new Error(`bucket ${BUCKET} holds ${used} bytes; ${adding} more would pass this product's ${capBytes}-byte cap, so nothing was uploaded`);
    }
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "omnibus-r2-"));
  try {
    puts.forEach((p, i) => {
      const file = p.rel ? path.join(dir, p.rel) : path.join(tmp, `${i}.json`);
      if (!p.rel) writeFileSync(file, p.body);
      store.put(p.key, file);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  log(`snapshot-r2: ${manifest.date} ${action} (${puts.length} object${puts.length === 1 ? "" : "s"} written)`);
  return action;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = arg("root");
    const one = arg("dir");
    const dirs = root
      ? readdirSync(root).filter(isDate).sort().map((d) => path.join(root, d))
      : one
        ? [path.resolve(one)]
        : [];
    if (dirs.length === 0) throw new Error("give --dir <snapshot dir> or --root <dir of snapshots>");
    const store = wranglerStore();
    for (const dir of dirs) uploadSnapshot({ dir, store, log: (m) => console.log(m) });
  } catch (err) {
    console.error(`snapshot-r2: failed: ${err.message}`);
    process.exit(1);
  }
}
