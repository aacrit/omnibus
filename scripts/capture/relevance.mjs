// C3: which listed items the capture keeps. Terms come from void news's latest
// printed editions (the snapshot library: a day's feed.json and its deep
// dives), proper-noun n-grams and single proper nouns, minus the stoplist in
// capture/channels.json; an item scores ngram_points per n-gram it contains and
// term_points per single term, and is captured at capture_at or when an
// always-capture channel matches it. Every run re-scores the last
// rescore_hours of listed metadata, so an item listed before its story
// printed is still caught. Nothing here judges rights: a selected item still
// runs its adapter's lookup() and checkCandidate (scripts/capture/evidence.mjs).
//
// Record a replay fixture from a voidnews checkout (metadata only):
//   node scripts/capture/relevance.mjs editions --voidnews ../voidnews --from 2026-11-01 --to 2026-11-08

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDate, isSnapshotPath, sha256Hex, validateManifest } from "../lib/snapshot.mjs";
import { gitSource } from "../lib/week-sources.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CHANNELS_PATH = path.join(repoRoot, "capture", "channels.json");
export const CHANNELS_SCHEMA = "omnibus.capture-channels/1";

/** capture/channels.json, checked: every pattern compiles, every number is set. */
export function loadChannels(file = CHANNELS_PATH) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const problems = channelProblems(doc);
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
  return doc;
}

export function channelProblems(doc) {
  const out = [];
  if (doc?.schema !== CHANNELS_SCHEMA) out.push(`schema is not ${CHANNELS_SCHEMA}`);
  for (const k of ["capture_at", "ngram_points", "term_points", "editions", "top_clusters", "rescore_hours"]) {
    if (!(Number.isFinite(doc?.[k]) && doc[k] > 0)) out.push(`${k} must be a positive number`);
  }
  if (!Array.isArray(doc?.stoplist) || doc.stoplist.some((s) => typeof s !== "string" || !s.trim())) out.push("stoplist must be a list of names");
  const ids = new Set();
  for (const ch of doc?.always ?? []) {
    if (!ch.id || ids.has(ch.id)) out.push(`channel id ${ch.id} is missing or repeated`);
    ids.add(ch.id);
    if (!Array.isArray(ch.sources) || !ch.sources.length) out.push(`${ch.id}: sources is empty`);
    if (!Array.isArray(ch.when) || !ch.when.length) out.push(`${ch.id}: when is empty`);
    for (const alt of ch.when ?? []) {
      for (const [field, re] of Object.entries(alt)) {
        try {
          new RegExp(re, "i");
        } catch (err) {
          out.push(`${ch.id}.${field}: ${err.message}`);
        }
      }
    }
  }
  return out;
}

// ---- Editions -------------------------------------------------------------------

/** A deep dive's article titles, the outlet suffix (" - Reuters") cut. */
export function articleTitles(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : Object.values(rows ?? {})) {
    const t = String(r?.article?.title ?? r?.title ?? "").trim();
    if (!t) continue;
    out.push(t.replace(/\s+[-–|]\s+[^-–|]{2,80}$/, "").trim());
  }
  return [...new Set(out)];
}

/** Pure: a printed day's top clusters, each with its deep dive's article titles. */
export function printedEdition({ date, feed, deepdive, top = 15 }) {
  const clusters = (feed?.clusters ?? []).slice(0, top).map((c) => ({
    id: c.id,
    title: String(c.title ?? ""),
    articles: articleTitles(deepdive(c.id)),
  }));
  return { date, printed_at: feed?.builtAt ?? null, clusters };
}

/** Editions from a voidnews checkout's history (gitSource), one per date that printed. */
export function gitEditions(voidnewsDir, dates, { top = 15, at = "origin/main" } = {}) {
  const src = gitSource(voidnewsDir, { at });
  const out = [];
  for (const date of dates) {
    const day = src.day(date);
    if (!day) continue;
    out.push(printedEdition({ date, feed: day.feed, deepdive: (id) => src.deepdive(id)?.rows ?? [], top }));
  }
  return out;
}

/**
 * Editions from the daily snapshots (week-sources dirReader or r2Reader): each
 * date's feed.json and the deep dives stored in the same snapshot, every file
 * checked against its manifest's sha256. The latest `n` dates.
 */
export function snapshotEditions(reader, { n = 3, top = 15, before = null } = {}) {
  const out = [];
  for (const date of [...reader.dates()].filter(isDate).reverse()) {
    if (out.length >= n) break;
    let m = null;
    try {
      m = JSON.parse(reader.manifest(date) ?? "null");
    } catch {
      m = null;
    }
    if (!m || validateManifest(m).length || m.date !== date) continue;
    if (before && m.printed_at && Date.parse(m.printed_at) > Date.parse(before)) continue;
    const read = (rel) => {
      const entry = m.files.find((f) => f.path === rel);
      if (!entry || !isSnapshotPath(rel)) return null;
      const bytes = reader.file(date, entry);
      if (!bytes || sha256Hex(bytes) !== entry.sha256) throw new Error(`snapshot ${date}/${rel} is missing or does not match its manifest`);
      return JSON.parse(Buffer.from(bytes).toString("utf8"));
    };
    const feed = read("feed.json");
    if (!feed) continue;
    out.push(printedEdition({ date, feed, deepdive: (id) => read(`deepdive/${id}.json`) ?? [], top }));
  }
  return out.reverse();
}

