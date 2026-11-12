#!/usr/bin/env node
// Captures void news's printed day (bible section h, stage 1) into a local
// directory: <out>/<printed date>/{feed,weekly,sources}.json, one
// deepdive/<cluster id>.json per printed cluster, and manifest.json with
// every file's sha256. scripts/snapshot-r2.mjs then copies it to R2. Nothing
// here goes into git (rule 8; .gitignore and lint-size refuse snapshots/).
//
//   node scripts/snapshot.mjs [--out .cache/snapshots]
//
// Every file is read from void news's public repo at one commit, resolved
// once with `git ls-remote`, so the snapshot is one consistent printed state
// and its provenance is a permanent public URL. feed.json is not served on
// news.voidvision.org (the site bakes it into its pages), and reading the
// repo puts no load on void news's own Worker.
//
// Polite by construction: one request at a time with a pause between,
// a User-Agent naming void omnibus, a timeout per request, three retries
// with backoff on network errors, 429 and 5xx (never on 404), and every
// body capped in bytes while it streams (scripts/lib/snapshot.mjs LIMITS).
// A missing or broken deep dive is recorded in the manifest, not fatal;
// a missing feed, weekly issue or outlet list fails the run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  PATHS,
  RAW_BASE,
  VOIDNEWS_REPO,
  buildManifest,
  checkCaps,
  decideWrite,
  isCommit,
  planDeepDives,
  printedDate,
  sha256Hex,
  validateDeepDive,
  validateFeed,
  validateManifest,
  validateSources,
  validateWeekly,
} from "./lib/snapshot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const USER_AGENT = "void-omnibus-snapshot/1 (+https://omnibus.voidvision.org; daily, one request at a time)";
const TIMEOUT_MS = 20_000;
const RETRIES = 3;
const PAUSE_MS = 250;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The commit void news's main branch points at now. */
export function resolveMainCommit() {
  const out = execFileSync("git", ["ls-remote", `https://github.com/${VOIDNEWS_REPO}`, "refs/heads/main"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const sha = out.trim().split(/\s+/)[0];
  if (!isCommit(sha)) throw new Error(`git ls-remote gave no commit for ${VOIDNEWS_REPO} main`);
  return sha;
}

/** Reads a body, refusing it once it passes maxBytes, without buffering more than that. */
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * One polite GET. Resolves { status: "ok", bytes } | { status: "not_found" }
 * | { status: "too_large" }; throws once retries are spent.
 */
export async function politeGet(url, { fetchImpl = fetch, sleep = realSleep, maxBytes = LIMITS.maxFileBytes, retries = RETRIES } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      if (res.status === 404) return { status: "not_found" };
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${url} answered ${res.status}`);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`${url} answered ${res.status}`), { final: true });
      const bytes = await readCapped(res, maxBytes);
      return bytes ? { status: "ok", bytes } : { status: "too_large" };
    } catch (err) {
      if (err.final) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error(`${url} failed`);
}

function parse(bytes, what) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

function readManifest(file) {
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, "utf8"));
    return validateManifest(m).length === 0 ? m : null;
  } catch {
    return null; // an unreadable manifest is replaced, never trusted
  }
}

/**
 * Captures one snapshot into outDir. Returns { date, action, manifest, dir }
 * where action is "write", "replace" or "unchanged" (nothing written).
 */
export async function runSnapshot({
  outDir,
  fetchImpl = fetch,
  sleep = realSleep,
  resolveCommit = resolveMainCommit,
  now = () => new Date(),
  limits = LIMITS,
  log = () => {},
}) {
  const commit = resolveCommit();
  if (!isCommit(commit)) throw new Error("resolveCommit returned no commit");
  const raw = (p) => `${RAW_BASE}/${commit}/${p}`;
  const get = async (p) => {
    const r = await politeGet(raw(p), { fetchImpl, sleep, maxBytes: limits.maxFileBytes });
    await sleep(PAUSE_MS);
    return r;
  };
  const required = async (rel, repoPath, validate) => {
    const r = await get(repoPath);
    if (r.status !== "ok") throw new Error(`${repoPath} at ${commit.slice(0, 8)}: ${r.status}`);
    const json = parse(r.bytes, repoPath);
    const errors = validate(json);
    if (errors.length) throw new Error(`${repoPath} failed validation: ${errors.slice(0, 5).join("; ")}`);
    return { rel, json, bytes: r.bytes };
  };

  const feed = await required("feed.json", PATHS.feed, validateFeed);
  const weekly = await required("weekly.json", PATHS.weekly, validateWeekly);
  const sources = await required("sources.json", PATHS.sources, validateSources);
  const date = printedDate(feed.json);

  const { ids, skipped } = planDeepDives(feed.json, limits);
  const missing = [...skipped];
  const deep = [];
  for (const id of ids) {
    let r;
    try {
      r = await get(PATHS.deepdive(id));
    } catch {
      missing.push({ cluster_id: id, reason: "fetch_failed" });
      continue;
    }
    if (r.status !== "ok") {
      missing.push({ cluster_id: id, reason: r.status });
      continue;
    }
    let json;
    try {
      json = parse(r.bytes, id);
    } catch {
      missing.push({ cluster_id: id, reason: "invalid" });
      continue;
    }
    if (validateDeepDive(json).length) {
      missing.push({ cluster_id: id, reason: "invalid" });
      continue;
    }
    deep.push({ rel: `deepdive/${id}.json`, bytes: r.bytes, id });
  }

  const describe = (f) => ({ path: f.rel, bytes: f.bytes.byteLength, sha256: sha256Hex(f.bytes) });
  const core = [feed, weekly, sources];
  const coreErrors = checkCaps(core.map(describe), { ...limits, maxTotalBytes: Infinity });
  if (coreErrors.length) throw new Error(coreErrors.join("; "));
  // Over the total cap, the lowest-printed deep dives give way first.
  while (deep.length && checkCaps([...core, ...deep].map(describe), limits).length) {
    const dropped = deep.pop();
    missing.push({ cluster_id: dropped.id, reason: "over_total_cap" });
  }
  const files = [...core, ...deep];
  const capErrors = checkCaps(files.map(describe), limits);
  if (capErrors.length) throw new Error(capErrors.join("; "));

  const manifest = buildManifest({
    date,
    printedAt: feed.json.builtAt,
    commit,
    capturedAt: now().toISOString(),
    files: files.map(describe),
    missing,
    weeklyIssue: weekly.json.issue_number,
  });

  const dir = path.join(outDir, date);
  const action = decideWrite(readManifest(path.join(dir, "manifest.json")), manifest);
  if (action === "unchanged") {
    log(`snapshot: ${date} unchanged (${manifest.content_sha256.slice(0, 12)}), nothing written`);
    return { date, action, manifest, dir };
  }

  // Written beside the old copy, then swapped in, so a failed run never
  // leaves half a snapshot under the date.
  const tmp = path.join(outDir, `.${date}.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, "deepdive"), { recursive: true });
  for (const f of files) writeFileSync(path.join(tmp, f.rel), f.bytes);
  writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  log(
    `snapshot: ${action} ${date} (printed ${manifest.printed_at}, commit ${commit.slice(0, 8)}): ` +
      `${deep.length} deep dives, ${missing.length} missing, ${manifest.total_bytes} bytes`,
  );
  return { date, action, manifest, dir };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(arg("out", path.join(repoRoot, ".cache", "snapshots")));
  runSnapshot({ outDir, log: (m) => console.log(m) })
    .then(({ date, action }) => {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `date=${date}\naction=${action}\n`);
    })
    .catch((err) => {
      console.error(`snapshot: failed: ${err.message}`);
      process.exit(1);
    });
}
