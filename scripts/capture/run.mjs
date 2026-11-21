#!/usr/bin/env node
// C6: one capture run (.github/workflows/capture.yml, three times a day).
//   1. List the last 72 hours from every source (scripts/capture/listers);
//      DVIDS only with DVIDS_API_KEY, else skipped with the reason.
//   2. Score against the latest printed editions and the always-capture
//      channels (relevance.mjs); a selected White House locator brings its
//      matching Commons upload.
//   3. For each selected item the store does not already hold: fetch-time
//      evidence (evidence.mjs), then a <=480p proxy (proxy.mjs) when the
//      verdict is ok; then planPut (scripts/lib/capture-store.mjs: caps,
//      dedupe, the evidence lint).
//   4. Commit the puts, the index, the retention sweep's deletes.
//   5. The weekly pool (pool.mjs) the first time a new weekly issue shows.
//   6. The heartbeat, last.
//
// Stores: --store r2 (the private bucket omnibus-capture) or --store dir,
// the fallback when the R2 secrets are not set: the store is a
// directory kept as a workflow artifact for 14 days. Artifacts on a public
// repo are public, so a dir store holds only public-domain and Creative
// Commons proxies; an editorial-use item is kept as its URL and evidence.
//
//   node scripts/capture/run.mjs --store r2 --out capture-out [--work <dir>]
//   node scripts/capture/run.mjs --store dir --out capture-out
//
// The run fails (exit 1) when no lister answered or the store refused a
// write; a lister that fails alone is reported and the run goes on.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDEX_KEY, CAPS, commit, evidenceKey, mediaKey, planPut, readIndex, serialiseIndex, sourceId, storedBytes, sweep } from "../lib/capture-store.mjs";
import { applyPins, expiredPinRequests, readPinRequests } from "../capture-r2.mjs";
import { scrub, secretsOf } from "./evidence.mjs";
import { getJson, getMedia, getText } from "../lib/rights/http.mjs";
import { normaliseWeek } from "../lib/normalise.mjs";
import { dirReader, r2Reader, snapshotSource } from "../lib/week-sources.mjs";
import { captureEvidence } from "./evidence.mjs";
import { artifactMayHoldMedia, proxyCandidates } from "./proxy.mjs";
import { buildPool, poolKey } from "./pool.mjs";
import { loadChannels, selectItems, snapshotEditions } from "./relevance.mjs";
import { listCdc } from "./listers/cdc.mjs";
import { listCommons } from "./listers/commons.mjs";
import { listDvids } from "./listers/dvids.mjs";
import { listNasa } from "./listers/nasa.mjs";
import { listNoaa } from "./listers/noaa.mjs";
import { listVoa } from "./listers/voa.mjs";
import { listWhiteHouse, matchCommons } from "./listers/whitehouse.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HEARTBEAT_KEY = "capture/heartbeat.json";
export const HEARTBEAT_SCHEMA = "omnibus.capture-heartbeat/1";
export const LISTERS = { whitehouse: listWhiteHouse, commons: listCommons, dvids: listDvids, voa: listVoa, nasa: listNasa, cdc: listCdc, noaa: listNoaa };
// Bounds a run inside the workflow's 25 minutes: items past this are left for the next run (they are re-scored).
export const MAX_ITEMS_PER_RUN = 80;
export const SOFT_DEADLINE_MS = 17 * 60_000;
// The heartbeat and pin requests between reconciles, counted against the bucket cap.
export const OVERHEAD_RESERVE_BYTES = 64 * 1024;
// A pool is trimmed to fit this (fewer items per story) and refused past it.
export const MAX_POOL_BYTES = 1024 * 1024;
export const RECONCILE_DAYS = 7;
// An unindexed object younger than this may belong to a write in flight: the reconcile leaves it.
export const ORPHAN_MIN_AGE_MS = 60 * 60_000;
export const INDEX_WRITE_TRIES = 5;

/**
 * Pure: our index with what another writer added since we read it: items we
 * do not hold (a backfill), their media and evidence records, and pins.
 */
