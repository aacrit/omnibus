#!/usr/bin/env node
// CI0: studio-full now splits studio/tests across 4 pytest-split shards (each ~10 min
// instead of one ~35 min job). This proves the shards together still run every test once:
// no test silently dropped by a bad split, and none run twice (which would also hide a
// flaky-test false pass). Each shard's job writes its collected node ids to a text file
// (one id per line, via `pytest --collect-only -q`); the final `studio-full` job collects
// the whole suite the same way and calls checkVerify on all of them together.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `pytest --collect-only -q` prints one node id per line, then a blank line and a summary
// ("N tests collected in Ys", or with a warnings summary block above it). A node id always
// contains "::" (file::test, or file::Class::test[params]); nothing else pytest prints here
// does.
export function extractNodeIds(collectOutput) {
  return collectOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("::"));
}

export function verifyShardCollection(fullIds, shardIdGroups) {
  const violations = [];
  const fullSet = new Set(fullIds);
  if (fullSet.size !== fullIds.length) {
    violations.push(`the full collection itself has ${fullIds.length - fullSet.size} duplicate id(s)`);
  }

  const seenInShards = new Map(); // id -> which shard indices held it
  shardIdGroups.forEach((ids, shardIndex) => {
    const seenInThisShard = new Set();
    for (const id of ids) {
      if (seenInThisShard.has(id)) {
        violations.push(`shard ${shardIndex + 1}: "${id}" was collected twice within the same shard`);
      }
      seenInThisShard.add(id);
      const holders = seenInShards.get(id) ?? [];
      holders.push(shardIndex + 1);
      seenInShards.set(id, holders);
    }
  });

  for (const [id, holders] of seenInShards) {
    if (holders.length > 1) {
      violations.push(`"${id}" was collected by more than one shard (${holders.join(", ")})`);
    }
  }

  const union = new Set(seenInShards.keys());
  const missing = fullIds.filter((id) => !union.has(id));
  const extra = [...union].filter((id) => !fullSet.has(id));

  if (missing.length > 0) {
    violations.push(`${missing.length} test id(s) in the full collection were run by no shard, e.g. "${missing[0]}"`);
  }
  if (extra.length > 0) {
    violations.push(`${extra.length} test id(s) ran in a shard but are not in the full collection, e.g. "${extra[0]}"`);
  }

  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const fullIdx = args.indexOf("--full");
  const shardsIdx = args.indexOf("--shards");
  if (fullIdx === -1 || shardsIdx === -1) {
    console.error("usage: verify-shard-collection.mjs --full <full-ids-file> --shards <shard-ids-file>...");
    process.exit(2);
  }
  const fullFile = args[fullIdx + 1];
  const shardFiles = args.slice(shardsIdx + 1).filter((a) => !a.startsWith("--"));
  if (shardFiles.length === 0) {
    console.error("verify-shard-collection: no --shards files given");
    process.exit(2);
  }

  const fullIds = extractNodeIds(readFileSync(path.resolve(repoRoot, fullFile), "utf8"));
  const shardIdGroups = shardFiles.map((f) => extractNodeIds(readFileSync(path.resolve(repoRoot, f), "utf8")));

  const violations = verifyShardCollection(fullIds, shardIdGroups);
  if (violations.length > 0) {
    console.error("verify-shard-collection: violations found\n" + violations.map((v) => `  - ${v}`).join("\n"));
    process.exit(1);
  }
  const shardTotal = shardIdGroups.reduce((n, g) => n + g.length, 0);
  console.log(
    `verify-shard-collection: ${fullIds.length} tests in the full collection, ` +
      `${shardTotal} across ${shardIdGroups.length} shards, no gaps and no duplicates`,
  );
}

// Only run as a CLI entry point; a test file imports the pure functions above without
// wanting this to fire (it takes CLI args the test process never supplies).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