/** The latest `n` editions printed at or before `at` (oldest first). */
export function latestEditions(editions, { n = 3, at = null } = {}) {
  const t = at ? Date.parse(at) : Infinity;
  return [...editions]
    .filter((e) => !e.printed_at || Date.parse(e.printed_at) <= t)
    .sort((a, b) => String(a.printed_at ?? a.date).localeCompare(String(b.printed_at ?? b.date)))
    .slice(-n);
}

// ---- Terms ----------------------------------------------------------------------

// Headline words that are capitalised in title case but are never names.
const COMMON = new Set(
  `a an and are as at be been but by for from has have he her his how in into is it its of off on or our out over she so than that the their them they this to up was we were what when where which who whom why will with would you your
  after again against ahead all also amid among another any around back because before behind being below between both called calls can cannot could day days despite down during each early end ends even ever every
  first five four from further get gets give gives go goes going gone got half here high hold holds if just last late later least less likely made make makes many may might more most much must near new news next no nor not now
  old once one only other over own past per plan plans says said say see seen set sets several should since six some still such take takes taken ten than then there these third those three through to today told too top
  toward towards two under until upon us very via vs want wants was way week weeks while who whose why year years yet
  accused accuses add adds admits after agree agrees agreed aid aims alleged allow allows announce announces announced appeal appears approve approves arrest arrested arrests attack attacks back backs ban bans bid bill blast blames block blocks
  boost break breaks bring brings call charge charged charges claim claims close closes come comes condemn condemns confirm confirms court crash crisis cut cuts deal deals death deaths debate defend defends delay demand demands deny denies
  die dies drop drops elect election elections face faces fail fails fall falls fight fights find finds fire fires found free freed gain gains grow grows guilty hit hits hold hope hopes house hunt join joins jump kill killed kills
  launch launches lead leads leave leaves lose loses loss losses meet meets meeting miss move moves name names named open opens order orders pass passes pay pays plea pledge pledges probe protest protests push pushes quit quits raid
  raise raises rally reach reaches record reject rejects release releases remain remains report reports resign resigns return returns rise rises rule rules ruling run runs say seek seeks seize seized sentence sentenced shot show shows sign signs
  slam slams split spark sparks speech stand stands start starts strike strikes sue sues support supports talk talks threat threaten threatens tie ties trial trip turn turns urge urges vote votes voters vow vows walk war warn warns
  welcome welcomes win wins wave happy merry poll polls result results race races seat seats party parties leader leaders official officials people group groups state states city country nation world global local public political
  military forces force army troops police security government president minister secretary chief head general former deputy senior acting top`.split(/\s+/),
);

