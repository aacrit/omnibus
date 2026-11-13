#!/usr/bin/env node
// The CI side of .github/workflows/episode-draft.yml (C8). Net-new.
//
//   node scripts/episode-draft.mjs route <issue>
//       where the outputs may go (scripts/lib/draft-outputs.mjs): "r2" when the R2 secrets are set
//       (HAS_R2=true), else "artifact" only when every rights-ledger item is PD, CC or our own property;
//       otherwise exits 2 with the reason, before anything is rendered. Writes route=<r2|artifact> to
//       $GITHUB_OUTPUT when it is set.
//   node scripts/episode-draft.mjs manifest <dir> --issue <n> [--run <id>]
//       writes <dir>/render-manifest.json: every file under <dir> with its bytes and sha256, which
//       scripts/pull-render.mjs checks on the laptop.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST, buildManifest, outputsRoute } from "./lib/draft-outputs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function issueOf(s) {
  if (!/^\d{1,4}$/.test(String(s ?? ""))) throw new Error(`not an issue number: ${s}`);
  return Number(s);
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
    const r = outputsRoute({ ledger, hasR2: process.env.HAS_R2 === "true" });
    console.log(`episode-draft: ${r.message}`);
    if (r.refused) return 2;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `route=${r.route}\n`);
    return 0;
  }
  if (cmd === "manifest") {
    const dir = path.resolve(arg);
    const m = await buildManifest(dir, { issue: issueOf(flag("issue")), run: flag("run") ?? null });
    writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
    const bytes = m.files.reduce((a, f) => a + f.bytes, 0);
    console.log(`episode-draft: ${m.files.length} files, ${(bytes / 1024 ** 2).toFixed(1)} MiB -> ${path.join(dir, MANIFEST)}`);
    return 0;
  }
  console.error("usage: node scripts/episode-draft.mjs route <issue> | manifest <dir> --issue <n> [--run <id>]");
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