export function mergeRemote(ours, remote) {
  const index = structuredClone(ours);
  for (const [sid, e] of Object.entries(remote?.items ?? {})) {
    if (!index.items[sid]) {
      index.items[sid] = e;
      if (e.media && remote.media[e.media.sha256]) index.media[e.media.sha256] ??= remote.media[e.media.sha256];
      for (const sha of e.evidence_keys ?? []) if (remote.evidence[sha]) index.evidence[sha] ??= remote.evidence[sha];
    } else if (e.pinned && !index.items[sid].pinned) index.items[sid].pinned = e.pinned;
  }
  return index;
}

/**
 * Writes the index. On a store that writes conditionally (R2's S3 API) it is
 * written only over the version the run read (If-Match); on a lost race the
 * run re-reads, merges what the other writer added, re-applies the pin
 * requests, sweeps again and retries, at most INDEX_WRITE_TRIES times.
 * Returns { index, deletes, etag }.
 */
export function writeIndex(store, { index, deletes, etag, prepare }) {
  if (!store.conditional) {
    store.put(INDEX_KEY, serialiseIndex(index));
    return { index, deletes, etag: null };
  }
  let cur = { index, deletes };
  let tag = etag;
  for (let i = 0; i < INDEX_WRITE_TRIES; i++) {
    const wrote = store.putIfMatchEtag(INDEX_KEY, serialiseIndex(cur.index), tag);
    if (wrote) return { ...cur, etag: typeof wrote === "string" ? wrote : null };
    const remote = store.getWithEtag(INDEX_KEY);
    tag = remote.etag;
    cur = prepare(mergeRemote(cur.index, readIndex(remote.text)));
  }
  throw new Error(`the capture index changed under this run ${INDEX_WRITE_TRIES} times; nothing was overwritten`);
}
const CAP_REFUSAL = /over the \d+-byte (?:day|bucket) cap/;
const BLOB = /^capture\/(media|evidence)\//;

/** Whether a held item is fetched again: only one refused for the day or bucket cap alone, with no media. */
export function retriesHeld(entry) {
  if (!entry || entry.media) return false;
  const why = entry.refused ?? [];
  return why.length > 0 && why.every((r) => CAP_REFUSAL.test(r));
}

/**
 * Weekly: list what R2 really holds under capture/, delete media and evidence
 * objects the index does not name (a run that stopped between its puts and its
 * index), and set overhead_bytes from every other object (index, pools, pins,
 * heartbeat). Returns the index with its reconcile record.
 */
export function reconcile(store, indexIn, { now }) {
  const index = structuredClone(indexIn);
  const objects = store.list("capture/");
  const named = new Set([...Object.entries(index.media).map(([sha, m]) => mediaKey(sha, m.ext)), ...Object.keys(index.evidence).map((sha) => evidenceKey(sha))]);
  // Only objects older than an hour: a younger one may be a put whose index write is still to come.
  const old = (o) => Number.isFinite(Date.parse(o.last_modified ?? "")) && now.getTime() - Date.parse(o.last_modified) > ORPHAN_MIN_AGE_MS;
  const orphans = objects.filter((o) => BLOB.test(o.key) && !named.has(o.key) && old(o));
  for (const o of orphans) store.delete(o.key);
  const other = objects.filter((o) => !BLOB.test(o.key)).reduce((n, o) => n + o.size, 0);
  index.overhead_bytes = other + OVERHEAD_RESERVE_BYTES;
  index.reconcile = { at: iso(now), objects: objects.length, listed_bytes: objects.reduce((n, o) => n + o.size, 0), orphans_deleted: orphans.length, orphan_bytes: orphans.reduce((n, o) => n + o.size, 0) };
  return index;
}

/** The pool's body, trimmed to maxBytes by keeping fewer items per story; null when even three a story do not fit. */
export function fitPool(build, maxBytes = MAX_POOL_BYTES) {
  for (const maxItems of [12, 8, 5, 3]) {
    const doc = build(maxItems);
    const body = `${JSON.stringify(doc, null, 1)}\n`;
    if (Buffer.byteLength(body) <= maxBytes) return { doc, body, maxItems };
  }
  return null;
}

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The newest weekly issue the snapshot reader holds, or null. */
export function latestWeeklyIssue(reader) {
  for (const date of [...reader.dates()].reverse()) {
    const hint = reader.weeklyIssue(date);
    if (Number.isInteger(hint)) return hint;
    try {
      const m = JSON.parse(reader.manifest(date) ?? "null");
      if (Number.isInteger(m?.weekly_issue)) return m.weekly_issue;
    } catch {
      /* an unreadable manifest names no issue */
    }
  }
  return null;
}

