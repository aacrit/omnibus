#!/usr/bin/env node
// Brings an Actions draft render (.github/workflows/episode-draft.yml, C8) down to the laptop for the loom/Resolve
// build, and checks every file against the run's render-manifest.json (bytes and sha256) before it takes the
// destination's place. Net-new.
//
//   node scripts/pull-render.mjs <issue> [--run <id>] [--from artifact|r2] [--dest <dir>] [--replace] [--slice] [--graphics [--repo <checkout>] [--commit]]
//
// --from artifact (the default): the run's workflow artifact episode-draft-<issue>, through `gh run download`
//   (the newest successful episode-draft run for that issue unless --run names one).
// --slice: pull a check slice (--until) at all (by default only a whole-film run is picked and accepted), and let it
//   replace a whole-film render at <dest>.
// --from r2: render/<issue>/<run>/ (--run required) in the private bucket omnibus-capture, through `npx wrangler r2 object get --remote`
//   (needs CLOUDFLARE_API_TOKEN), the manifest first, then each file it lists.
// --dest: default <OMNIBUS_MEDIA_ROOT or D:/omnibus-media>/<issue>/render. The download lands beside it
//   (<dest>.incoming), is verified there, and only then replaces <dest> (which must be absent or empty unless
//   --replace). A destination on a non-system Windows volume is refused when its dirty bit is set or cannot be read
//   (the exFAT D: of 2026-10-10).
// --graphics: the run's graphics are the authoritative ones (Actions renders every week-<n> graphic afresh): its
//   .mov files are copied into <root>/<issue>/graphics (where the screenplay's graphics ledger reference points), and
//   its graphics-ledger.json is written to episodes/<issue>/graphics-ledger.json in this checkout, each output_path
//   naming the laptop's copy. --repo names the checkout to write it into (default this one: e.g. an e4d/pilot-cut
//   worktree); --commit then commits that one file on that checkout's current branch.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKET, MANIFEST, manifestProblems, sha256File, statOrNull, verifyFiles } from "./lib/draft-outputs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = "episode-draft.yml";

export function artifactName(issue) {
  return `episode-draft-${issue}`;
}

/**
 * The newest successful run for the issue, from `gh run list --json databaseId,displayTitle,conclusion` rows: a
 * whole-film run (its title carries no "slice", episode-draft.yml's run-name) unless `slice` is set. The pulled
 * manifest's own `until` is checked again after the download (wholeFilmRefusal).
 */
export function pickRun(rows, issue, { slice = false } = {}) {
  const want = new RegExp(`\\bissue ${issue}\\b`);
  return rows.find((r) => r.conclusion === "success" && want.test(String(r.displayTitle ?? ""))
    && (slice || !/\bslice\b/.test(String(r.displayTitle ?? ""))))?.databaseId ?? null;
}

/** A pull without --slice takes only a whole film: a manifest whose `until` is set is refused (pure). */
export function wholeFilmRefusal(m, slice) {
  return m.until != null && !slice ? `run ${m.run ?? "?"} is a ${m.until} s slice, not the whole film: pass --slice to pull a slice` : null;
}

/**
 * Where a manifest path lands on the laptop: the package root is the render folder itself (episode-draft.yml syncs
 * the engine's output folder to the package root), so the master is <root>/<issue>/render/master.mp4, never
 * render/render (pure).
 */
export function landing(root, issue, rel, { win = process.platform === "win32" } = {}) {
  const p = win ? path.win32 : path.posix;
  return p.join(root, String(issue), "render", ...rel.split("/"));
}

/** What a manifest says was rendered, in one line. */
export function describe(m) {
  return `run ${m.run ?? "?"}, commit ${String(m.sha ?? "?").slice(0, 12)}${m.ref ? ` (${m.ref})` : ""}, ${m.res ?? "?"}p, ${m.until != null ? `a ${m.until} s slice` : "the whole film"}; not usable: ${m.unusable?.length ? m.unusable.join(", ") : "none"}`;
}

