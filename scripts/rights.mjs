#!/usr/bin/env node
// Studio stage 8, fetch and rights (bible section h): the asset fetcher, the
// rights ledger and the dispute packet, per episode.
//
//   node scripts/rights.mjs resolve <issue>
//       resolves rundown.json's asset ladders (searches) into concrete
//       candidates in episodes/<issue>/assets.json; federal .gov and Wayback
//       steps are read through episodes/<issue>/asset-pins.json.
//   node scripts/rights.mjs fetch <issue> --media <dir> [--dry-run] [--redo <id,id>]
//       reads episodes/<issue>/assets.json (the rundown's ranked asset
//       requests), fills each from the first candidate that passes every
//       check, writes media to <dir>/<issue>/ (outside the repo; also
//       OMNIBUS_MEDIA), then episodes/<issue>/rights-ledger.json and
//       disputes.json. --dry-run reads metadata only and writes nothing.
//       A request already in the ledger is held; --redo fills the named
//       ones again from their whole ladder, keeping the held item when
//       nothing on the ladder passes.
//   node scripts/rights.mjs coverage <issue> --media <dir>
//       writes episodes/<issue>/ASSETS.md (request to item or fallback, tier,
//       licence, seconds measured by ffprobe, file path) from the ledger.
//   node scripts/rights.mjs capture <issue> --media <dir> [--voidnews <checkout>]
//       renders void news's own pages the pins name (headless Chromium,
//       scripts/capture_page.py) into stills and voidnews-captures.json.
//   node scripts/rights.mjs candidates <issue> [--pool r2|artifact|<path>] [--airs-on <date>] [--no-pin]
//       turns the capture's weekly pool (capture/weekly/<issue>/pool.json:
//       from R2, the default; from the newest capture run's artifact through
//       gh; or a file) into episodes/<issue>/candidates/capture.json, mapped to
//       the rundown's requests by cluster id and day. Every fit is automatic:
//       a final render refuses it until a session confirms it
//       (capture-fit-confirmed, scripts/capture/pool.mjs). It then pins every
//       captured item it names in R2 (capture/pins/<issue>.json, and the index
//       itself where R2's S3 API can write it conditionally), so their proxies
//       outlive the 14-day sweep until the episode airs plus 30 days.
//   node scripts/rights.mjs packet <issue>
//       regenerates episodes/<issue>/disputes.json from the ledger.
//   node scripts/rights.mjs lint
//       the gate's rights lints over every episode (scripts/lint-rights.mjs).
//
// DVIDS is optional: set DVIDS_API_KEY to use it; without it DVIDS
// candidates are skipped with a reason and the next candidate is tried.
// Media never goes in git (rule 8): the media directory must lie outside
// the repo, and the ledger records only a bare file name.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as commons from "./lib/rights/adapters/commons.mjs";
import * as dvids from "./lib/rights/adapters/dvids.mjs";
import * as gov from "./lib/rights/adapters/gov.mjs";
import * as loc from "./lib/rights/adapters/loc.mjs";
import * as nara from "./lib/rights/adapters/nara.mjs";
import * as nasa from "./lib/rights/adapters/nasa.mjs";
import * as voidnews from "./lib/rights/adapters/voidnews.mjs";
import * as voa from "./lib/rights/adapters/voa.mjs";
import * as wayback from "./lib/rights/adapters/wayback.mjs";
import { buildCoverage } from "./lib/rights/coverage.mjs";
import { runCapture } from "./lib/rights/capture.mjs";
import { buildDisputePacket, serialisePacket } from "./lib/rights/disputes.mjs";
import { fetchRequests } from "./lib/rights/fetcher.mjs";
import { getJson, getMedia, getText } from "./lib/rights/http.mjs";
import { emptyLedger, serialiseLedger, validateLedger, validateRequests } from "./lib/rights/ledger.mjs";
import { mergeCandidatePins, pinProblems, resolveRequests } from "./lib/rights/resolve.mjs";
import { lintAll } from "./lint-rights.mjs";
import { candidatesFromPool, poolKey, poolProblems } from "./capture/pool.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ADAPTERS = { commons, nasa, loc, dvids, gov, nara, wayback, voidnews, voa };
export const CHECKED_BY = "void omnibus fetcher, metadata checks (scripts/rights.mjs)";

export function episodeDir(root, issue) {
  return path.join(root, "episodes", String(issue));
}

