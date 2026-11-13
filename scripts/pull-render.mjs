#!/usr/bin/env node
// Brings an Actions draft render (.github/workflows/episode-draft.yml, C8) down to the laptop for the loom/Resolve
// build, and checks every file against the run's render-manifest.json (bytes and sha256) before it takes the
// destination's place. Net-new.
//
//   node scripts/pull-render.mjs <issue> [--run <id>] [--from artifact|r2] [--dest <dir>] [--replace]
//
// --from artifact (the default): the run's workflow artifact episode-draft-<issue>, through `gh run download`
//   (the newest successful episode-draft run for that issue unless --run names one).
// --from r2: render/<issue>/ in the private bucket omnibus-capture, through `npx wrangler r2 object get --remote`
//   (needs CLOUDFLARE_API_TOKEN), the manifest first, then each file it lists.
// --dest: default <OMNIBUS_MEDIA_ROOT or D:/omnibus-media>/<issue>/render. The download lands beside it
//   (<dest>.incoming), is verified there, and only then replaces <dest> (which must be absent or empty unless
//   --replace). A destination on a non-system Windows volume is refused when its dirty bit is set or cannot be read
//   (the exFAT D: of 2026-10-10).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKET, MANIFEST, manifestProblems, sha256File, statOrNull, verifyFiles } from "./lib/draft-outputs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = "episode-draft.yml";

export function artifactName(issue) {
  return `episode-draft-${issue}`;
}

/** The newest successful run for the issue, from `gh run list --json databaseId,displayTitle,conclusion` rows. */
export function pickRun(rows, issue) {
  const want = new RegExp(`\\bissue ${issue}\\b`);
  return rows.find((r) => r.conclusion === "success" && want.test(String(r.displayTitle ?? "")))?.databaseId ?? null;
}

/** Why writing under `dir` is refused on this machine, or null. */
export function dirtyRefusal(dir, { platform = process.platform, env = process.env, run = execFileSync } = {}) {
  if (platform !== "win32") return null;
  const drive = path.win32.parse(path.win32.resolve(dir)).root.slice(0, 2).toUpperCase();
  if (!/^[A-Z]:$/.test(drive) || drive === String(env.SystemDrive ?? "C:").toUpperCase()) return null;
  let text;
  try {
    text = String(run("fsutil", ["dirty", "query", drive], { encoding: "utf8" }));
  } catch (e) {
    return `fsutil dirty query ${drive} failed (${e.message.split("\n")[0]}): not writing to ${drive}`;
  }
  return /NOT Dirty/.test(text) ? null : `${drive} is dirty or could not be read (${text.trim().slice(0, 120)}): run chkdsk ${drive} /f first`;
}

function gh(args) {
  return execFileSync("gh", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function pullArtifact(issue, run, incoming) {
  const id = run ?? pickRun(JSON.parse(gh(["run", "list", "--workflow", WORKFLOW, "--limit", "50", "--json", "databaseId,displayTitle,conclusion"])), issue);
  if (!id) throw new Error(`no successful ${WORKFLOW} run for issue ${issue}: pass --run <id>`);
  console.log(`pull-render: run ${id}, artifact ${artifactName(issue)}`);
  gh(["run", "download", String(id), "--name", artifactName(issue), "--dir", incoming]);
}

function pullR2(issue, incoming) {
  const get = (rel) => {
    const dest = path.join(incoming, ...rel.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync("npx", ["wrangler", "r2", "object", "get", `${BUCKET}/render/${issue}/${rel}`, "--file", dest, "--remote"],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
  };
  get(MANIFEST);
  const m = JSON.parse(readFileSync(path.join(incoming, MANIFEST), "utf8"));
  const p = manifestProblems(m);
  if (p.length) throw new Error(`the R2 manifest is invalid: ${p.join("; ")}`);
  for (const f of m.files) get(f.path);
}

async function main(argv) {
  const [issueArg] = argv;
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!/^\d{1,4}$/.test(String(issueArg ?? ""))) {
    console.error("usage: node scripts/pull-render.mjs <issue> [--run <id>] [--from artifact|r2] [--dest <dir>] [--replace]");
    return 2;
  }
  const issue = Number(issueArg);
  const from = flag("from") ?? "artifact";
  if (!["artifact", "r2"].includes(from)) throw new Error(`--from is artifact or r2, not ${from}`);
  const root = process.env.OMNIBUS_MEDIA_ROOT || "D:/omnibus-media";
  const dest = path.resolve(flag("dest") ?? path.join(root, String(issue), "render"));
  const rel = path.relative(repoRoot, dest);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`${dest} is inside the repo; media never goes in git (rule 8)`);
  const why = dirtyRefusal(dest);
  if (why) throw new Error(why);
  if (existsSync(dest) && readdirSync(dest).length && !argv.includes("--replace")) {
    throw new Error(`${dest} is not empty: pass --replace to swap it for the verified download`);
  }
  const incoming = `${dest}.incoming`;
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(incoming, { recursive: true });
  if (from === "artifact") pullArtifact(issue, flag("run"), incoming);
  else pullR2(issue, incoming);
  const m = JSON.parse(readFileSync(path.join(incoming, MANIFEST), "utf8"));
  const problems = manifestProblems(m);
  if (problems.length) throw new Error(`render-manifest.json is invalid: ${problems.join("; ")}`);
  if (m.issue !== issue) throw new Error(`the manifest is for issue ${m.issue}, not ${issue}`);
  const checked = await verifyFiles(m, incoming, { stat: statOrNull, sha: sha256File });
  const bad = checked.filter((c) => !c.ok);
  if (bad.length) {
    throw new Error(`${bad.length} of ${checked.length} files failed the check (left in ${incoming}): ${bad.slice(0, 5).map((b) => `${b.path}: ${b.why}`).join("; ")}`);
  }
  rmSync(dest, { recursive: true, force: true });
  renameSync(incoming, dest);
  const bytes = m.files.reduce((a, f) => a + f.bytes, 0);
  console.log(`pull-render: ${checked.length} files (${(bytes / 1024 ** 2).toFixed(1)} MiB) verified -> ${dest}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`pull-render: ${err.message}`);
      process.exit(1);
    },
  );
}
