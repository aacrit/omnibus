// Show bible v2, ticket 2 (sections k and l): the desk and the rundown.
//
// Pure. scripts/normalise-rundown.mjs reads void news's public history at a
// pinned commit (scripts/lib/desk-source.mjs) and the episode's own files,
// and hands them here. Nothing reads the weekly edition's output to rank:
// the weekly edition, when one covers the window, is only a cross-check.
//
// buildDesk: the week's printed rows (archive.json, printed_on inside the
//   window) grouped by void news's story_thread_id, each thread scored by
//   void news's weekly formula (pipeline/briefing/weekly_digest_generator.py
//   _score_weekly_threads and _build_threads, read at void news ca25415):
//     daily appearances 0.25, cumulative sources 0.20, brief mentions 0.20,
//     peak headline rank 0.15, edition spread 0.10, divergence 0.10,
//   each signal divided by its maximum over the week's threads. The daily
//   briefs (brief mentions) are frontend/public/data/brief.json's versions in
//   the same history.
//
// applyThreadChecks: the hand check of thread merges (rundown-edit.json
//   "threads"): `split` takes clusters out of the thread void news filed them
//   in; `join` makes one story of clusters from different threads and carries
//   the written thread_reason (bible k: a bundle implies a connection). Every
//   check needs a reason.
//
// buildRundown: stories (the hand-checked groups), scored again by the same
//   formula over the stories, ranked by weight; footage_cleared_s from the
//   rights ledger and the capture pool; shapes by the cap (bible l); slots.

import { createHash } from "node:crypto";
import { lintAiGeneratedShareZero, lintLicenceAllowlist, lintLicenceEvidence } from "./rights/lints.mjs";
import { validateLedger } from "./rights/ledger.mjs";
import { FAIR_USE } from "./rights/licences.mjs";
import { unconfirmedFit } from "../capture/pool.mjs";

export const RUNDOWN_SCHEMA = "omnibus.rundown/2";
export const DESK_SCHEMA = "omnibus.desk/1";
export const EDIT_SCHEMA = "omnibus.rundown-edit/1";

// void news, weekly_digest_generator.py: the six signals and their weights.
export const WEIGHTS = Object.freeze({
  daily_appearances: 0.25,
  cumulative_sources: 0.2,
  brief_mentions: 0.2,
  peak_rank: 0.15,
  edition_spread: 0.1,
  total_divergence: 0.1,
});
// void news, weekly_digest_generator.py STOP_WORDS, verbatim.
export const STOP_WORDS = new Set(
  ("the a an in on at to for of and as is by with that this from has was are were been its it be not but or no new says said after").split(" "),
);

// Bible l: a full package needs 30 s of cleared moving picture.
export const FOOTAGE_CAP_S = 30;
// Bible b and l: the lead, packages 2 to 4, an optional package 5, then 6 to 10 briefs.
export const PACKAGES = 4;
export const BRIEFS_MAX = 10;
// Bible f: the categories that may hold a package. Sport and entertainment never do.
export const COVERED = new Set(["politics", "conflict", "world", "general", "economy", "science", "health", "environment"]);
// Bible m: coi_entities.
export const COI_ENTITIES = Object.freeze(["Anthropic", "Claude", "OpenAI", "Google DeepMind", "DeepMind", "Gemini", "Meta AI", "xAI", "Mistral"]);

const KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ID_PREFIX = /^[0-9a-f][0-9a-f-]{7,35}$/;

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/** YYYY-MM-DD plus n days. */
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The window's days, from..to inclusive. */
export function windowDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** void news's title words: lower-cased, split on whitespace, stop words out (Python str.split). */
export function titleWords(text) {
  return new Set(String(text ?? "").toLowerCase().split(/\s+/).filter((w) => w && !STOP_WORDS.has(w)));
}

/**
 * A printed row in the shape void news's weekly reads (_fetch_week_printed):
 * rows without a summary are dropped there, and headline_rank is rank_world
 * when the row has one.
 */