/** Refuses a media directory inside the repo: media never goes in git. */
export function assertMediaOutsideRepo(mediaDir, root = repoRoot) {
  if (!mediaDir || !path.isAbsolute(mediaDir)) throw new Error("--media (or OMNIBUS_MEDIA) must be an absolute directory outside the repo");
  const rel = path.relative(path.resolve(root), path.resolve(mediaDir));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`media directory ${mediaDir} is inside the repo; media never goes in git (rule 8)`);
  }
}

function parseIssue(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error(`issue must be a whole number, got "${v}"`);
  return n;
}

export function writePacket(root, issue) {
  const dir = episodeDir(root, issue);
  const ledgerPath = path.join(dir, "rights-ledger.json");
  const text = readFileSync(ledgerPath, "utf8");
  const ledger = JSON.parse(text);
  const problems = validateLedger(ledger);
  if (problems.length) throw new Error(`rights-ledger.json is invalid:\n  ${problems.join("\n  ")}`);
  const out = path.join(dir, "disputes.json");
  writeFileSync(out, serialisePacket(buildDisputePacket(ledger, text)));
  return out;
}

export async function runFetch({ root = repoRoot, issue, mediaDir, dryRun = false, redo = [], env = process.env, http = { getJson, getMedia, getText }, now, log = console.log }) {
  const dir = episodeDir(root, issue);
  const reqPath = path.join(dir, "assets.json");
  if (!existsSync(reqPath)) throw new Error(`${path.relative(root, reqPath)} not found: the rundown writes the asset requests`);
  const requests = JSON.parse(readFileSync(reqPath, "utf8"));
  const reqProblems = validateRequests(requests);
  if (requests.issue !== issue) reqProblems.push(`assets.json is for issue ${requests.issue}, not ${issue}`);
  if (reqProblems.length) throw new Error(`assets.json is invalid:\n  ${reqProblems.join("\n  ")}`);
  const ledgerPath = path.join(dir, "rights-ledger.json");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : emptyLedger(issue);
  const issueMedia = dryRun ? null : path.join(mediaDir, String(issue));
  if (!dryRun) {
    assertMediaOutsideRepo(mediaDir, root);
    mkdirSync(issueMedia, { recursive: true });
  }
  const result = await fetchRequests(requests, ledger, {
    adapters: ADAPTERS,
    http,
    mediaDir: issueMedia,
    checkedBy: CHECKED_BY,
    env,
    now,
    dryRun,
    redo,
    log,
  });
  if (!dryRun) {
    const problems = validateLedger(result.ledger);
    if (problems.length) throw new Error(`refusing to write an invalid ledger:\n  ${problems.join("\n  ")}`);
    writeFileSync(ledgerPath, serialiseLedger(result.ledger));
    writePacket(root, issue);
  }
  return result;
}

/** Resolves the rundown's asset requests into episodes/<issue>/assets.json (resolve.mjs). */
export async function runResolve({ root = repoRoot, issue, http = { getJson, getText }, log = console.log }) {
  const dir = episodeDir(root, issue);
  const rundown = JSON.parse(readFileSync(path.join(dir, "rundown.json"), "utf8"));
  if (rundown.issue !== issue) throw new Error(`rundown.json is for issue ${rundown.issue}, not ${issue}`);
  const pinsPath = path.join(dir, "asset-pins.json");
  const pinsDoc = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : { pins: {} };
  // The sourcing passes' candidate pins (episodes/<issue>/candidates/*.json) join the hand pins.
  const candDir = path.join(dir, "candidates");
  const files = existsSync(candDir) ? readdirSync(candDir).filter((n) => n.endsWith(".json")).map((name) => ({ name, doc: JSON.parse(readFileSync(path.join(candDir, name), "utf8")) })) : [];
  const merged = mergeCandidatePins(pinsDoc.pins, files, { issue, requestIds: new Set((rundown.asset_requests ?? []).map((r) => r.id)) });
  if (merged.problems.length) throw new Error(`candidate pins are invalid:\n  ${merged.problems.join("\n  ")}`);
  pinsDoc.pins = merged.pins;
  const bad = pinProblems(pinsDoc.pins);
  if (bad.length) throw new Error(`asset-pins.json names addresses the fetcher may not reach:\n  ${bad.join("\n  ")}`);
  const echoPath = path.join(dir, "echo-pick.json");
  const echoPick = existsSync(echoPath) ? JSON.parse(readFileSync(echoPath, "utf8")) : null;
  const doc = await resolveRequests(rundown, { pins: pinsDoc.pins, echoPick, http, log });
  const problems = validateRequests(doc);
  if (problems.length) throw new Error(`refusing to write invalid assets.json:\n  ${problems.join("\n  ")}`);
  const out = path.join(dir, "assets.json");
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  return out;
}