/**
 * The week record for issue n: the committed data/week-<n>.json when there is
 * one, else normalised from the snapshots (schema 1, echo pending: the pool
 * reads only the leads and margins). null with the reason when neither reads.
 */
export async function weekRecord(issue, { root = repoRoot, reader = null }) {
  const file = path.join(root, "data", `week-${issue}.json`);
  if (existsSync(file)) return { record: JSON.parse(readFileSync(file, "utf8")), from: `data/week-${issue}.json` };
  if (!reader) return { record: null, from: null, reason: `data/week-${issue}.json is not committed and no snapshot store was read` };
  try {
    return { record: await normaliseWeek(snapshotSource(reader), issue, { schema: 1, echo: "pending" }), from: `${reader.label} (normalised, schema 1)` };
  } catch (err) {
    return { record: null, from: null, reason: `issue ${issue} could not be normalised from ${reader.label}: ${String(err?.message ?? err).slice(0, 300)}` };
  }
}

/**
 * One run. `store` is { get, put, delete } (scripts/capture-r2.mjs);
 * `mode` "r2" or "dir"; `editions` the printed editions; `weekly` { issue,
 * reader } or null. Returns the run report (also the heartbeat's counts).
 */
export async function runCapture({
  store,
  mode,
  outDir,
  workDir,
  editions,
  weekly = null,
  root = repoRoot,
  channels = loadChannels(),
  http = { getJson, getText },
  fetchMedia = getMedia,
  evidenceFor = captureEvidence,
  listers = LISTERS,
  env = process.env,
  now = () => new Date(),
  deadlineMs = SOFT_DEADLINE_MS,
  maxItems = MAX_ITEMS_PER_RUN,
  runId = env.GITHUB_RUN_ID ?? null,
  log = console.log,
}) {
  if (mode !== "r2" && mode !== "dir") throw new Error(`--store must be r2 or dir, got ${mode}`);
  const secrets = secretsOf(env);
  const started = Date.now();
  const ranAt = now();
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  // 1. List.
  const listed = [];
  const listerStatus = {};
  for (const [name, list] of Object.entries(listers)) {
    try {
      const r = await list({ http, env, now });
      listerStatus[name] = r.skipped ? { status: "skipped", reason: r.skipped } : { status: "ok", items: r.items.length };
      listed.push(...r.items);
    } catch (err) {
      listerStatus[name] = { status: "error", reason: String(err?.message ?? err).slice(0, 300) };
    }
    log(`capture: ${name}: ${listerStatus[name].status}${listerStatus[name].items != null ? ` (${listerStatus[name].items})` : listerStatus[name].reason ? `: ${listerStatus[name].reason}` : ""}`);
  }
  const answered = Object.values(listerStatus).filter((s) => s.status === "ok").length;

  // 2. Select.
  const decisions = selectItems(listed, { editions, channels, now: iso(ranAt) });
  const chosen = new Map(decisions.filter((d) => d.capture).map((d) => [sourceId(d.item), { item: d.item, reason: d.reason }]));
  const wh = decisions.filter((d) => d.capture && d.item.source === "whitehouse").map((d) => d.item);
  const commonsListed = listed.filter((i) => i.source === "commons");
  for (const m of matchCommons(wh, commonsListed)) {
    const c = m.match && commonsListed.find((i) => i.id === m.match.commons_id);
    if (c && !chosen.has(sourceId(c))) chosen.set(sourceId(c), { item: c, reason: `the Commons upload of White House locator ${m.whitehouse_id} (${m.match.by})` });
  }

  // 3. Evidence, proxy, plan.
  const read = typeof store.getWithEtag === "function" ? store.getWithEtag(INDEX_KEY) : { text: store.get(INDEX_KEY), etag: null };
  const indexText = read.text;
  let index = readIndex(indexText);
  // The weekly reconcile, where the store can list (R2's S3 API, a directory).
  let reconciled = null;
  const last = Date.parse(index.reconcile?.at ?? "");
  if (typeof store.list === "function" && !(Number.isFinite(last) && ranAt.getTime() - last < RECONCILE_DAYS * 86_400_000)) {
    index = reconcile(store, index, { now: ranAt });
    reconciled = index.reconcile;
  }
  index.overhead_bytes = Math.max(index.overhead_bytes ?? 0, Buffer.byteLength(indexText ?? "") + OVERHEAD_RESERVE_BYTES);
  const puts = [];
  const mediaFiles = new Map();
  const results = [];
  const termsCache = new Map();
  const refused = new Set(); // hosts that refused the honest identity this run: never asked again
  let deferred = 0;
  for (const [sid, { item, reason }] of chosen) {
    // Dedupe by source id: a held item is fetched again only when the day or bucket cap alone refused it.
    if (index.items[sid] && !retriesHeld(index.items[sid])) continue;
    if (results.length >= maxItems || Date.now() - started > deadlineMs) {
      deferred++;
      continue;
    }
    const ev = await evidenceFor(item, { http, env, now, termsCache, refused });
    let media = null;
    let note = null;
    if (ev.record.verdict.status === "ok") {
      if (!ev.record.terms?.sha256) note = `no proxy: ${ev.record.terms?.missing ?? "no governing terms page"} (the evidence lint refuses media without it)`;
      else if (mode === "dir" && !artifactMayHoldMedia(ev.record.verdict)) note = `kept as URL and evidence only: a ${ev.record.verdict.licence ?? "unlicensed"} item never goes in a public artifact`;
      else {
        const { urls, reason: none } = proxyCandidates(item.source, ev.candidate);
        note = none;
        for (const u of urls) {
          if (refused.has(new URL(u.url).hostname)) continue;
          const file = path.join(workDir, `proxy-${results.length}.${u.ext}`);
          try {
            const got = await fetchMedia(u.url, file, { maxBytes: CAPS.maxFileBytes });
            if (got?.status !== "ok") continue;
            media = { sha256: got.sha256, ext: u.ext, bytes: got.bytes };
            mediaFiles.set(got.sha256, file);
            note = null;
            break;
          } catch (err) {
            if (/answered 403/.test(String(err?.message))) refused.add(new URL(u.url).hostname);
            note = `proxy ${u.url}: ${String(err?.message ?? err).slice(0, 200)}`;
          }
        }
      }
    }
    const plan = planPut({ index, item, evidence: ev, media, now: now() });
    index = plan.index;
    puts.push(...plan.puts);
    results.push({ sid, action: plan.action, why: reason, verdict: ev.record.verdict.status, licence: ev.record.verdict.licence, note, refused: plan.refused });
  }

  // 4. Commit: the puts, then the index (with every episode's pins applied before the sweep;
  // conditional on R2, so a pin written meanwhile is never overwritten), then the deletes.
  const pinRequests = readPinRequests(store);
  const prepare = (ix) => {
    const s = sweep({ index: applyPins(ix, readPinRequests(store)).index, now: now() });
    return { index: s.index, deletes: s.deletes };
  };
  const first = sweep({ index: applyPins(index, pinRequests).index, now: now() });
  commit(store, { puts, deletes: [], index: null }, { mediaBody: (sha) => readFileSync(mediaFiles.get(sha)), skipIndex: true });
  const written = writeIndex(store, { index: first.index, deletes: first.deletes, etag: read.etag, prepare });
  for (const k of written.deletes) store.delete(k);
  index = written.index;
  let indexEtag = written.etag;
  const swept = { deletes: written.deletes };
  // Pin requests whose window has passed are removed; their pins lapse in the index by date.
  for (const r of expiredPinRequests(pinRequests, now().getTime())) store.delete(r.key);

  // 5. The weekly pool, once per issue.
  let pool = { issue: null, status: "no weekly issue seen" };
  if (weekly?.issue) {
    const key = poolKey(weekly.issue);
    if (store.get(key) != null) pool = { issue: weekly.issue, status: "already written" };
    else {
      const wr = await weekRecord(weekly.issue, { root, reader: weekly.reader });
      if (!wr.record) pool = { issue: weekly.issue, status: "waiting", reason: wr.reason };
      else {
        const fit = fitPool((maxItems) => buildPool({ issue: weekly.issue, record: wr.record, index, editions, channels, now: now(), from: wr.from, maxItems }));
        if (!fit) pool = { issue: weekly.issue, status: "refused", reason: `over the ${MAX_POOL_BYTES}-byte pool cap even at three items a story` };
        else if (storedBytes(index) + Buffer.byteLength(fit.body) > CAPS.bucketCapBytes) pool = { issue: weekly.issue, status: "refused", reason: `over the ${CAPS.bucketCapBytes}-byte bucket cap` };
        else {
          const { doc, body } = fit;
          store.put(key, body);
          index.overhead_bytes += Buffer.byteLength(body);
          const again = writeIndex(store, { index, deletes: [], etag: indexEtag, prepare: (ix) => ({ index: ix, deletes: [] }) });
          index = again.index;
          indexEtag = again.etag;
          const copy = path.join(outDir, "weekly", String(weekly.issue), "pool.json");
          mkdirSync(path.dirname(copy), { recursive: true });
          writeFileSync(copy, scrub(body, secrets));
          pool = { issue: weekly.issue, status: "written", built_at: doc.built_at, items_per_story: fit.maxItems, stories: doc.stories.length, items: doc.stories.reduce((n, s) => n + s.items.length, 0) };
        }
      }
    }
  }

  const count = (a) => results.filter((r) => r.action === a).length;
  const report = {
    schema: HEARTBEAT_SCHEMA,
    ran_at: iso(ranAt),
    run_id: runId ? String(runId) : null,
    store: mode,
    listed: listed.length,
    selected: chosen.size,
    stored: count("put"),
    metadata: count("metadata"),
    refused: count("refused"),
    deferred,
    swept: swept.deletes.length,
    index_items: Object.keys(index.items).length,
    stored_bytes: storedBytes(index),
    reconcile: reconciled,
    listers: Object.fromEntries(Object.entries(listerStatus).map(([k, v]) => [k, v.status])),
    pool,
  };
  // Scrubbed of every secret's value (an R2 key id included): the report can sit in a public artifact.
  writeFileSync(path.join(outDir, "report.json"), scrub(`${JSON.stringify({ ...report, lister_detail: listerStatus, results }, null, 1)}\n`, secrets));
  if (!answered) throw new Error("no lister answered; nothing was captured (the heartbeat was not written)");

  // 6. The heartbeat, last: it says the whole run landed.
  store.put(HEARTBEAT_KEY, `${JSON.stringify(report)}\n`);
  log(`capture: ${report.listed} listed, ${report.selected} selected, ${report.stored} stored, ${report.metadata} metadata only, ${report.refused} refused, ${deferred} deferred; pool: ${pool.status}`);
  return report;
}

