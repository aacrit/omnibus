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
// once with `git ls-remote`, so the capture is one consistent printed state
// and its provenance is a permanent public URL. feed.json is not served on
// news.voidvision.org (the site bakes it into its pages), and reading the
// repo puts no load on void news's own Worker.
//
// Polite by construction: one request at a time with a pause between, a
// User-Agent naming void omnibus, a timeout per request, three retries with
// backoff on network errors, 429 and 5xx (never on 404), honouring
// Retry-After up to a minute, every body capped in bytes while it streams
// (scripts/lib/snapshot.mjs LIMITS) and every unread body cancelled, and no
// more deep-dive requests after five failures in a row. A missing or broken
// deep dive is recorded in the manifest, not fatal; a missing feed, weekly
// issue or outlet list fails the run. A capture of an edition already held
// merges into it and never loses a file (scripts/lib/snapshot.mjs planSnapshot).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  PATHS,
  RAW_BASE,
  VOIDNEWS_REPO,
  isCommit,
  planDeepDives,
  planSnapshot,
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
const MAX_RETRY_AFTER_MS = 60_000;
export const MAX_CONSECUTIVE_FAILURES = 5;

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

/** Retry-After in ms (seconds or an HTTP date), capped; null when absent or unreadable. */
export function retryAfterMs(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const secs = Number(value);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    // already consumed or closed
  }
}

/** Reads a body, refusing it once it passes maxBytes, without buffering more than that. */
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(res);
    return null;
  }
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
  let wait = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.max(1000 * 2 ** (attempt - 1), wait));
    wait = 0;
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.status === 404) {
      await discard(res);
      return { status: "not_found" };
    }
    if (res.status === 429 || res.status >= 500) {
      wait = retryAfterMs(res.headers.get("retry-after")) ?? 0;
      await discard(res);
      lastError = new Error(`${url} answered ${res.status}`);
      continue;
    }
    if (!res.ok) {
      await discard(res);
      throw new Error(`${url} answered ${res.status}`);
    }
    try {
      const bytes = await readCapped(res, maxBytes);
      return bytes ? { status: "ok", bytes } : { status: "too_large" };
    } catch (err) {
      lastError = err; // the body broke off mid-stream: retry
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

/** The stored manifest for a date folder, if it is valid and its files match it. */
function readStored(dir) {
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, "utf8"));
    if (validateManifest(m).length) return null;
    for (const f of m.files) {
      const p = path.join(dir, f.path);
      if (!existsSync(p) || sha256Hex(readFileSync(p)) !== f.sha256) return null;
    }
    return m;
  } catch {
    return null; // an unreadable or damaged snapshot is replaced, never trusted
  }
}

/**
 * Captures one snapshot into outDir. Returns { date, action, manifest, dir }
 * where action is planSnapshot's: write, merge, replace, unchanged or older
 * (the last two write nothing).
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
    try {
      return await politeGet(raw(p), { fetchImpl, sleep, maxBytes: limits.maxFileBytes });
    } finally {
      await sleep(PAUSE_MS);
    }
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
  let failures = 0;
  for (const id of ids) {
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      missing.push({ cluster_id: id, reason: "skipped_after_failures" });
      continue;
    }
    let r;
    try {
      r = await get(PATHS.deepdive(id));
    } catch {
      failures++;
      missing.push({ cluster_id: id, reason: "fetch_failed" });
      continue;
    }
    failures = 0;
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
    deep.push({ rel: `deepdive/${id}.json`, bytes: r.bytes });
  }

  const captured = [feed, weekly, sources, ...deep];
  const bytesBySha = new Map(captured.map((f) => [sha256Hex(f.bytes), f.bytes]));
  const dir = path.join(outDir, date);
  const stored = readStored(dir);
  const plan = planSnapshot(
    stored,
    {
      date,
      printedAt: feed.json.builtAt,
      commit,
      capturedAt: now().toISOString(),
      weeklyIssue: weekly.json.issue_number,
      files: captured.map((f) => ({ path: f.rel, bytes: f.bytes.byteLength, sha256: sha256Hex(f.bytes) })),
      missing,
    },
    limits,
  );
  const { action, manifest } = plan;
  if (action === "unchanged" || action === "older") {
    log(`snapshot: ${date} ${action} (${manifest.content_sha256.slice(0, 12)}), nothing written`);
    return { date, action, manifest, dir };
  }

  // Written beside the old copy, then swapped in, so a failed run never
  // leaves half a snapshot under the date. A merged file the capture did
  // not bring is copied from the stored snapshot (checked by readStored).
  const tmp = path.join(outDir, `.${date}.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, "deepdive"), { recursive: true });
  for (const f of manifest.files) {
    const bytes = bytesBySha.get(f.sha256) ?? readFileSync(path.join(dir, f.path));
    writeFileSync(path.join(tmp, f.path), bytes);
  }
  writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  log(
    `snapshot: ${action} ${date} (printed ${manifest.printed_at}, commit ${commit.slice(0, 8)}): ` +
      `${manifest.files.length} files, ${manifest.missing.length} missing, ${manifest.total_bytes} bytes`,
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