/** The capture pool for an issue: from R2, from the newest capture artifact holding it (gh), or from a file. */
export function readPool(issue, where = "r2", { root = repoRoot } = {}) {
  if (where === "r2") {
    return import("./capture-r2.mjs").then(({ captureStore }) => {
      const text = captureStore().get(poolKey(issue));
      if (text == null) throw new Error(`r2://omnibus-capture/${poolKey(issue)} does not exist yet`);
      return JSON.parse(text);
    });
  }
  if (where === "artifact") {
    const gh = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", timeout: 300_000 });
    const runs = JSON.parse(gh(["run", "list", "--workflow", "capture.yml", "--limit", "40", "--json", "databaseId,status"])).filter((r) => r.status === "completed");
    for (const r of runs) {
      const dir = path.join(root, ".cache", "capture-artifacts", String(r.databaseId));
      if (!existsSync(dir)) {
        try {
          gh(["run", "download", String(r.databaseId), "--name", `capture-${r.databaseId}`, "--dir", dir]);
        } catch {
          continue;
        }
      }
      for (const f of [path.join(dir, "weekly", String(issue), "pool.json"), path.join(dir, "store", ...poolKey(issue).split("/"))]) {
        if (!existsSync(f)) continue;
        const pool = JSON.parse(readFileSync(f, "utf8"));
        const report = existsSync(path.join(dir, "report.json")) ? JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) : null;
        const why = artifactPoolProblem(pool, report, issue);
        if (why) return Promise.reject(new Error(`capture run ${r.databaseId}: ${why}`));
        return Promise.resolve(pool);
      }
    }
    return Promise.reject(new Error(`no capture artifact of the last ${runs.length} runs holds the pool for issue ${issue}`));
  }
  return Promise.resolve(JSON.parse(readFileSync(path.resolve(where), "utf8")));
}

/** The captured source ids a candidates file pins. */
export function capturedSids(doc) {
  return [...new Set(Object.values(doc?.pins ?? {}).flatMap((list) => list.map((p) => p.capture?.sid).filter(Boolean)))];
}

/** Why an artifact's pool is not the one its own run wrote for this issue, or null. Pure. */
export function artifactPoolProblem(pool, report, issue) {
  if (pool?.issue !== issue) return `its pool is for issue ${pool?.issue}, not ${issue}`;
  if (!report) return "it holds a pool but no report.json from the run that wrote it";
  if (report.pool?.issue !== issue || report.pool?.status !== "written") return `its report says the pool for issue ${issue} was not written by this run (${report.pool?.status ?? "no pool"})`;
  if (report.pool.built_at && report.pool.built_at !== pool.built_at) return `its pool was built at ${pool.built_at}, but the run reports ${report.pool.built_at}`;
  const lag = Date.parse(pool.built_at) - Date.parse(report.ran_at);
  if (!(lag >= 0 && lag <= 30 * 60_000)) return `its pool was built at ${pool.built_at}, outside the run that started at ${report.ran_at}`;
  return null;
}

/** Writes episodes/<issue>/candidates/capture.json from the pool; refuses a file mergeCandidatePins would refuse. */
export function writeCaptureCandidates({ root = repoRoot, issue, pool, now = new Date() }) {
  const pp = poolProblems(pool);
  if (pp.length) throw new Error(`the pool is not well formed:\n  ${pp.join("\n  ")}`);
  if (pool.issue !== issue) throw new Error(`the pool is for issue ${pool.issue}, not ${issue}`);
  const dir = episodeDir(root, issue);
  const rundown = JSON.parse(readFileSync(path.join(dir, "rundown.json"), "utf8"));
  const { doc, problems } = candidatesFromPool(pool, rundown, { now });
  if (problems.length) throw new Error(`the pool does not map onto the rundown:\n  ${problems.join("\n  ")}`);
  const merged = mergeCandidatePins({}, [{ name: "capture.json", doc }], { issue, requestIds: new Set((rundown.asset_requests ?? []).map((r) => r.id)) });
  if (merged.problems.length) throw new Error(`refusing to write candidates the resolver would refuse:\n  ${merged.problems.join("\n  ")}`);
  mkdirSync(path.join(dir, "candidates"), { recursive: true });
  const out = path.join(dir, "candidates", "capture.json");
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  return { out, doc };
}

