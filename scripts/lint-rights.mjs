#!/usr/bin/env node
// Gate step: the blocking rights lints over every episode's ledger
// (episodes/<issue>/rights-ledger.json): rights-ledger-schema,
// licence-allowlist, licence-evidence, ai-generated-share-zero (metadata
// level) and disputes-generated. A disputes.json with no ledger beside it
// also fails. An episode with no ledger yet has nothing to lint, and the
// step says how many ledgers it read.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintEpisode } from "./lib/rights/lints.mjs";
import { isVideo } from "./lib/rights/licences.mjs";
import { hashLocal } from "./lib/rights/http.mjs";
import { cutsDisagree, detectCuts } from "./lib/rights/scenes.mjs";

/**
 * Where the media is present (OMNIBUS_MEDIA: <dir>/<issue>/<file>), every video's recorded cuts are found again in
 * the file over the span they name, and the file must be the ledger's sha256 (rights fix 4 review). One ffmpeg at a
 * time, two threads, the aired span only. Without the media (CI) the structural checks stand alone.
 */
export async function rederiveCuts(ledger, issueMedia, { detect = detectCuts, hash = hashLocal } = {}) {
  const out = [];
  for (const it of ledger?.items ?? []) {
    const cuts = it?.marks_checked?.reviewed?.cuts;
    if (!isVideo(it) || !cuts || !Array.isArray(cuts.span) || !it.file) continue;
    const file = path.join(issueMedia, it.file);
    if (!existsSync(file)) continue;
    const h = await hash(file, { mime: it.mime });
    if (h?.sha256 !== it.sha256) {
      out.push({ rule: "cuts-rederived", item: it.id, message: `the file ${it.file} is not the ledger's (sha256 ${String(h?.sha256).slice(0, 12)}, ledger ${String(it.sha256).slice(0, 12)})` });
      continue;
    }
    const found = await detect(file, { fromS: cuts.span[0], toS: cuts.span[1] ?? null, threshold: cuts.threshold });
    const d = cutsDisagree(cuts.times, found.times, found.span);
    if (d.missing.length || d.extra.length) out.push({ rule: "cuts-rederived", item: it.id, message: `the recorded cuts disagree with the file's own over ${cuts.span[0]}..${cuts.span[1] ?? "end"} s (the file cuts at ${d.missing.join(", ") || "no other time"}, the record at ${d.extra.join(", ") || "no other time"}): fetch it again` });
  }
  return out;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every finding across the repo's episodes, and how many ledgers were read. */
export function lintRepo(root, { now = new Date() } = {}) {
  const base = path.join(root, "episodes");
  const findings = [];
  let ledgers = 0;
  let items = 0;
  if (!existsSync(base)) return { findings, ledgers, items };
  for (const name of readdirSync(base).sort()) {
    const dir = path.join(base, name);
    const ledgerPath = path.join(dir, "rights-ledger.json");
    const disputesPath = path.join(dir, "disputes.json");
    const rel = `episodes/${name}`;
    if (!existsSync(ledgerPath)) {
      if (existsSync(disputesPath)) findings.push({ rule: "disputes-generated", item: "-", message: "disputes.json has no rights-ledger.json beside it", where: rel });
      continue;
    }
    ledgers++;
    const ledgerText = readFileSync(ledgerPath, "utf8");
    let ledger;
    try {
      ledger = JSON.parse(ledgerText);
    } catch (err) {
      findings.push({ rule: "rights-ledger-schema", item: "-", message: `not JSON: ${err.message}`, where: rel });
      continue;
    }
    if (String(ledger?.issue) !== name) {
      findings.push({ rule: "rights-ledger-schema", item: "-", message: `the ledger is for issue ${ledger?.issue}, in folder ${name}`, where: rel });
    }
    items += Array.isArray(ledger?.items) ? ledger.items.length : 0;
    const disputesText = existsSync(disputesPath) ? readFileSync(disputesPath, "utf8") : null;
    for (const f of lintEpisode({ ledger, ledgerText, disputesText, now })) findings.push({ ...f, where: rel });
  }
  return { findings, ledgers, items };
}

export async function lintAll({ root = repoRoot, log = console.log, error = console.error, media = process.env.OMNIBUS_MEDIA } = {}) {
  const { findings, ledgers, items } = lintRepo(root);
  if (media) {
    for (const name of readdirSync(path.join(root, "episodes")).sort()) {
      const lp = path.join(root, "episodes", name, "rights-ledger.json");
      if (!existsSync(lp)) continue;
      let ledger;
      try {
        ledger = JSON.parse(readFileSync(lp, "utf8"));
      } catch {
        continue;
      }
      for (const f of await rederiveCuts(ledger, path.join(media, name))) findings.push({ ...f, where: `episodes/${name}` });
    }
  }
  if (findings.length) {
    error(`lint-rights: ${findings.length} blocking finding(s)\n${findings.map((f) => `  - [${f.rule}] ${f.where} ${f.item}: ${f.message}`).join("\n")}`);
    return 1;
  }
  if (ledgers === 0) log("lint-rights: no episode has a rights ledger yet, so there was nothing to check");
  else log(`lint-rights: ${ledgers} ledger(s), ${items} item(s): rights-ledger-schema, licence-allowlist (with on-screen marks), licence-evidence, ai-generated-share-zero, fair-use-excerpt, published-by-edition and disputes-generated pass`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await lintAll());
}