export function printedRows(archive, { from, to }) {
  const out = [];
  for (const r of archive ?? []) {
    if (!(r?.printed_on >= from && r.printed_on <= to)) continue;
    if (typeof r.summary !== "string" || !r.summary.trim()) continue;
    out.push({
      id: r.source_cluster_id || r.id,
      printed_id: r.id,
      printed_on: r.printed_on,
      edition_position: r.edition_position ?? null,
      title: r.title ?? "",
      category: r.category ?? null,
      source_count: r.source_count || 0,
      headline_rank: r.rank_world || r.headline_rank || 0,
      divergence_score: r.divergence_score || 0,
      first_published: r.first_published ?? null,
      created_at: r.created_at ?? null,
      story_thread_id: r.story_thread_id ?? null,
    });
  }
  // A stable order whatever order archive.json lists them in.
  out.sort((a, b) => a.printed_on.localeCompare(b.printed_on) || (a.edition_position ?? 0) - (b.edition_position ?? 0) || a.id.localeCompare(b.id));
  return out;
}

/** The signals of one group of printed rows (_build_threads). Every printed row is edition "world". */
export function groupSignals(rows) {
  const ordered = [...rows].sort((a, b) => String(a.first_published ?? a.created_at ?? "").localeCompare(String(b.first_published ?? b.created_at ?? "")));
  let lead = ordered[0];
  for (const r of ordered) if (r.headline_rank > lead.headline_rank) lead = r;
  return {
    lead,
    title: lead.title,
    daily_appearances: new Set(rows.map((r) => r.printed_on)).size,
    edition_spread: 1,
    cumulative_sources: rows.reduce((s, r) => s + r.source_count, 0),
    peak_rank: Math.max(...rows.map((r) => r.headline_rank)),
    total_divergence: rows.reduce((s, r) => s + r.divergence_score, 0),
  };
}

/** Brief mentions (_score_weekly_threads): a brief listing a cluster of the group, else sharing two title words with its headline. */
export function briefMentions(group, briefs) {
  const ids = new Set(group.rows.map((r) => r.id));
  const words = titleWords(group.title);
  let n = 0;
  for (const b of briefs) {
    if ((b.top_cluster_ids ?? []).some((id) => ids.has(id))) {
      n++;
      continue;
    }
    const h = titleWords(b.tldr_headline);
    let shared = 0;
    for (const w of words) if (h.has(w)) shared++;
    if (shared >= 2) n++;
  }
  return n;
}

/** Score groups in place: void news's formula, each signal over its week maximum (0 counts as 1). */
export function scoreGroups(groups, briefs) {
  for (const g of groups) Object.assign(g, groupSignals(g.rows), { brief_mentions: 0 });
  for (const g of groups) g.brief_mentions = briefMentions(g, briefs);
  const mx = (k) => Math.max(0, ...groups.map((g) => g[k])) || 1;
  const max = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, mx(k)]));
  for (const g of groups) g.score = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (g[k] / max[k]) * w, 0);
  groups.sort((a, b) => b.score - a.score || b.cumulative_sources - a.cumulative_sources || a.key.localeCompare(b.key));
  groups.forEach((g, i) => (g.rank = i + 1));
  return groups;
}

const signalsOf = (g) => ({
  daily_appearances: g.daily_appearances,
  cumulative_sources: g.cumulative_sources,
  brief_mentions: g.brief_mentions,
  peak_rank: round6(g.peak_rank),
  edition_spread: g.edition_spread,
  total_divergence: round6(g.total_divergence),
});

const uniq = (xs) => [...new Set(xs)];
const clusterIds = (rows) => uniq(rows.map((r) => r.id)).sort();
const threadIds = (rows) => uniq(rows.map((r) => r.story_thread_id ?? `cluster:${r.id}`)).sort();
/**
 * Each row's story key as void news filed it: `thread-` and the shortest prefix of its story_thread_id (8
 * characters or more) no other thread of the week shares, or `cluster-` and its cluster id's when it has none.
 */
