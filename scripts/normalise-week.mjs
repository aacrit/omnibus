#!/usr/bin/env node
// Normalises one void news weekly issue, and the seven daily snapshots it
// covers, into data/week-<issue>.json: the small, committed record that the
// /e/<issue> page is built from (and later, the episode's rundown).
//
// Every value is read from void news's own public record, at a pinned
// commit of its public repo (github.com/aacrit/void--news): nothing is
// inferred, paraphrased or invented. A field the record does not hold is
// left out and the page says so.
//
//   node scripts/normalise-week.mjs --voidnews ../voidnews --issue 32
//
// The voidnews checkout only needs `git fetch`: everything is read with
// `git show <sha>:<path>` from origin/main's history, never the working tree
// (local checkouts are often stale side branches).
//
// Rules applied here come from the show bible, section e:
//   - the lead is the weekly edition's cover story (cover_timelines story 0);
//   - each day's beat is that day's rank-1 printed story (feed order);
//   - the margins: outside the lead and the day leads, covered categories
//     only, importance_score at or above the week's 70th percentile, then
//     thin coverage (source_count < 6) first, then lowest source_count;
//   - the board: for each occupied rung, one headline, verbatim, from that
//     rung's highest-reach outlet. void news publishes no reach figure, so
//     reach is approximated by outlet tier (us_major, international,
//     independent), then the outlet's article count in the lead's record,
//     then name; docs/DECISIONS.md records this stand-in. No board below 6
//     sources.
//   - lean is the outlet's placement on void news's seven-rung ladder
//     (data/sources.json political_lean_baseline), never the article's words.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAN_BASELINES, leanToBucket } from "../web/src/lib/ladder.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_URL = "https://github.com/aacrit/void--news";
const FEED = "frontend/build-data/feed.json";
const WEEKLY = "frontend/build-data/weekly-issues.json";
const SOURCES = "data/sources.json";
const DEEPDIVE = (id) => `frontend/public/data/deepdive/${id}.json`;
const COVERED = new Set(["politics", "conflict", "world", "general", "economy", "science", "health", "environment"]);
const TIER_RANK = { us_major: 0, international: 1, independent: 2 };
const BOARD_MIN_SOURCES = 6;
const BOARD_MAX_ROWS = 6;
const MARGINS = 3;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const vn = path.resolve(arg("voidnews", path.join(repoRoot, "..", "voidnews")));
const issueNo = Number(arg("issue", "32"));
const git = (...a) => execFileSync("git", ["-C", vn, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const show = (sha, p) => JSON.parse(git("show", `${sha}:${p}`));
const blob = (sha, p) => `${REPO_URL}/blob/${sha}/${p}`;
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Commits on origin/main touching a path, oldest first, with their UTC dates.
function commits(p) {
  return git("log", "origin/main", "--format=%H %cI", "--", p)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, iso] = l.split(" ");
      return { sha, at: new Date(iso).toISOString() };
    })
    .reverse();
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bucketsArray(b) {
  // void news exports lean_buckets with underscores, far left first.
  return LEAN_BASELINES.map(([rung]) => b?.[rung.replace("-", "_")] ?? 0);
}

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const head = git("rev-parse", "origin/main").trim();
const weeklyCommit = commits(WEEKLY).at(-1).sha;
const issue = show(weeklyCommit, WEEKLY).find((w) => w.issue_number === issueNo);
if (!issue) throw new Error(`issue ${issueNo} is not in ${WEEKLY} at ${weeklyCommit}`);

const sources = show(head, SOURCES);
const outlet = new Map(sources.map((s) => [s.name, s]));
const placement = (name) => {
  const s = outlet.get(name);
  const base = s && LEAN_BASELINES.find(([rung]) => rung === s.political_lean_baseline);
  return base ? leanToBucket(base[1]) : null; // unrated or unknown: unplaced
};

// ---- The seven days -------------------------------------------------------
const feedCommits = commits(FEED);
const days = [];
const dayLeadIds = new Set();
const pool = new Map(); // cluster id -> latest printed copy in the week
for (let i = 0; i < 7; i++) {
  const date = addDays(issue.week_start, i);
  const snap = feedCommits.filter((c) => c.at.slice(0, 10) === date).at(-1);
  if (!snap) {
    days.push({ date, available: false });
    continue;
  }
  const feed = show(snap.sha, FEED);
  const printed = feed.clusters;
  const lead = printed[0];
  dayLeadIds.add(lead.id);
  for (const c of printed) pool.set(c.id, { ...c, printed_on: date });
  days.push({
    date,
    available: true,
    printed_at: feed.builtAt,
    printed_count: printed.length,
    snapshot: blob(snap.sha, FEED),
    lead: {
      title: lead.title,
      category: lead.category,
      source_count: lead.source_count,
      buckets: bucketsArray(lead.bias_diversity?.lean_buckets),
    },
    next: printed.slice(1, 5).map((c) => ({ title: c.title, source_count: c.source_count })),
  });
}