// ---- CLI ---------------------------------------------------------------------------

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : null;
  };
  const mode = arg("store");
  const outDir = path.resolve(arg("out") ?? "capture-out");
  const workDir = path.resolve(arg("work") ?? mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "omnibus-capture-")));
  const channels = loadChannels();
  let store;
  let reader;
  if (mode === "r2") {
    const { captureStore, snapshotReadStore } = await import("../capture-r2.mjs");
    store = captureStore();
    reader = r2Reader(await snapshotReadStore(), path.join(workDir, "snapshots-r2"));
  } else if (mode === "dir") {
    const { dirStore } = await import("../capture-r2.mjs");
    const { runSnapshot } = await import("../snapshot.mjs");
    store = dirStore(path.join(outDir, "store"));
    // No R2: today's printed day, captured now, is the only edition the run can read.
    const snapDir = path.join(workDir, "snapshots");
    await runSnapshot({ outDir: snapDir, log: () => {} });
    reader = dirReader(snapDir);
  } else {
    console.error("usage: node scripts/capture/run.mjs --store r2|dir --out <dir> [--work <dir>]");
    return 2;
  }
  const editions = snapshotEditions(reader, { n: channels.editions, top: channels.top_clusters });
  const issue = latestWeeklyIssue(reader);
  try {
    await runCapture({ store, mode, outDir, workDir, editions, channels, weekly: issue ? { issue, reader: mode === "r2" ? reader : null } : null });
  } finally {
    if (!arg("work")) rmSync(workDir, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`capture: ${err.message}`);
      process.exit(1);
    },
  );
}