export function threadKeys(rows) {
  const tids = uniq(rows.map((r) => r.story_thread_id).filter(Boolean));
  const short = new Map();
  for (const t of tids) {
    let n = Math.min(8, t.length);
    while (n < t.length && tids.some((o) => o !== t && o.slice(0, n) === t.slice(0, n))) n++;
    short.set(t, t.slice(0, n));
  }
  return (r) => (r.story_thread_id ? `thread-${short.get(r.story_thread_id)}` : `cluster-${r.id.slice(0, 8)}`);
}

/** The week's threads as void news filed them (story_thread_id; a row without one is its own thread). */
export function threadGroups(rows) {
  const keyOf = threadKeys(rows);
  const by = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (!by.has(key)) by.set(key, { key, rows: [] });
    by.get(key).rows.push(r);
  }
  return [...by.values()];
}

/** The daily briefs void news's weekly reads: edition world, created inside the window and by the cutoff, one per id. */
export function briefSignals(briefs, { from, to, cutoff }) {
  const lo = Date.parse(`${from}T00:00:00Z`);
  const hi = Math.min(Date.parse(`${addDays(to, 1)}T00:00:00Z`), Date.parse(cutoff) + 1);
  const byId = new Map();
  for (const b of briefs ?? []) {
    if (b?.edition !== "world") continue;
    const t = Date.parse(b.created_at ?? "");
    if (!(t >= lo && t < hi)) continue;
    byId.set(b.id, b); // briefs come oldest commit first: the last version read wins
  }
  return [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
}

const rowView = (r) => ({
  cluster_id: r.id,
  printed_id: r.printed_id,
  printed_on: r.printed_on,
  edition_position: r.edition_position,
  title: r.title,
  category: r.category,
  source_count: r.source_count,
  headline_rank: round6(r.headline_rank),
  divergence_score: round6(r.divergence_score),
  story_thread_id: r.story_thread_id,
});

/**
 * The desk: void news's threads for the window, scored and ranked, with the
 * weekly edition's cross-check. `pin` is { repo, commit, committed_at, rule };
 * `archive` the archive.json rows at the pin; `briefs` every brief.json
 * version read (oldest first); `weekly` weekly-issues.json at the pin, or [].
 */
export function buildDesk({ issue, from, to, pin, archive, briefs, weekly = [] }) {
  if (!Number.isInteger(issue) || issue < 1) throw new Error(`not an issue number: ${issue}`);
  if (!(from <= to)) throw new Error(`the window ${from} to ${to} is empty`);
  const rows = printedRows(archive, { from, to });
  const days = windowDays(from, to);
  const present = uniq(rows.map((r) => r.printed_on)).sort();
  const lastPrint = rows.filter((r) => r.printed_on === present.at(-1)).map((r) => r.created_at).filter(Boolean).sort().at(-1) ?? null;
  const signals = briefSignals(briefs, { from, to, cutoff: pin.committed_at });
  const threads = scoreGroups(threadGroups(rows), signals);
  return {
    schema: DESK_SCHEMA,
    issue,
    window: { from, to, days, days_present: present, days_missing: days.filter((d) => !present.includes(d)) },
    pin: { repo: pin.repo, archive_commit: pin.commit, cutoff_utc: iso(pin.committed_at), rule: pin.rule, last_print_utc: lastPrint ? iso(lastPrint) : null },
    formula: { source: "void news pipeline/briefing/weekly_digest_generator.py _score_weekly_threads", weights: WEIGHTS, threads_by: "story_thread_id" },
    briefs: signals.map((b) => ({ id: b.id, created_at: b.created_at, top_cluster_ids: [...(b.top_cluster_ids ?? [])], tldr_headline: b.tldr_headline ?? "" })),
    weekly_crosscheck: weeklyCrosscheck(weekly, { from, to }, threads),
    threads: threads.map((t) => ({
      key: t.key,
      rank: t.rank,
      score: round6(t.score),
      signals: signalsOf(t),
      title: t.title,
      thread_ids: threadIds(t.rows),
      cluster_ids: clusterIds(t.rows),
      rows: t.rows.map(rowView),
    })),
  };
}

/** The weekly edition for the same week, when one exists: are its covers our top stories? Logged, never used to rank. */
export function weeklyCrosscheck(weekly, { from, to }, ranked) {
  const ed = (weekly ?? []).find((w) => w?.edition === "world" && w.week_start === from) ?? null;
  if (!ed) return { weekly_edition_seen: false };
  const covers = (ed.cover_timelines ?? [])
    .slice()
    .sort((a, b) => a.story_index - b.story_index)
    .map((t) => uniq((t.entries ?? []).map((e) => e.cluster_id)).sort());
  // Where each cover's story sits in our ranking: the first of ours holding one of its clusters.
  const where = covers.map((ids) => {
    const i = ranked.findIndex((g) => g.rows.some((r) => ids.includes(r.id)));
    return { cluster_ids: ids, our_rank: i < 0 ? null : i + 1, our_key: i < 0 ? null : ranked[i].key };
  });
  return {
    weekly_edition_seen: true,
    issue: ed.issue_number,
    week: { start: ed.week_start, end: ed.week_end },
    window_end_matches: ed.week_end === to,
    created_at: ed.created_at,
    covers: where,
    ours: ranked.slice(0, covers.length).map((g) => g.key),
    agree: where.every((c) => c.our_rank !== null && c.our_rank <= covers.length),
  };
}

// ---------------------------------------------------------------------------
// The editorial file and the hand check of threads
// ---------------------------------------------------------------------------

/** What is wrong with an episode's rundown-edit.json (omnibus.rundown-edit/1), as a list. */
export function editProblems(edit, issue) {
  const out = [];
  if (edit == null) return out;
  if (edit.schema !== EDIT_SCHEMA) out.push(`schema is not ${EDIT_SCHEMA}`);
  if (edit.issue !== issue) out.push(`the edit file is for issue ${edit.issue}, not ${issue}`);
  for (const [i, c] of (edit.threads ?? []).entries()) {
    const at = `threads[${i}]`;
    if (c?.op !== "split" && c?.op !== "join") out.push(`${at}: op is split or join`);
    if (!Array.isArray(c?.cluster_ids) || c.cluster_ids.length === 0) out.push(`${at}: cluster_ids lists the clusters it moves`);
    else for (const id of c.cluster_ids) if (!ID_PREFIX.test(String(id))) out.push(`${at}: ${JSON.stringify(id)} is not a cluster id or an 8-character prefix`);
    if (typeof c?.reason !== "string" || c.reason.trim().length < 12) out.push(`${at}: a hand check carries its written reason (12 characters or more)`);
    if (c?.op === "join" && !KEY.test(String(c?.key ?? ""))) out.push(`${at}: a join names its story key (a-z, 0-9, hyphens)`);
    if (c?.op === "split" && c.key !== undefined && !KEY.test(String(c.key))) out.push(`${at}: a split's key is a-z, 0-9, hyphens`);
  }
  for (const [k, s] of Object.entries(edit.stories ?? {})) {
    if (!KEY.test(k)) out.push(`stories.${k}: not a story key`);
    for (const f of ["parties", "entities", "primary_sources", "mechanisms"]) if (s?.[f] !== undefined && !Array.isArray(s[f])) out.push(`stories.${k}.${f} is a list`);
    for (const f of ["slug", "place"]) if (s?.[f] !== undefined && (typeof s[f] !== "string" || !s[f].trim())) out.push(`stories.${k}.${f} is a non-empty string`);
  }
  for (const f of ["tease", "briefs_order"]) if (edit[f] !== undefined && !Array.isArray(edit[f])) out.push(`${f} is a list of story keys`);
  return out;
}

/** The one week cluster a reference names; throws when it names none or several. */
function resolveCluster(rows, ref, at) {
  // A cluster is named by its id (source_cluster_id) or by the id of one of its printed rows (archive.json id), whole or by prefix.
  const hit = (x) => x === ref || String(x ?? "").startsWith(ref);
  const ids = uniq(rows.filter((r) => hit(r.id) || hit(r.printed_id)).map((r) => r.id));
  if (ids.length !== 1) throw new Error(`${at}: ${ref} names ${ids.length === 0 ? "no cluster" : `${ids.length} clusters`} printed in the window`);
  return ids[0];
}

/**
 * The stories after the hand check: void news's threads, with each `split`
 * taking its clusters into a story of their own and each `join` making one
 * story of its clusters (whatever thread each was in) with thread_reason.
 * Returns { groups, checks } where checks records what was done and why.
 */
export function applyThreadChecks(rows, edit) {
  const assign = new Map(); // cluster id -> story key
  const keyOf = threadKeys(rows);
  for (const r of rows) assign.set(r.id, keyOf(r));
  const reasons = new Map();
  const checks = [];
  for (const [i, c] of (edit?.threads ?? []).entries()) {
    const at = `rundown-edit threads[${i}]`;
    const ids = c.cluster_ids.map((ref) => resolveCluster(rows, String(ref), at)).sort();
    const from = uniq(ids.map((id) => assign.get(id))).sort();
    const key = c.op === "join" ? c.key : (c.key ?? `cluster-${ids[0].slice(0, 8)}`);
    for (const id of ids) assign.set(id, key);
    if (c.op === "join") reasons.set(key, c.reason.trim());
    checks.push({ op: c.op, key, cluster_ids: ids, from, reason: c.reason.trim() });
  }
  const by = new Map();
  for (const r of rows) {
    const key = assign.get(r.id);
    if (!by.has(key)) by.set(key, { key, rows: [] });
    by.get(key).rows.push(r);
  }
  const groups = [...by.values()];
  for (const g of groups) {
    g.thread_reason = reasons.get(g.key) ?? null;
    if (threadIds(g.rows).length > 1 && !g.thread_reason) {
      throw new Error(`story ${g.key} bundles clusters from ${threadIds(g.rows).length} threads without a thread_reason (a join with its reason)`);
    }
  }
  return { groups, checks };
}

// ---------------------------------------------------------------------------
// Footage: the rights ledger and the capture pool
// ---------------------------------------------------------------------------

/** The item ids the blocking rights lints refuse, with why (the ledger alone; the captured_at clock is not read, so the result is reproducible). */
export function refusedItems(ledger) {
  const refused = new Map();
  const add = (id, why) => refused.set(id, [...(refused.get(id) ?? []), why]);
  for (const x of [...lintLicenceAllowlist(ledger), ...lintLicenceEvidence(ledger, { now: new Date(8.64e15) }), ...lintAiGeneratedShareZero(ledger)]) add(x.item, `${x.rule}: ${x.message}`);
  for (const it of ledger.items) if (it.licence === FAIR_USE || /fair[\s-]?use/i.test(String(it.basis ?? ""))) add(it.id, "fair-use-refused: fair use is refused (bible n)");
  return refused;
}

/** The seconds an item airs: its fit's span, else the reviewed duration; null when the ledger states neither. */
export function itemSeconds(it) {
  const a = Number(it.fit?.in_s);
  const b = Number(it.fit?.out_s);
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) return round6(b - a);
  const d = Number(it.marks_checked?.reviewed?.duration_s);
  return Number.isFinite(d) && d > 0 ? round6(d) : null;
}

