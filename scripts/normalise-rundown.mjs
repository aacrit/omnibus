#!/usr/bin/env node
// Show bible v2, ticket 2: builds episodes/<n>/desk.json (void news's threads
// for the window, scored by its weekly formula) and episodes/<n>/rundown.json
// (omnibus.rundown/2: the hand-checked stories ranked by weight, footage
// cleared from the rights ledger and the capture pool, shapes by the cap).
// The rules are in scripts/lib/rundown2.mjs; the pin and the reading of void
// news's history in scripts/lib/desk-source.mjs.
//
//   node scripts/normalise-rundown.mjs --issue 35 --from 2026-11-16 --to 2026-11-21 [--voidnews ../voidnews] [--at <sha>] [--pool <path>]
//
// --at bounds the history (default origin/main); the pin is the first commit
// in it whose archive.json holds the --to day's print, else its newest. A
// rundown rebuilt with --at its own edition.archive_commit and the same
// episode files comes out byte for byte the same.
// Read when present: episodes/<n>/rundown-edit.json (the hand check of threads
// and the editorial fields) and episodes/<n>/rights-ledger.json.
// --check rebuilds in memory and fails when either committed file differs.
// --crosscheck writes weekly-crosscheck.json: the weekly edition for the window, read at the history's head
// (it prints after the pin), against the rundown's ranking. The rundown itself never changes for it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crosscheckAt, gitDesk, normaliseRundown } from "./lib/desk-source.mjs";
import { rundownProblems, serialise, sha256 } from "./lib/rundown2.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const issue = Number(arg("issue"));
const from = arg("from");
const to = arg("to");
if (!Number.isInteger(issue) || issue < 1 || !DATE.test(from ?? "") || !DATE.test(to ?? "")) {
  console.error("usage: node scripts/normalise-rundown.mjs --issue <n> --from YYYY-MM-DD --to YYYY-MM-DD [--voidnews <dir>] [--at <sha>] [--pool <path>] [--check]");
  process.exit(2);
}

// --out writes (and --check compares) somewhere other than episodes/<n> (the week 33 regression fixture); the
// episode's own files are still read from --episode (default episodes/<n>).
const ep = path.resolve(arg("episode") ?? path.join(repoRoot, "episodes", String(issue)));
const out = path.resolve(arg("out") ?? ep);
const read = (p) => {
  if (!p || !existsSync(p)) return { doc: null, ref: null };
  const text = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  return { doc: JSON.parse(text), ref: { path: path.relative(repoRoot, p).split(path.sep).join("/"), sha256: sha256(text) } };
};
const edit = read(path.join(ep, "rundown-edit.json"));
const ledger = read(path.join(ep, "rights-ledger.json"));
const pool = read(arg("pool") ? path.resolve(arg("pool")) : null);

const source = gitDesk(path.resolve(arg("voidnews") ?? process.env.VOIDNEWS_DIR ?? path.join(repoRoot, "..", "voidnews")), { at: arg("at", "origin/main") });
const { desk, rundown, pin } = normaliseRundown(source, {
  issue,
  from,
  to,
  edit: edit.doc,
  ledger: ledger.doc,
  pool: pool.doc,
  inputs: { edit: edit.ref, rights_ledger: ledger.ref, capture_pool: pool.ref },
});
const problems = rundownProblems(rundown);
if (problems.length) {
  console.error(`normalise-rundown: the rundown is not well formed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const files = [
  [path.join(out, "desk.json"), serialise(desk)],
  [path.join(out, "rundown.json"), serialise(rundown)],
];
if (process.argv.includes("--check")) {
  const stale = files.filter(([f, text]) => !existsSync(f) || readFileSync(f, "utf8").replace(/\r\n/g, "\n") !== text);
  if (stale.length) {
    console.error(`normalise-rundown: ${stale.map(([f]) => path.relative(repoRoot, f)).join(", ")} differ from the rebuild at ${pin.commit}`);
    process.exit(1);
  }
  console.log(`normalise-rundown: ${path.relative(repoRoot, out)} rebuilt byte for byte at ${pin.commit}`);
  process.exit(0);
}
if (process.argv.includes("--crosscheck")) {
  // The weekly edition arrives after the pin: read it at the history's head, and log the comparison beside the
  // rundown without changing it (bible k: a disagreement is logged, never used to rank).
  const log = crosscheckAt(source, { issue, from, to, pin, rundown });
  writeFileSync(path.join(out, "weekly-crosscheck.json"), serialise(log));
  console.log(`normalise-rundown: weekly edition ${log.weekly_edition_seen ? `issue ${log.issue}, covers ${log.agree ? "agree" : "DISAGREE"}` : "not yet printed"} (read at ${log.read_at})`);
  process.exit(0);
}
mkdirSync(out, { recursive: true });
for (const [f, text] of files) writeFileSync(f, text);
console.log(`normalise-rundown: issue ${issue}, ${from} to ${to}, pinned ${pin.commit} (${pin.committed_at}); ${desk.window.days_present.length}/${desk.window.days.length} days printed`);
for (const s of rundown.stories) {
  console.log(`  ${String(s.rank).padStart(3)}  ${s.slot.padEnd(10)} ${s.shape.padEnd(9)} ${s.weight.toFixed(4)}  ${String(s.footage_cleared_s).padStart(5)} s  ${s.key}  ${s.desk_title.slice(0, 70)}`);
}
