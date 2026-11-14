#!/usr/bin/env node
// The CI side of .github/workflows/episode-draft.yml (C8). Net-new.
//
//   node scripts/episode-draft.mjs route <issue>
//       where the files may go (scripts/lib/draft-outputs.mjs): "artifact", only when every rights-ledger item is
//       PD, CC or our own property; otherwise exits 2 with the reason, before anything is rendered (the R2 route
//       is off, docs/tickets/C9-r2-route.md). Writes route=<r2|artifact> to
//       $GITHUB_OUTPUT when it is set.
//   node scripts/episode-draft.mjs r2-cap <dir> --listed <bytes>
//       (unreachable while the R2 route is off, C9) exits 2 when <dir>'s bytes plus what render/ lists exceed the row.
//   node scripts/episode-draft.mjs own-files <issue>
//       the ledger file names of the issue's own-property items, one a line: what the sources job places from the
//       own-pages-<issue> release (each a bare name, so it is a safe --pattern).
//   node scripts/episode-draft.mjs unusable <sources report.json> --issue <n>
//       the ledger items the sources job could not use, one line each, also to $GITHUB_STEP_SUMMARY; exits 1 when the
//       screenplay or the studio ledger cites any of them.
//   node scripts/episode-draft.mjs manifest <dir> --issue <n> --sha <commit> [--run <id>] [--ref <ref>]
//       [--until <s>] [--res <h>] [--sources <sources report.json>]
//       writes <dir>/render-manifest.json: what was rendered, the unusable item ids, and every file under <dir>
//       with its bytes and sha256, which scripts/pull-render.mjs checks on the laptop.

import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { MANIFEST, buildManifest, citedIn, listFiles, outputsRoute, r2CapProblem } from "./lib/draft-outputs.mjs";
import { ownFiles } from "./lib/rights/pull.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function issueOf(s) {
  if (!/^\d{1,4}$/.test(String(s ?? ""))) throw new Error(`not an issue number: ${s}`);
  return Number(s);
}

const budget = () => parseYaml(readFileSync(path.join(repoRoot, "budget.yaml"), "utf8"));

function unusableOf(file) {
  if (!file) return [];
  const r = JSON.parse(readFileSync(file, "utf8"));
  return (r.items ?? []).filter((i) => r.unusable?.includes(i.id)).map((i) => ({ id: i.id, outcome: i.outcome, detail: i.detail ?? null }));
}

/** Every string the episode's screenplay and its studio ledger hold: an id among them is cited (aired or derived from). */
function citedStrings(issue) {
  const dir = path.join(repoRoot, "episodes", String(issue));
  const play = JSON.parse(readFileSync(path.join(dir, "screenplay.json"), "utf8"));
  const docs = [play];
  const studio = play.ledgers?.studio;
  if (studio) docs.push(JSON.parse(readFileSync(path.join(dir, typeof studio === "string" ? studio : studio.path), "utf8")));
  return citedIn(docs);
}

async function main(argv) {
  const [cmd, arg] = argv;
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (cmd === "route") {
    const issue = issueOf(arg);
    const ledger = JSON.parse(readFileSync(path.join(repoRoot, "episodes", String(issue), "rights-ledger.json"), "utf8"));
    const r = outputsRoute({ ledger });
    console.log(`episode-draft: ${r.message}`);
    if (r.refused) return 2;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `route=${r.route}\n`);
    return 0;
  }
  if (cmd === "r2-cap") {
    const dir = path.resolve(arg);
    const bytes = listFiles(dir).reduce((a, f) => a + statSync(path.join(dir, ...f.split("/"))).size, 0);
    const why = r2CapProblem({ bytes, listed: Number(flag("listed")), budget: budget() });
    if (why) {
      console.error(`episode-draft: refused: ${why}`);
      return 2;
    }
    console.log(`episode-draft: ${(bytes / 1024 ** 2).toFixed(1)} MiB fits under the R2 render cap`);
    return 0;
  }
  if (cmd === "own-files") {
    const issue = issueOf(arg);
    const ledger = JSON.parse(readFileSync(path.join(repoRoot, "episodes", String(issue), "rights-ledger.json"), "utf8"));
    for (const f of ownFiles(ledger)) console.log(f);
    return 0;
  }
  if (cmd === "unusable") {
    const rows = unusableOf(arg);
    const cited = citedStrings(issueOf(flag("issue")));
    const lines = rows.length ? rows.map((r) => `- ${r.id}: ${r.outcome}${r.detail ? ` (${r.detail})` : ""}${cited.has(r.id) ? " (CITED by the screenplay or studio ledger)" : ""}`) : ["- none"];
    const text = ["### ledger items not usable on this run (reported, not worked around)", "", ...lines, ""].join("\n");
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
    const bad = rows.filter((r) => cited.has(r.id)).map((r) => r.id);
    if (bad.length) {
      console.error(`episode-draft: refused: the screenplay or studio ledger cites unusable item(s): ${bad.join(", ")}`);
      return 1;
    }
    return 0;
  }
  if (cmd === "manifest") {
    const dir = path.resolve(arg);
    const m = await buildManifest(dir, {
      issue: issueOf(flag("issue")),
      run: flag("run") ?? null,
      sha: flag("sha"),
      ref: flag("ref") || null,
      until: flag("until") ? Number(flag("until")) : null,
      res: flag("res") ? Number(flag("res")) : null,
      unusable: unusableOf(flag("sources")).map((r) => r.id),
      unusableCited: unusableOf(flag("sources")).map((r) => r.id).filter((id) => citedStrings(issueOf(flag("issue"))).has(id)),
    });
    writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
    const bytes = m.files.reduce((a, f) => a + f.bytes, 0);
    console.log(`episode-draft: ${m.files.length} files, ${(bytes / 1024 ** 2).toFixed(1)} MiB -> ${path.join(dir, MANIFEST)}`);
    return 0;
  }
  console.error("usage: node scripts/episode-draft.mjs route <issue> | r2-cap <dir> --listed <bytes> | unusable <report> | manifest <dir> --issue <n> --sha <commit> [...]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`episode-draft: ${err.message}`);
      process.exit(1);
    },
  );
}