/**
 * Cleared moving picture per story key. An item counts for a story when it is
 * ledger footage that every blocking rights lint passes and whose fit is not
 * an unconfirmed automatic one, and it belongs to the story: its fit.beat is
 * the story key or one of its clusters, or the capture pool holds it (same
 * item_url, or the same file by sha256) under a pool story sharing a cluster.
 * Each file counts once per story.
 */
export function footageByStory(groups, { ledger = null, pool = null } = {}) {
  const out = new Map(groups.map((g) => [g.key, { seconds: 0, items: [], refused: [], unconfirmed: [], no_duration: [] }]));
  const problems = [];
  if (!ledger) return { byStory: out, problems };
  const schema = validateLedger(ledger);
  if (schema.length) {
    problems.push(...schema.map((p) => `rights ledger: ${p}`));
    return { byStory: out, problems };
  }
  const refused = refusedItems(ledger);
  const poolStories = (pool?.stories ?? []).map((s) => ({
    clusters: new Set(s.cluster_ids ?? []),
    urls: new Set((s.items ?? []).map((x) => x.url).filter(Boolean)),
    shas: new Set((s.items ?? []).map((x) => x.media?.sha256).filter(Boolean)),
  }));
  for (const g of groups) {
    const ids = new Set(g.rows.map((r) => r.id));
    const own = (ref) => ref === g.key || [...ids].some((id) => id === ref || (String(ref).length >= 8 && id.startsWith(String(ref))));
    const pooled = poolStories.filter((p) => [...p.clusters].some((c) => ids.has(c)));
    const rec = out.get(g.key);
    const seen = new Set();
    for (const it of [...ledger.items].sort((a, b) => a.id.localeCompare(b.id))) {
      if (it.kind !== "footage") continue;
      const mine = (it.fit?.beat && own(it.fit.beat)) || pooled.some((p) => p.urls.has(it.item_url) || p.shas.has(it.sha256));
      if (!mine) continue;
      if (refused.has(it.id)) {
        rec.refused.push({ id: it.id, why: refused.get(it.id) });
        continue;
      }
      const unconfirmed = unconfirmedFit(it.fit);
      if (unconfirmed) {
        rec.unconfirmed.push({ id: it.id, why: unconfirmed });
        continue;
      }
      if (seen.has(it.sha256)) continue;
      seen.add(it.sha256);
      const s = itemSeconds(it);
      if (s == null) {
        rec.no_duration.push(it.id);
        continue;
      }
      rec.items.push({ id: it.id, seconds: s });
      rec.seconds = round6(rec.seconds + s);
    }
  }
  return { byStory: out, problems };
}

