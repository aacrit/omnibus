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
  if (cmd === "packet") {
    const out = writePacket(repoRoot, parseIssue(issueArg));
    console.log(`rights: wrote ${path.relative(repoRoot, out)}`);
    return 0;
  }
  if (cmd === "lint") return lintAll({ root: repoRoot, log: console.log, error: console.error });
  console.error("usage: node scripts/rights.mjs resolve <issue> | fetch <issue> --media <dir> [--dry-run] [--redo <id,id>] | coverage <issue> --media <dir> | packet <issue> | lint");
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
