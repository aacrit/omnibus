#!/usr/bin/env node
// Copies local snapshots (scripts/snapshot.mjs) to the R2 bucket `omnibus`
// under snapshots/<date>/ (keys and order: scripts/lib/snapshot-store.mjs),
// with wrangler. Before anything is sent, every file is re-hashed against
// its manifest and the size caps are checked again, and the bucket's size
// is checked so it never grows past this product's share (R2 bills past its
// free tier): the larger of wrangler's figure and the index's own total,
// carried forward across every date of a backfill. A capture of an edition
// R2 already holds merges into it and never removes a file; a date already
// stored with the same content writes only the heartbeat.
//
//   node scripts/snapshot-r2.mjs --dir .cache/snapshots/2026-11-12
//   node scripts/snapshot-r2.mjs --root <dir>   # every <date>/manifest.json under <dir>, at any
//                                               # depth (a downloaded workflow artifact), oldest first
//
// Auth: wrangler's own (CLOUDFLARE_API_TOKEN in CI, `wrangler login` locally).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinPath } from "./lib/run-bin.mjs";
import { LIMITS, checkCaps, isDate, sha256Hex, validateManifest } from "./lib/snapshot.mjs";
import { BUCKET, BUCKET_CAP_BYTES, INDEX_KEY, LATEST_KEY, indexedBytes, manifestKey, planBytes, planUpload, readIndex } from "./lib/snapshot-store.mjs";

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
    delete(key) {
      const r = run(["r2", "object", "delete", `${bucket}/${key}`, "--remote"]);
      if (r.status !== 0 && !missingKey(r)) throw new Error(`wrangler r2 object delete ${key} failed, ${why(r)}`);
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

/**
 * Uploads one local snapshot directory. `budget` ({ used }) carries the
 * bucket's size across calls, so a backfill counts what it has already sent.
 * Returns the plan's action.
 */
export function uploadSnapshot({ dir, store, now = () => new Date(), capBytes = BUCKET_CAP_BYTES, budget = { used: null }, log = () => {} }) {
  const local = readLocalSnapshot(dir);
  const remote = { manifest: store.get(manifestKey(local.date)), index: store.get(INDEX_KEY), latest: store.get(LATEST_KEY) };
  const plan = planUpload({ local, remote, ranAt: now().toISOString() });
  const adding = planBytes(plan.manifest, plan);
  const floor = indexedBytes(readIndex(remote.index));
  budget.used = Math.max(budget.used ?? store.bucketBytes(), floor);
  if (budget.used + adding > capBytes) {
    throw new Error(`bucket ${BUCKET} holds at least ${budget.used} bytes; ${adding} more would pass this product's ${capBytes}-byte cap, so nothing was uploaded`);
  }
  const fileBySha = new Map(local.files.map((f) => [f.sha256, path.join(dir, f.path)]));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "omnibus-r2-"));
  try {
    const send = (p, i) => {
      let file = fileBySha.get(p.sha256);
      if (!p.sha256) {
        file = path.join(tmp, `${i}.json`);
        writeFileSync(file, p.body);
      }
      if (!file) throw new Error(`no local file for blob ${p.sha256}`);
      store.put(p.key, file);
    };
    plan.puts.forEach(send);
    for (const key of plan.deletes) store.delete(key);
    send(plan.heartbeat, "heartbeat");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  budget.used += adding;
  log(`snapshot-r2: ${local.date} ${plan.action} (${plan.puts.length + 1} written, ${plan.deletes.length} deleted)`);
  return plan.action;
}

/** Every <date>/ folder holding a manifest.json under root, at most four levels down, oldest date first. */
export function findSnapshotDirs(root, depth = 4) {
  const found = [];
  const walk = (dir, left) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      if (isDate(name) && existsSync(path.join(p, "manifest.json"))) found.push(p);
      else if (left > 0) walk(p, left - 1);
    }
  };
  walk(root, depth);
  return found.sort((a, b) => path.basename(a).localeCompare(path.basename(b)) || a.localeCompare(b));
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = arg("root");
    const one = arg("dir");
    const dirs = root ? findSnapshotDirs(path.resolve(root)) : one ? [path.resolve(one)] : [];
    if (dirs.length === 0) throw new Error("give --dir <snapshot dir> or --root <dir holding snapshots>");
    const store = wranglerStore();
    const budget = { used: null };
    for (const dir of dirs) uploadSnapshot({ dir, store, budget, log: (m) => console.log(m) });
  } catch (err) {
    console.error(`snapshot-r2: failed: ${err.message}`);
    process.exit(1);
  }
}