// ---------------------------------------------------------------------------
// The rundown
// ---------------------------------------------------------------------------

/** The bible m entities a story's parties, entities or cluster titles name (whole words, as written). */
export function coiMatches(texts) {
  const out = new Set();
  for (const e of COI_ENTITIES) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${e.replace(/ /g, "\\s+")}($|[^A-Za-z0-9])`);
    if (texts.some((t) => re.test(String(t ?? "")))) out.add(e);
  }
  return [...out].sort();
}

/** The shape the cap gives a story in a package slot (bible l). */
export const shapeFor = (footageS) => (footageS >= FOOTAGE_CAP_S ? "full" : "document");

/**
 * The rundown/2 for an issue. `desk` is buildDesk's; `archive`, `briefs` as
 * there (the stories are scored again over the hand-checked groups);
 * `edit` the episode's rundown-edit.json or null; `ledger` its rights ledger
 * or null; `pool` the week's capture pool or null; `inputs` the paths and
 * sha256s of those files, recorded as read.
 */
export function buildRundown({ desk, archive, briefs, edit = null, ledger = null, pool = null, inputs = {} }) {
  const issue = desk.issue;
  const ep = editProblems(edit, issue);
  if (ep.length) throw new Error(`rundown-edit.json: ${ep.join("; ")}`);
  const { from, to } = desk.window;
  const rows = printedRows(archive, { from, to });
  const { groups, checks } = applyThreadChecks(rows, edit);
  scoreGroups(groups, briefSignals(briefs, { from, to, cutoff: desk.pin.cutoff_utc }));
  const { byStory, problems } = footageByStory(groups, { ledger, pool });
  const ed = edit?.stories ?? {};
  for (const k of Object.keys(ed)) if (!groups.some((g) => g.key === k)) throw new Error(`rundown-edit.json stories.${k}: no story has that key`);

  const view = (g) => {
    const e = ed[g.key] ?? {};
    const parties = [...(e.parties ?? [])];
    const entities = [...(e.entities ?? [])];
    const coi = coiMatches([...parties, ...entities, ...g.rows.map((r) => r.title)]);
    const f = byStory.get(g.key);
    return {
      key: g.key,
      slug: e.slug ?? null,
      place: e.place ?? null,
      cluster_ids: clusterIds(g.rows),
      thread_ids: threadIds(g.rows),
      ...(g.thread_reason ? { thread_reason: g.thread_reason } : {}),
      weight: round6(g.score),
      rank: g.rank,
      slot: null,
      shape: null,
      category: g.lead.category,
      days: uniq(g.rows.map((r) => r.printed_on)).sort(),
      signals: signalsOf(g),
      desk_title: g.title,
      parties,
      entities,
      primary_sources: [...(e.primary_sources ?? [])],
      footage_cleared_s: f.seconds,
      footage: { items: f.items, refused: f.refused, unconfirmed: f.unconfirmed, no_duration: f.no_duration },
      mechanisms: [...(e.mechanisms ?? [])],
      coi: coi.length > 0,
      ...(coi.length ? { coi_match: coi } : {}),
    };
  };
  const all = groups.map(view);
  const covered = all.filter((s) => COVERED.has(s.category));
  const stories = [];
  const take = (s, slot, shape) => stories.push({ ...s, slot, shape });
  covered.slice(0, PACKAGES).forEach((s, i) => take(s, i === 0 ? "lead" : `package_${i + 1}`, shapeFor(s.footage_cleared_s)));
  let next = PACKAGES;
  const fifth = covered[PACKAGES];
  // Package 5 runs only when rank 5 clears the cap or qualifies as a document package (its primary sources named).
  if (fifth && (fifth.footage_cleared_s >= FOOTAGE_CAP_S || fifth.primary_sources.length > 0)) {
    take(fifth, "package_5", shapeFor(fifth.footage_cleared_s));
    next++;
  }
  const briefs_ = covered.slice(next, next + BRIEFS_MAX);
  // Bible f: one story outside the covered categories may hold the final brief when its weight places it in the top five.
  const outside = all.find((s) => !COVERED.has(s.category) && s.rank <= 5);
  if (outside) {
    if (briefs_.length >= BRIEFS_MAX) briefs_.pop();
    briefs_.push(outside);
  }
  briefs_.forEach((s, i) => take(s, `brief_${i + 1}`, "brief"));
  const slotted = new Set(stories.map((s) => s.key));
  const not_covered = all
    .filter((s) => !slotted.has(s.key))
    .map((s) => ({
      key: s.key,
      rank: s.rank,
      weight: s.weight,
      category: s.category,
      cluster_ids: s.cluster_ids,
      desk_title: s.desk_title,
      reason: COVERED.has(s.category) ? "below the brief run by weight" : `category ${s.category}: sport and entertainment never hold a package (bible f)`,
    }));

  const keys = new Set(stories.map((s) => s.key));
  const refs = (list, what) => {
    for (const k of list) if (!keys.has(k)) throw new Error(`rundown-edit.json ${what}: ${k} is not a slotted story`);
    return [...list];
  };
  const packages = stories.filter((s) => s.slot === "lead" || s.slot.startsWith("package_"));
  const tease = edit?.tease ? refs(edit.tease, "tease") : packages.slice(0, 4).map((s) => s.key);
  const briefKeys = stories.filter((s) => s.shape === "brief").map((s) => s.key);
  const briefs_order = edit?.briefs_order ? refs(edit.briefs_order, "briefs_order") : briefKeys;

  const notes = [];
  if (desk.window.days_missing.length) notes.push(`days not printed by the pin: ${desk.window.days_missing.join(", ")}`);
  for (const s of packages) if (s.shape === "document") notes.push(`${s.slot} ${s.key}: ${s.footage_cleared_s} s of cleared moving picture, under the ${FOOTAGE_CAP_S} s cap; a document package at its rank`);
  if (!ledger) notes.push("no rights ledger yet: footage_cleared_s is 0 for every story until scripts/rights.mjs writes one");
  notes.push(...problems);

  return {
    schema: RUNDOWN_SCHEMA,
    edition: {
      issue,
      cutoff_utc: desk.pin.cutoff_utc,
      archive_commit: desk.pin.archive_commit,
      weekly_edition_seen: desk.weekly_crosscheck.weekly_edition_seen,
      window: { from, to },
      days_present: desk.window.days_present,
      pin_rule: desk.pin.rule,
      last_print_utc: desk.pin.last_print_utc,
      repo: desk.pin.repo,
    },
    inputs,
    thread_checks: checks,
    stories,
    not_covered,
    tease,
    echo: edit?.echo ?? null,
    briefs_order,
    weekly_crosscheck: desk.weekly_crosscheck,
    notes,
  };
}

const SLOT = /^(lead|package_[2-5]|brief_([1-9]|10))$/;
const SHAPES = new Set(["full", "document", "brief"]);

/**
 * What is wrong with a rundown/2. `final` also asks for the editorial fields
 * a screenplay needs (slug and place on every story, the echo).
 */
export function rundownProblems(r, { final = false } = {}) {
  const out = [];
  if (r?.schema !== RUNDOWN_SCHEMA) return [`schema is not ${RUNDOWN_SCHEMA}`];
  const e = r.edition ?? {};
  if (!Number.isInteger(e.issue)) out.push("edition.issue is not an integer");
  if (!/^[0-9a-f]{40}$/.test(String(e.archive_commit))) out.push("edition.archive_commit is not a full commit sha");
  if (!Number.isFinite(Date.parse(e.cutoff_utc))) out.push("edition.cutoff_utc is not a time");
  if (typeof e.weekly_edition_seen !== "boolean") out.push("edition.weekly_edition_seen is not a boolean");
  const seen = new Set();
  let prevPackage = Infinity;
  for (const s of r.stories ?? []) {
    const at = `story ${s.key}`;
    if (seen.has(s.key)) out.push(`${at}: key repeats`);
    seen.add(s.key);
    if (!SLOT.test(String(s.slot))) out.push(`${at}: slot ${s.slot} is not lead, package_n or brief_n`);
    if (!SHAPES.has(s.shape)) out.push(`${at}: shape ${s.shape} is not full, document or brief`);
    const isBrief = String(s.slot).startsWith("brief_");
    if (isBrief !== (s.shape === "brief")) out.push(`${at}: a brief slot has shape brief, a package slot full or document`);
    if (!isBrief && s.shape !== shapeFor(Number(s.footage_cleared_s))) out.push(`${at}: shape ${s.shape} with ${s.footage_cleared_s} s cleared; the cap gives ${shapeFor(Number(s.footage_cleared_s))}`);
    if (!Array.isArray(s.cluster_ids) || s.cluster_ids.length === 0) out.push(`${at}: no cluster_ids`);
    if (Array.isArray(s.thread_ids) && s.thread_ids.length > 1 && !String(s.thread_reason ?? "").trim()) out.push(`${at}: clusters from ${s.thread_ids.length} threads need a thread_reason`);
    if (!isBrief) {
      if (!(s.weight <= prevPackage)) out.push(`${at}: weight ${s.weight} runs after a lighter package`);
      prevPackage = s.weight;
    }
    for (const f of ["parties", "entities", "primary_sources", "mechanisms"]) if (!Array.isArray(s[f])) out.push(`${at}: ${f} is not a list`);
    if (typeof s.coi !== "boolean") out.push(`${at}: coi is not a boolean`);
    if (final) for (const f of ["slug", "place"]) if (typeof s[f] !== "string" || !s[f].trim()) out.push(`${at}: ${f} is not written`);
  }
  if (!(r.stories ?? []).some((s) => s.slot === "lead")) out.push("no lead");
  for (const k of [...(r.tease ?? []), ...(r.briefs_order ?? [])]) if (!seen.has(k)) out.push(`${k} is referenced but is no story`);
  if (final && !r.echo) out.push("the echo is not picked");
  return out;
}

/** The text a rundown or desk file holds: two-space JSON and a newline, so a rebuild compares byte for byte. */
export const serialise = (doc) => JSON.stringify(doc, null, 2) + "\n";