// ---- The lead and its board -------------------------------------------------
const timeline = (issue.cover_timelines ?? []).find((t) => t.story_index === 0)?.entries ?? [];
const leadIds = new Set(timeline.map((e) => e.cluster_id));
const articles = new Map(); // url -> article, pooled across the lead's clusters
const leadRecords = [];
for (const e of timeline) {
  // The commit that first added this cluster's deep dive: its printed state.
  const sha = git("log", "origin/main", "--diff-filter=A", "--format=%H", "--", DEEPDIVE(e.cluster_id)).trim().split("\n").at(-1);
  const c = sha ? { sha } : null;
  if (!c) {
    leadRecords.push({ date: e.date_iso, title: e.title, source_count: e.source_count, deepdive: null });
    continue;
  }
  const dd = Object.values(show(c.sha, DEEPDIVE(e.cluster_id)));
  for (const { article: a } of dd) if (!articles.has(a.url)) articles.set(a.url, a);
  leadRecords.push({ date: e.date_iso, title: e.title, source_count: e.source_count, deepdive: blob(c.sha, DEEPDIVE(e.cluster_id)) });
}

const byOutlet = new Map();
for (const a of articles.values()) {
  const list = byOutlet.get(a.source.name) ?? [];
  list.push(a);
  byOutlet.set(a.source.name, list);
}
const rungCounts = LEAN_BASELINES.map(() => 0);
let unplaced = 0;
const rungOutlets = new Map();
for (const [name, list] of byOutlet) {
  const rung = placement(name);
  if (!rung) {
    unplaced++;
    continue;
  }
  rungCounts[LEAN_BASELINES.findIndex(([r]) => r === rung)]++;
  const arr = rungOutlets.get(rung) ?? [];
  arr.push({ name, list, tier: outlet.get(name)?.tier });
  rungOutlets.set(rung, arr);
}
const maxSources = Math.max(0, ...leadRecords.map((r) => r.source_count ?? 0));
const board = [];
if (maxSources >= BOARD_MIN_SOURCES) {
  for (const [rung] of LEAN_BASELINES) {
    const arr = rungOutlets.get(rung);
    if (!arr) continue;
    arr.sort(
      (x, y) =>
        (TIER_RANK[x.tier] ?? 9) - (TIER_RANK[y.tier] ?? 9) || y.list.length - x.list.length || x.name.localeCompare(y.name),
    );
    const pick = arr[0];
    const a = [...pick.list].sort((x, y) => x.published_at.localeCompare(y.published_at))[0];
    board.push({ rung, outlet: pick.name, headline: a.title, url: a.url, published_at: a.published_at, sha256: sha256(a.title) });
  }
}
board.splice(BOARD_MAX_ROWS);

// ---- The margins ------------------------------------------------------------
const all = [...pool.values()];
const p70 = percentile(all.map((c) => c.importance_score ?? 0), 0.7);
const margins = all
  .filter((c) => !leadIds.has(c.id) && !dayLeadIds.has(c.id) && COVERED.has(c.category))
  .filter((c) => (c.importance_score ?? 0) >= p70)
  .sort(
    (x, y) =>
      Number(y.source_count < BOARD_MIN_SOURCES) - Number(x.source_count < BOARD_MIN_SOURCES) ||
      x.source_count - y.source_count ||
      (y.importance_score ?? 0) - (x.importance_score ?? 0) ||
      x.id.localeCompare(y.id),
  )
  .slice(0, MARGINS)
  .map((c) => ({
    title: c.title,
    category: c.category,
    source_count: c.source_count,
    importance_score: c.importance_score,
    printed_on: c.printed_on,
    buckets: bucketsArray(c.bias_diversity?.lean_buckets),
  }));

// ---- Echo candidate (bible section k: pre-registered in the history bank) ---
const ECHO = "data/history/events/spanish-flu-1918.yaml";
const echoYaml = git("show", `${head}:${ECHO}`);
const field = (k) => new RegExp(`^${k}: (.*)$`, "m").exec(echoYaml)?.[1]?.replace(/^'|'$/g, "") ?? null;

const out = {
  issue: issueNo,
  week_start: issue.week_start,
  week_end: issue.week_end,
  as_of: issue.created_at,
  edition: issue.edition,
  cover_headline: issue.cover_headline,
  cover_numbers: issue.cover_numbers ?? [],
  normalised_from: { repo: REPO_URL, origin_main: head, weekly: blob(weeklyCommit, WEEKLY), sources: blob(head, SOURCES) },
  days,
  lead: {
    records: leadRecords,
    outlets: byOutlet.size,
    articles: articles.size,
    rung_counts: rungCounts,
    unplaced,
    board,
    ledger: [...articles.values()]
      .sort((x, y) => x.published_at.localeCompare(y.published_at) || x.url.localeCompare(y.url))
      .map((a) => ({ outlet: a.source.name, rung: placement(a.source.name), headline: a.title, url: a.url, published_at: a.published_at })),
  },
  margins: { p70_importance: Math.round(p70 * 100) / 100, pool: all.length, stories: margins },
  echo: {
    slug: field("slug"),
    title: field("title"),
    date_display: field("date_display"),
    horizon: field("date_display"),
    status: "candidate",
    page: `https://news.voidvision.org/history/${field("slug")}/`,
    record: blob(head, ECHO),
    alternate: "black-death",
  },
};

mkdirSync(path.join(repoRoot, "data"), { recursive: true });
const file = path.join(repoRoot, "data", `week-${issueNo}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`normalise-week: wrote ${path.relative(repoRoot, file)} (${days.filter((d) => d.available).length}/7 days, ${board.length} board rows, ${margins.length} margins, ${articles.size} lead articles)`);
