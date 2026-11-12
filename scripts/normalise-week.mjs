#!/usr/bin/env node
// Normalises one void news weekly issue, and the seven daily printed
// editions it covers, into data/week-<issue>.json: the small, committed
// record that the /e/<issue> page is built from (and later, the episode's
// rundown). The rules are in scripts/lib/normalise.mjs; where the record is
// read from is in scripts/lib/week-sources.mjs.
//
// From void news's public repo at pinned commits (a checkout that only
// needs `git fetch`; everything is read with `git show <sha>:<path>` from
// origin/main's history, never the working tree):
//   node scripts/normalise-week.mjs --voidnews ../voidnews --issue 32 [--at <sha>]
// --at pins the history to a commit (default origin/main); a record rebuilt
// at its own normalised_from.origin_main comes out byte for byte the same.
//
// From the daily snapshots (scripts/snapshot.mjs), in a local directory or
// in R2 (fetched through wrangler into .cache/snapshots-r2/):
//   node scripts/normalise-week.mjs --snapshots .cache/snapshots --issue 33
//   node scripts/normalise-week.mjs --snapshots r2 --issue 33
// The history bank's echo record is read at the snapshot's commit, from
// --voidnews when given, else from void news's public raw file.
//
// --echo <slug> names the week's echo from the history bank
// (data/history/events/<slug>.yaml); --echo pending records it as not yet
// picked. Without it, week 32's candidate (spanish-flu-1918, alternate
// black-death) is used, so week 32 rebuilds unchanged.
// --schema 2 strips a provable Google News publisher suffix from board
// headlines, keeping headline_raw (scripts/lib/normalise.mjs publisherSuffix);
// the default, 1, is week 32's rules. Week 33:
//   node scripts/normalise-week.mjs --issue 33 --at dcffaaf8bf5e979808cd195de80e2403af074c64 --schema 2 --echo pending

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseWeek } from "./lib/normalise.mjs";
import { dirReader, gitSource, r2Reader, snapshotSource } from "./lib/week-sources.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const issueNo = Number(arg("issue", "32"));
const snapshots = arg("snapshots");
const voidnews = arg("voidnews");

let source;
if (snapshots === "r2") {
  const { wranglerStore } = await import("./snapshot-r2.mjs");
  source = snapshotSource(r2Reader(wranglerStore(), path.join(repoRoot, ".cache", "snapshots-r2")), { voidnews });
} else if (snapshots) {
  source = snapshotSource(dirReader(path.resolve(snapshots)), { voidnews });
} else {
  source = gitSource(path.resolve(voidnews ?? path.join(repoRoot, "..", "voidnews")), { at: arg("at", "origin/main") });
}

const schemaArg = arg("schema");
const out = await normaliseWeek(source, issueNo, {
  schema: schemaArg === undefined ? 1 : Number(schemaArg),
  echo: arg("echo"),
});
mkdirSync(path.join(repoRoot, "data"), { recursive: true });
const file = path.join(repoRoot, "data", `week-${issueNo}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(
  `normalise-week: wrote ${path.relative(repoRoot, file)} (${out.days.filter((d) => d.available).length}/7 days, ` +
    `${out.lead.board.length} board rows, ${out.margins.stories.length} margins, ${out.lead.articles} lead articles)`,
);