/** Length in seconds of a footage or sound file, read by ffprobe; null when it cannot be read. */
export function probeSeconds(file) {
  try {
    const s = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 60_000 });
    const n = Number(s.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Writes episodes/<issue>/ASSETS.md from assets.json and the ledger, measuring footage and sound on the media drive. */
export function runCoverage({ root = repoRoot, issue, mediaDir, probe = probeSeconds }) {
  const dir = episodeDir(root, issue);
  const assets = JSON.parse(readFileSync(path.join(dir, "assets.json"), "utf8"));
  const ledger = JSON.parse(readFileSync(path.join(dir, "rights-ledger.json"), "utf8"));
  const issueMedia = path.join(mediaDir, String(issue));
  const durations = {};
  for (const it of ledger.items) {
    if (it.kind === "footage" || it.kind === "sound") durations[it.file] = probe(path.join(issueMedia, it.file));
  }
  const out = path.join(dir, "ASSETS.md");
  writeFileSync(out, buildCoverage({ assets, ledger, durations, mediaDir: issueMedia.replace(/\\/g, "/") }));
  return out;
}

async function main(argv) {
  const [cmd, issueArg] = argv;
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (cmd === "fetch") {
    const issue = parseIssue(issueArg);
    const dryRun = argv.includes("--dry-run");
    const mediaDir = flag("media") ?? process.env.OMNIBUS_MEDIA;
    const redo = (flag("redo") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { report } = await runFetch({ issue, mediaDir, dryRun, redo });
    const counts = report.reduce((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] ?? 0) + 1 }), {});
    console.log(`rights: issue ${issue}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "no requests"}`);
    if (!process.env.DVIDS_API_KEY) console.log("rights: DVIDS_API_KEY is not set, so DVIDS candidates were skipped (optional)");
    return 0;
  }
  if (cmd === "resolve") {
    const out = await runResolve({ issue: parseIssue(issueArg) });
    console.log(`rights: wrote ${path.relative(repoRoot, out)}`);
    return 0;
  }
  if (cmd === "coverage") {
    const mediaDir = flag("media") ?? process.env.OMNIBUS_MEDIA;
    assertMediaOutsideRepo(mediaDir);
    const out = runCoverage({ issue: parseIssue(issueArg), mediaDir });
    console.log(`rights: wrote ${path.relative(repoRoot, out)}`);
    return 0;
  }
  if (cmd === "capture") {
    const mediaDir = flag("media") ?? process.env.OMNIBUS_MEDIA;
    assertMediaOutsideRepo(mediaDir);
    const voidnewsDir = flag("voidnews") ?? process.env.VOIDNEWS_DIR ?? path.resolve(repoRoot, "..", "voidnews");
    const out = await runCapture({ root: repoRoot, issue: parseIssue(issueArg), mediaDir, voidnewsDir, python: process.env.PYTHON ?? "python" });
    console.log(`rights: wrote ${out}`);
    return 0;
  }
  if (cmd === "candidates") {
    const issue = parseIssue(issueArg);
    const pool = await readPool(issue, flag("pool") ?? "r2");
    const { out, doc } = writeCaptureCandidates({ issue, pool });
    const n = Object.values(doc.pins).reduce((a, l) => a + l.length, 0);
    console.log(`rights: wrote ${path.relative(repoRoot, out)} (${n} automatic pin(s) on ${Object.keys(doc.pins).length} request(s); confirm each fit before a final render)`);
    // Keep the pinned items' proxies past the 14-day sweep (until the episode airs plus 30 days).
    if (!argv.includes("--no-pin")) {
      const { captureStore, pinCaptured } = await import("./capture-r2.mjs");
      const airsOn = flag("airs-on") ?? null;
      if (airsOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(airsOn)) throw new Error(`--airs-on must be a date, YYYY-MM-DD; got ${airsOn}`);
      const p = pinCaptured({ store: captureStore(), issue, sids: capturedSids(doc), airsOn });
      console.log(`rights: pinned ${p.request.sids.length} captured item(s) for issue ${issue} (${p.pinned_now ? "in the index now" : "at the next capture run"})${p.missing.length ? `; ${p.missing.length} no longer in the index` : ""}`);
    }
    return 0;
  }
  if (cmd === "packet") {
    const out = writePacket(repoRoot, parseIssue(issueArg));
    console.log(`rights: wrote ${path.relative(repoRoot, out)}`);
    return 0;
  }
  if (cmd === "lint") return lintAll({ root: repoRoot, log: console.log, error: console.error });
  console.error("usage: node scripts/rights.mjs resolve <issue> | candidates <issue> [--pool r2|artifact|<path>] | fetch <issue> --media <dir> [--dry-run] [--redo <id,id>] | coverage <issue> --media <dir> | packet <issue> | lint");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`rights: ${err.message}`);
      process.exit(1);
    },
  );
}