const SPLIT = /[^\p{L}\p{N}.'’-]+/u;

function stripMarks(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

/** Word tokens of a text: case kept, possessives and edge punctuation dropped. */
export function tokens(text) {
  return stripMarks(text)
    .split(SPLIT)
    .map((w) =>
      w
        .replace(/['’]s$/i, "")
        .replace(/^[.'’-]+|[.'’-]+$/g, "")
        .replace(/\.(?=[A-Za-z]{2,})/g, ""),
    )
    .filter(Boolean);
}

const key = (w) => w.toLowerCase().replace(/[.'’]/g, "");

function stopPatterns(stoplist) {
  // Longest first, so "United States of America" goes before "United States".
  return [...stoplist]
    .sort((a, b) => b.length - a.length)
    .map((s) => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"));
}

/** A text with every stoplisted name replaced by a break, so no n-gram spans it. */
export function stripStoplist(text, patterns) {
  let t = stripMarks(text);
  for (const re of patterns) t = t.replace(re, " | ");
  return t;
}

function isCapitalised(w) {
  return /^\p{Lu}/u.test(w) || /^\p{N}+\p{Lu}/u.test(w);
}

/**
 * Pure: the terms the editions give. A proper noun is a capitalised word the
 * editions never print in lower case and that is not a common headline word;
 * an n-gram is 2 or 3 consecutive proper nouns inside one text. Stoplisted
 * names never count, and break the runs they sit in.
 */
export function buildTerms(editions, { stoplist = [] } = {}) {
  const patterns = stopPatterns(stoplist);
  const texts = editions.flatMap((e) => e.clusters.flatMap((c) => [c.title, ...(c.articles ?? [])])).map((t) => stripStoplist(t, patterns));
  const lower = new Set();
  for (const t of texts) for (const w of tokens(t)) if (/^\p{Ll}/u.test(w)) lower.add(key(w));
  const stopKeys = new Set(stoplist.map((s) => key(s)));
  const proper = (w) => {
    const k = key(w);
    // A regnal or sequel numeral ("III") is not a name on its own.
    return isCapitalised(w) && k.length >= 2 && !/^\p{N}+$/u.test(k) && !/^[IVX]{2,5}$/.test(w) && !COMMON.has(k) && !lower.has(k) && !stopKeys.has(k);
  };
  const terms = new Set();
  const ngrams = new Set();
  for (const t of texts) {
    for (const segment of t.split("|")) {
      let run = [];
      const flush = () => {
        for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= run.length; i++) ngrams.add(run.slice(i, i + n).map(key).join(" "));
        run = [];
      };
      for (const w of tokens(segment)) {
        if (proper(w)) {
          terms.add(key(w));
          run.push(w);
        } else flush();
      }
      flush();
    }
  }
  return { terms, ngrams, stoplist: patterns };
}

function itemText(item) {
  return [item.title, item.description, item.keywords].filter(Boolean).join(" \n ");
}

/** Pure: an item's score against the terms, and the terms it matched. */
export function scoreItem(item, built, { ngramPoints = 2, termPoints = 1 } = {}) {
  const segments = stripStoplist(itemText(item), built.stoplist).split("|");
  // Only a capitalised word in the item can be the name the editions print.
  const words = segments.map((s) => tokens(s).map((w) => (isCapitalised(w) ? key(w) : "")));
  const seenTerms = new Set();
  const seenNgrams = new Set();
  for (const ws of words) {
    for (const w of ws) if (w && built.terms.has(w)) seenTerms.add(w);
    for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= ws.length; i++) {
      const g = ws.slice(i, i + n);
      if (g.every(Boolean) && built.ngrams.has(g.join(" "))) seenNgrams.add(g.join(" "));
    }
  }
  const ngrams = [...seenNgrams].sort();
  const terms = [...seenTerms].sort();
  return { score: ngrams.length * ngramPoints + terms.length * termPoints, ngrams, terms };
}

/** Pure: the first always-capture channel that matches an item, or null. */
export function matchChannel(item, channels) {
  for (const ch of channels.always ?? []) {
    if (!ch.sources.includes(item.source)) continue;
    for (const alt of ch.when) {
      const ok = Object.entries(alt).every(([field, re]) => {
        const v = item[field];
        const text = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
        return new RegExp(re, "i").test(stripMarks(text));
      });
      if (ok) return ch.id;
    }
  }
  return null;
}

/** When an item entered the listing: the source's own time, else when we listed it. */
export function listedAt(item) {
  return item.published_at ?? item.captured_at ?? null;
}

/**
 * Pure: every item listed in the last rescore_hours, scored against the
 * latest editions printed by `now`. Returns one decision per item:
 * { item, capture, score, ngrams, terms, channel, reason }.
 */
export function selectItems(items, { editions, channels, now }) {
  const at = now instanceof Date ? now.toISOString() : String(now);
  const latest = latestEditions(editions, { n: channels.editions, at });
  const built = buildTerms(latest.map((e) => ({ ...e, clusters: e.clusters.slice(0, channels.top_clusters) })), { stoplist: channels.stoplist });
  const from = Date.parse(at) - channels.rescore_hours * 3600_000;
  const out = [];
  for (const item of items) {
    const t = Date.parse(listedAt(item) ?? "");
    if (!Number.isFinite(t) || t < from || t > Date.parse(at)) continue;
    const s = scoreItem(item, built, { ngramPoints: channels.ngram_points, termPoints: channels.term_points });
    const channel = matchChannel(item, channels);
    const capture = channel !== null || s.score >= channels.capture_at;
    const reason = channel ? `always-capture channel ${channel}` : capture ? `score ${s.score} (${[...s.ngrams, ...s.terms].join(", ")})` : `score ${s.score} under ${channels.capture_at}`;
    out.push({ item, capture, score: s.score, ngrams: s.ngrams, terms: s.terms, channel, reason, editions: latest.map((e) => e.date) });
  }
  return out;
}

// ---- CLI: record editions for a replay fixture ------------------------------------

function* datesBetween(from, to) {
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) yield d.toISOString().slice(0, 10);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : null;
  };
  if (args[0] !== "editions" || !arg("voidnews") || !isDate(arg("from") ?? "") || !isDate(arg("to") ?? "")) {
    console.error("usage: node scripts/capture/relevance.mjs editions --voidnews <checkout> --from <date> --to <date> [--at <commit>]");
    process.exit(2);
  }
  const editions = gitEditions(path.resolve(arg("voidnews")), [...datesBetween(arg("from"), arg("to"))], { at: arg("at") ?? "origin/main" });
  process.stdout.write(JSON.stringify({ schema: "omnibus.capture-editions/1", editions }, null, 1) + "\n");
}
