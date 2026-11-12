#!/usr/bin/env node
// Studio stage 8, fetch and rights (bible section h): the asset fetcher, the
// rights ledger and the dispute packet, per episode.
//
//   node scripts/rights.mjs fetch <issue> --media <dir> [--dry-run]
//       reads episodes/<issue>/assets.json (the rundown's ranked asset
//       requests), fills each from the first candidate that passes every
//       check, writes media to <dir>/<issue>/ (outside the repo; also
//       OMNIBUS_MEDIA), then episodes/<issue>/rights-ledger.json and
//       disputes.json. --dry-run reads metadata only and writes nothing.
//   node scripts/rights.mjs packet <issue>
//       regenerates episodes/<issue>/disputes.json from the ledger.
//   node scripts/rights.mjs lint
//       the gate's rights lints over every episode (scripts/lint-rights.mjs).
//
// DVIDS is optional: set DVIDS_API_KEY to use it; without it DVIDS
// candidates are skipped with a reason and the next candidate is tried.
// Media never goes in git (rule 8): the media directory must lie outside
// the repo, and the ledger records only a bare file name.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as commons from "./lib/rights/adapters/commons.mjs";
import * as dvids from "./lib/rights/adapters/dvids.mjs";
import * as loc from "./lib/rights/adapters/loc.mjs";
import * as nasa from "./lib/rights/adapters/nasa.mjs";
import { buildDisputePacket, serialisePacket } from "./lib/rights/disputes.mjs";
import { fetchRequests } from "./lib/rights/fetcher.mjs";
import { getJson, getMedia } from "./lib/rights/http.mjs";
import { emptyLedger, serialiseLedger, validateLedger, validateRequests } from "./lib/rights/ledger.mjs";
import { lintAll } from "./lint-rights.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ADAPTERS = { commons, nasa, loc, dvids };
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

export async function runFetch({ root = repoRoot, issue, mediaDir, dryRun = false, env = process.env, http = { getJson, getMedia }, now, log = console.log }) {
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
    const { report } = await runFetch({ issue, mediaDir, dryRun });
    const counts = report.reduce((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] ?? 0) + 1 }), {});
    console.log(`rights: issue ${issue}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "no requests"}`);
    if (!process.env.DVIDS_API_KEY) console.log("rights: DVIDS_API_KEY is not set, so DVIDS candidates were skipped (optional)");
    return 0;
  }
  if (cmd === "packet") {
    const out = writePacket(repoRoot, parseIssue(issueArg));
    console.log(`rights: wrote ${path.relative(repoRoot, out)}`);
    return 0;
  }
  if (cmd === "lint") return lintAll({ root: repoRoot, log: console.log, error: console.error });
  console.error("usage: node scripts/rights.mjs fetch <issue> --media <dir> [--dry-run] | packet <issue> | lint");
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