/** A check slice never replaces a whole-film render unless --slice says so (pure). */
export function sliceRefusal(prev, next, slice) {
  if (prev && prev.until == null && next.until != null && !slice) {
    return `this run is a ${next.until} s slice and ${prev.run ? `run ${prev.run}` : "the render there"} is the whole film: pass --slice to replace it anyway`;
  }
  return null;
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

/**
 * The run's graphics ledger text with each output_path naming the laptop's copy under `graphicsDir` (pure). Only
 * those strings change: the rest keeps the renderer's own bytes (Python's json prints 12.0, JSON.stringify 12).
 */
export function localLedger(text, graphicsDir, { win = process.platform === "win32" } = {}) {
  const join = win ? path.win32.join : path.posix.join;
  let out = text;
  for (const r of JSON.parse(text)) {
    const local = join(graphicsDir, path.posix.basename(String(r.output_path).replace(/\\/g, "/")));
    out = out.split(`"output_path": ${JSON.stringify(r.output_path)}`).join(`"output_path": ${JSON.stringify(local)}`);
  }
  return { text: out, rows: JSON.parse(out) };
}

function sha256Sync(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function installGraphics(issue, dest, root, commit, runLabel, repo = repoRoot) {
  const src = path.join(dest, "graphics");
  const ledgerFile = path.join(dest, "graphics-ledger.json");
  if (!existsSync(ledgerFile) || !existsSync(src)) throw new Error("the run carries no graphics or graphics-ledger.json");
  const graphicsDir = path.resolve(root, String(issue), "graphics");
  mkdirSync(graphicsDir, { recursive: true });
  const { text, rows } = localLedger(readFileSync(ledgerFile, "utf8"), graphicsDir);
  for (const r of rows) {
    const name = path.basename(r.output_path);
    const from = path.join(src, name);
    if (!existsSync(from)) throw new Error(`the ledger's ${name} is not in the run's graphics`);
    const got = sha256Sync(from);
    if (got !== r.output_sha256) throw new Error(`${name} hashes to ${got.slice(0, 12)}, not the ledger's ${String(r.output_sha256).slice(0, 12)}: nothing installed`);
  }
  for (const r of rows) copyFileSync(path.join(src, path.basename(r.output_path)), path.join(graphicsDir, path.basename(r.output_path)));
  const target = path.join(repo, "episodes", String(issue), "graphics-ledger.json");
  if (!existsSync(path.dirname(target))) throw new Error(`${repo} has no episodes/${issue}: --repo names a checkout of omnibus`);
  writeFileSync(target, text);
  console.log(`pull-render: ${rows.length} graphics -> ${graphicsDir}; ledger -> ${target}`);
  if (commit) {
    execFileSync("git", ["add", target], { cwd: repo, stdio: "inherit" });
    execFileSync("git", ["commit", "-m", `graphics-ledger: issue ${issue}, rendered on Actions (${runLabel})`], { cwd: repo, stdio: "inherit" });
  }
}

function gh(args) {
  return execFileSync("gh", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function pullArtifact(issue, run, incoming, slice) {
  const id = run ?? pickRun(JSON.parse(gh(["run", "list", "--workflow", WORKFLOW, "--limit", "50", "--json", "databaseId,displayTitle,conclusion"])), issue, { slice });
  if (!id) throw new Error(`no successful ${WORKFLOW} run for issue ${issue}: pass --run <id>`);
  console.log(`pull-render: run ${id}, artifact ${artifactName(issue)}`);
  gh(["run", "download", String(id), "--name", artifactName(issue), "--dir", incoming]);
}

function pullR2(issue, run, incoming) {
  if (!run) throw new Error("--from r2 needs --run <id>: the bucket keys each render by its run (render/<issue>/<run>/)");
  const get = (rel) => {
    const dest = path.join(incoming, ...rel.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync("npx", ["wrangler", "r2", "object", "get", `${BUCKET}/render/${issue}/${run}/${rel}`, "--file", dest, "--remote"],
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
    console.error("usage: node scripts/pull-render.mjs <issue> [--run <id>] [--from artifact|r2] [--dest <dir>] [--replace] [--slice] [--graphics [--repo <checkout>] [--commit]]");
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
  if (from === "artifact") pullArtifact(issue, flag("run"), incoming, argv.includes("--slice"));
  else pullR2(issue, flag("run"), incoming);
  const m = JSON.parse(readFileSync(path.join(incoming, MANIFEST), "utf8"));
  const problems = manifestProblems(m);
  if (problems.length) throw new Error(`render-manifest.json is invalid: ${problems.join("; ")}`);
  if (m.issue !== issue) throw new Error(`the manifest is for issue ${m.issue}, not ${issue}`);
  console.log(`pull-render: ${describe(m)}`);
  const whole = wholeFilmRefusal(m, argv.includes("--slice"));
  if (whole) throw new Error(whole);
  const prev = existsSync(path.join(dest, MANIFEST)) ? JSON.parse(readFileSync(path.join(dest, MANIFEST), "utf8")) : null;
  const why2 = sliceRefusal(prev, m, argv.includes("--slice"));
  if (why2) throw new Error(why2);
  const checked = await verifyFiles(m, incoming, { stat: statOrNull, sha: sha256File });
  const bad = checked.filter((c) => !c.ok);
  if (bad.length) {
    throw new Error(`${bad.length} of ${checked.length} files failed the check (left in ${incoming}): ${bad.slice(0, 5).map((b) => `${b.path}: ${b.why}`).join("; ")}`);
  }
  rmSync(dest, { recursive: true, force: true });
  renameSync(incoming, dest);
  const bytes = m.files.reduce((a, f) => a + f.bytes, 0);
  console.log(`pull-render: ${checked.length} files (${(bytes / 1024 ** 2).toFixed(1)} MiB) verified -> ${dest}`);
  if (argv.includes("--graphics")) installGraphics(issue, dest, root, argv.includes("--commit"), `episode-draft run ${m.run ?? "?"}`, flag("repo") ? path.resolve(flag("repo")) : repoRoot);
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
