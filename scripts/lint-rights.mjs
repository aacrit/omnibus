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

export function lintAll({ root = repoRoot, log = console.log, error = console.error } = {}) {
  const { findings, ledgers, items } = lintRepo(root);
  if (findings.length) {
    error(`lint-rights: ${findings.length} blocking finding(s)\n${findings.map((f) => `  - [${f.rule}] ${f.where} ${f.item}: ${f.message}`).join("\n")}`);
    return 1;
  }
  if (ledgers === 0) log("lint-rights: no episode has a rights ledger yet, so there was nothing to check");
  else log(`lint-rights: ${ledgers} ledger(s), ${items} item(s): licence-allowlist, licence-evidence, ai-generated-share-zero and disputes-generated pass`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(lintAll());
}
