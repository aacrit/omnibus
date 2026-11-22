#!/usr/bin/env node
// docs/DECISIONS.md used to be an append-only log (one shared file every PR touched),
// which conflicted on every PR that recorded a decision. It is now a one-time, static
// index (docs/decisions/YYYY-MM-DD-split.md onward never touch it). This lint fails the
// gate if the old append pattern reappears there, or if a new file under docs/decisions/
// does not follow the naming scheme, so the split cannot silently regress.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The legacy entry header, exactly as docs/DECISIONS.md used before the split
// (`## YYYY-MM-DD: <title>`). The new index never writes a line in this shape; any PR
// that appends one is re-growing the conflict magnet this split removed.
const OLD_ENTRY_PATTERN = /^## \d{4}-\d{2}-\d{2}:/;
const DECISION_FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;

export function checkDecisionsIndex(text) {
  const violations = [];
  text.split("\n").forEach((line, i) => {
    if (OLD_ENTRY_PATTERN.test(line)) {
      violations.push(
        `docs/DECISIONS.md:${i + 1}: a new decision was appended to the old log ("${line.trim()}"). ` +
          "Add docs/decisions/YYYY-MM-DD-<slug>.md instead; this file is a static index, never appended to.",
      );
    }
  });
  return violations;
}

export function checkDecisionFilenames(filenames) {
  const violations = [];
  for (const name of filenames) {
    if (name.startsWith(".")) continue; // dotfiles (e.g. a stray .manifest.json) are not decisions
    if (!DECISION_FILENAME_PATTERN.test(name)) {
      violations.push(`docs/decisions/${name}: does not match YYYY-MM-DD-<slug>.md`);
    }
  }
  return violations;
}

function main() {
  const violations = [];

  const indexPath = path.join(repoRoot, "docs", "DECISIONS.md");
  if (!existsSync(indexPath)) {
    violations.push("docs/DECISIONS.md is missing");
  } else {
    violations.push(...checkDecisionsIndex(readFileSync(indexPath, "utf8")));
  }

  const decisionsDir = path.join(repoRoot, "docs", "decisions");
  if (!existsSync(decisionsDir)) {
    violations.push("docs/decisions/ is missing");
  } else {
    violations.push(...checkDecisionFilenames(readdirSync(decisionsDir)));
  }

  if (violations.length > 0) {
    console.error("lint-decisions: violations found\n" + violations.map((v) => `  - ${v}`).join("\n"));
    process.exit(1);
  }
  console.log("lint-decisions: docs/DECISIONS.md stays a static index, one file per decision OK");
}

main();
