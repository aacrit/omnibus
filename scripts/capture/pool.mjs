// C7: the week's capture pool, and the candidate pins it becomes. Pure.
//
// buildPool: the first capture run that sees a new weekly issue n writes
// capture/weekly/<n>/pool.json (omnibus.capture-pool/1): the week's stories
// (the lead, the seven day leads, the margins), each with the captured items
// scored against that story's own terms (its cluster titles and deep-dive
// article titles, through relevance.mjs), their times and their evidence keys.
// Nothing here judges rights or fit: the verdict shown is the one captured,
// and every pin still runs the fetcher's checks.
//
// candidatesFromPool: after the rundown, `node scripts/rights.mjs candidates <n>`
// maps each story to the rundown's asset requests by the beat's cluster id
// (the lead by the rundown's claim clusters; a day or margin by position only
// when the beat names no cluster) and writes episodes/<n>/candidates/capture.json
// (omnibus.asset-candidates/1). Every fit it writes is automatic: `fit.auto`
// is true and `fit.why` starts "auto:", and the render lint
// capture-fit-confirmed refuses a final render until a Claude session has
// looked at the picture, replaced fit.why and set fit.confirmed_by.

import { addDays } from "../lib/normalise.mjs";
import { evidenceKey } from "../lib/capture-store.mjs";
import { buildTerms, scoreItem } from "./relevance.mjs";
import { SOURCES } from "./evidence.mjs";

export const POOL_SCHEMA = "omnibus.capture-pool/1";
export const CANDIDATES_SCHEMA = "omnibus.asset-candidates/1";
export const AUTO_WHY = "auto:";
export const MAX_ITEMS_PER_STORY = 12;
export const MAX_PINS_PER_REQUEST = 5;

export const poolKey = (issue) => {
  if (!Number.isInteger(issue) || issue < 1) throw new Error(`not a weekly issue: ${issue}`);
  return `capture/weekly/${issue}/pool.json`;
};

const VIDEO = /\.(webm|ogv|mp4|m4v|mov|mpe?g)$|^video:\d+$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|tiff?)$|^image:\d+$/i;
// The rights adapter a captured source's pin names (whitehouse is a locator: never pinned).
export const PIN_ADAPTER = { commons: "commons", dvids: "dvids", nasa: "nasa", voa: "voa", cdc: "gov", noaa: "gov" };

/** Pure: the first dignity exclude (capture/channels.json exclude) an item's title or description matches, as a reason, or null. */
export function excludedBy(item, excludes = []) {
  const text = [item.title, item.description].filter(Boolean).join(" \n ");
  for (const ex of excludes) if (new RegExp(ex.pattern, "i").test(text)) return `dignity exclude ${ex.id}: ${ex.why}; never pinned automatically`;
  return null;
}

/** footage, still or null, from the item's id, its media or the source's media address. */
export function kindOf(entry) {
  const names = [entry.id, entry.media?.key, entry.evidence?.media_url].map((x) => String(x ?? "").split("?")[0]);
  if (names.some((n) => VIDEO.test(n))) return "footage";
  if (names.some((n) => IMAGE.test(n))) return "still";
  if (entry.source === "cdc" || entry.source === "noaa") return "still";
  return null;
}

const dayStart = (d) => `${d}T00:00:00Z`;

/** The week's stories from its record (data/week-<n>.json, schema 1 or 2): lead, day leads, margins. */
export function weekStories(record) {
  const out = [];
  const leadRecords = Array.isArray(record?.lead?.records) ? record.lead.records : [];
  const primary = leadRecords.find((r) => r.role === "claim") ?? leadRecords[0] ?? null;
  const weekWindow = { from: dayStart(addDays(record.week_start, -1)), to: dayStart(addDays(record.week_end, 1)) };
  if (primary) {
    out.push({
      key: "lead",
      role: "lead",
      cluster_id: primary.cluster_id ?? null,
      cluster_ids: [...new Set(leadRecords.map((r) => r.cluster_id).filter(Boolean))],
      titles: [...new Set(leadRecords.map((r) => r.title).filter(Boolean))],
      title: primary.title ?? null,
      date: null,
      horizon: record.as_of ?? null,
      window: weekWindow,
    });
  }
  (record.days ?? []).forEach((d, i) => {
    if (!d?.lead?.cluster_id) return;
    out.push({
      key: `day-${i + 1}`,
      role: "day",
      day: i + 1,
      cluster_id: d.lead.cluster_id,
      cluster_ids: [d.lead.cluster_id],
      titles: [d.lead.title].filter(Boolean),
      title: d.lead.title ?? null,
      date: d.date,
      horizon: d.printed_at ?? null,
      window: { from: dayStart(addDays(d.date, -1)), to: dayStart(addDays(d.date, 1)) },
    });
  });
  (record.margins?.stories ?? []).forEach((m, i) => {
    out.push({
      key: `margin-${i + 1}`,
      role: "margin",
      margin: i + 1,
      cluster_id: m.cluster_id ?? null,
      cluster_ids: [m.cluster_id].filter(Boolean),
      titles: [m.title].filter(Boolean),
      title: m.title ?? null,
      date: m.printed_on ?? null,
      horizon: record.as_of ?? null,
      window: m.printed_on ? { from: dayStart(addDays(m.printed_on, -1)), to: dayStart(addDays(m.printed_on, 1)) } : weekWindow,
    });
  });
  return out;
}

/** A story's terms: its titles and every edition's deep-dive article titles for its clusters. */
function storyTerms(story, editions, stoplist) {
  const ids = new Set(story.cluster_ids);
  const articles = new Set();
  for (const e of editions ?? []) for (const c of e.clusters ?? []) if (ids.has(c.id)) for (const a of c.articles ?? []) articles.add(a);
  const clusters = story.titles.map((title, i) => ({ id: `${story.key}-${i}`, title, articles: i === 0 ? [...articles] : [] }));
  return buildTerms([{ date: story.date ?? "week", clusters }], { stoplist });
}

const timeOf = (e) => e.evidence?.published_at ?? e.listed_at ?? null;

/**
 * The pool for weekly issue `issue`. `record` is the week record; `index` the
 * capture index (scripts/lib/capture-store.mjs); `editions` the printed
 * editions relevance.mjs reads (for deep-dive article titles); `channels`
 * capture/channels.json (stoplist and points). Items count for a story when
 * they were published inside its window and score at least channels.capture_at
 * against its terms.
 */
export function buildPool({ issue, record, index, editions = [], channels, now, from = null, maxItems = MAX_ITEMS_PER_STORY }) {
  if (record?.issue !== issue) throw new Error(`the week record is for issue ${record?.issue}, not ${issue}`);
  const at = (now instanceof Date ? now : new Date(now)).toISOString().replace(/\.\d{3}Z$/, "Z");
  const entries = Object.entries(index?.items ?? {});
  const stories = weekStories(record).map((story) => {
    const built = storyTerms(story, editions, channels.stoplist ?? []);
    const from = Date.parse(story.window.from);
    const to = Date.parse(story.window.to);
    const items = [];
    for (const [sid, e] of entries) {
      const t = Date.parse(timeOf(e) ?? "");
      if (!Number.isFinite(t) || t < from || t >= to) continue;
      const s = scoreItem({ title: e.title, description: e.description }, built, { ngramPoints: channels.ngram_points, termPoints: channels.term_points });
      if (s.score < channels.capture_at) continue;
      items.push({
        sid,
        source: e.source,
        id: e.id,
        url: e.url,
        title: e.title,
        kind: kindOf(e),
        published_at: e.evidence?.published_at ?? null,
        source_time: e.evidence?.source_time ?? null,
        captured_at: e.evidence?.captured_at ?? null,
        listed_at: e.listed_at ?? null,
        score: s.score,
        ngrams: s.ngrams,
        terms: s.terms,
        verdict: { status: e.evidence?.verdict?.status ?? null, licence: e.evidence?.verdict?.licence ?? null },
        media: e.media ? { key: e.media.key, sha256: e.media.sha256, ext: e.media.ext, bytes: e.media.bytes } : null,
        evidence_keys: (e.evidence_keys ?? []).map(evidenceKey),
        refused: e.refused ?? null,
        excluded: excludedBy(e, channels.exclude ?? []),
      });
    }
    items.sort((a, b) => b.score - a.score || String(a.published_at).localeCompare(String(b.published_at)) || a.sid.localeCompare(b.sid));
    return { ...story, terms: [...built.ngrams, ...built.terms].sort(), items: items.slice(0, maxItems), items_over_cap: Math.max(0, items.length - maxItems) };
  });
  return {
    schema: POOL_SCHEMA,
    issue,
    week_start: record.week_start,
    week_end: record.week_end,
    built_at: at,
    record_from: from,
    min_score: channels.capture_at,
    index_items: entries.length,
    stories,
  };
}

export function poolProblems(pool) {
  const out = [];
  if (pool?.schema !== POOL_SCHEMA) out.push(`schema is not ${POOL_SCHEMA}`);
  if (!Number.isInteger(pool?.issue)) out.push("issue is not a number");
  if (!Array.isArray(pool?.stories)) out.push("stories is not a list");
  for (const s of pool?.stories ?? []) {
    if (!s.key || !s.window?.from || !s.window?.to || !Array.isArray(s.items)) out.push(`story ${s.key ?? "?"} is not well formed`);
  }
  return out;
}

/** Every beat in the rundown, by id, with the asset requests it names. */
function beatsById(rundown) {
  const m = new Map();
  for (const p of rundown.parts ?? []) for (const b of p.beats ?? []) if (b?.id) m.set(b.id, b);
  return m;
}

/** The pool story a rundown request belongs to, or { story: null, problem }. */
export function storyFor(req, { rundown, pool, beats = beatsById(rundown) }) {
  const by = (pred) => pool.stories.find(pred) ?? null;
  const f = String(req.for ?? "");
  const beat = beats.get(f) ?? null;
  const cluster = beat?.known?.cluster_id ?? null;
  if (/^weight-/.test(f)) {
    const claims = [rundown.lead?.cluster, ...(rundown.lead?.claim_clusters ?? [])].filter(Boolean).map(String);
    const lead = by((s) => s.role === "lead");
    if (!lead) return { story: null, problem: `${req.id}: the pool has no lead story` };
    if (claims.length && !lead.cluster_ids.some((id) => claims.some((c) => id.startsWith(c)))) return { story: null, problem: `${req.id}: the rundown's lead clusters (${claims.join(", ")}) are not the pool's lead (${lead.cluster_ids.join(", ")})` };
    return { story: lead };
  }
  const day = /^week-day-(\d+)$/.exec(f);
  const margin = /^margins-(\d+)$/.exec(f);
  if (!day && !margin) return { story: null, problem: null };
  if (cluster) {
    const s = by((x) => x.cluster_ids.includes(cluster));
    return s ? { story: s } : { story: null, problem: `${req.id}: beat ${f} names cluster ${cluster}, which no pool story holds` };
  }
  const s = day ? by((x) => x.role === "day" && x.day === Number(day[1])) : by((x) => x.role === "margin" && x.margin === Number(margin[1]));
  return s ? { story: s } : { story: null, problem: `${req.id}: the pool has no story for ${f}` };
}

/** The tier and window a pin on `adapter` takes in `req`'s ladder; an adapter off the ladder takes the last real tier and the story's window. */
function placeOnLadder(req, adapter, story, horizon) {
  const steps = (req.ladder ?? []).filter((s) => s.adapter !== "e6-graphics");
  const match = steps.find((s) => (adapter === "gov" ? /^gov-federal/.test(String(s.adapter)) : s.adapter === adapter));
  // Off the ladder, the story's window, ending at the beat's horizon when that is earlier.
  const to = horizon && Date.parse(horizon) < Date.parse(story.window.to) ? horizon : story.window.to;
  const own = { from: story.window.from.slice(0, 10), to };
  if (match) return { tier: match.tier, window: match.window ?? own, on_ladder: true };
  const last = steps.map((s) => s.tier).filter(Number.isInteger).sort((a, b) => b - a)[0] ?? 2;
  return { tier: last, window: own, on_ladder: false };
}

/** The candidate pins for one request from its story's items (ok verdict, a pin adapter, the request's kind). */
function pinsFor(req, story, beat, maxPins) {
  const want = req.kind === "footage" ? ["footage", "still"] : req.kind === "still" ? ["still"] : [];
  if (!want.length) return [];
  const items = story.items.filter((it) => it.verdict?.status === "ok" && PIN_ADAPTER[it.source] && want.includes(it.kind) && !it.excluded);
  const horizon = beat?.as_of ?? story.horizon ?? null;
  const placed = items.map((it) => ({ it, place: placeOnLadder(req, PIN_ADAPTER[it.source], story, horizon) }));
  // The ladder's own order first (on-ladder before off, lower tier first), then score.
  placed.sort((a, b) => Number(b.place.on_ladder) - Number(a.place.on_ladder) || a.place.tier - b.place.tier || want.indexOf(a.it.kind) - want.indexOf(b.it.kind) || b.it.score - a.it.score);
  return placed.slice(0, maxPins).map(({ it, place }) => {
    const adapter = PIN_ADAPTER[it.source];
    const matched = [...it.ngrams, ...it.terms].join(", ");
    return {
      tier: place.tier,
      adapter,
      ref: SOURCES[it.source].ref(it),
      window: place.window,
      why: `the capture pool for issue ${story.issue ?? ""}`.trim() + `: ${it.title ?? it.id}, captured ${it.captured_at ?? "?"}`,
      fit: {
        beat: req.for,
        why: `${AUTO_WHY} scored ${it.score} against ${story.key} (${matched}); published ${it.published_at ?? "at an unstated time"}; not yet looked at: replace this with what the picture shows and the seconds that show it, then set confirmed_by`,
        auto: true,
        horizon: horizon ?? undefined,
      },
      capture: { sid: it.sid, score: it.score, published_at: it.published_at, media_key: it.media?.key ?? null, evidence_keys: it.evidence_keys },
    };
  });
}

/**
 * The capture's candidate-pin file for an episode. Returns { doc, problems }:
 * doc is omnibus.asset-candidates/1 (source "capture"); problems are mapping
 * failures (a beat's cluster the pool lacks, a lead that is not the pool's).
 */
export function candidatesFromPool(pool, rundown, { maxPins = MAX_PINS_PER_REQUEST, now } = {}) {
  const problems = poolProblems(pool);
  if (rundown?.issue !== pool?.issue) problems.push(`the rundown is for issue ${rundown?.issue}, the pool for ${pool?.issue}`);
  const pins = {};
  const excluded = [];
  if (!problems.length) {
    const beats = beatsById(rundown);
    for (const req of rundown.asset_requests ?? []) {
      const { story, problem } = storyFor(req, { rundown, pool, beats });
      if (problem) problems.push(problem);
      if (!story) continue;
      const list = pinsFor(req, { ...story, issue: pool.issue }, beats.get(String(req.for)), maxPins);
      if (list.length) pins[req.id] = list;
      for (const it of story.items) if (it.excluded) excluded.push({ request: req.id, sid: it.sid, title: it.title, why: it.excluded });
    }
  }
  const at = now ? (now instanceof Date ? now : new Date(now)).toISOString().replace(/\.\d{3}Z$/, "Z") : pool?.built_at;
  return {
    doc: {
      schema: CANDIDATES_SCHEMA,
      issue: pool?.issue,
      source: "capture",
      note: `Automatic candidates from the capture pool (capture/weekly/${pool?.issue}/pool.json, built ${pool?.built_at}), written ${at} by node scripts/rights.mjs candidates. Every fit is automatic (fit.auto, fit.why starting "${AUTO_WHY}"): the render lint capture-fit-confirmed refuses a final render until a Claude session replaces fit.why with what the picture shows and sets fit.confirmed_by. Nothing here is a rights decision; the fetcher checks every candidate.`,
      pins,
      excluded,
    },
    problems,
  };
}

/** Pure: why an automatic fit may not reach a final render, or null. */
export function unconfirmedFit(fit) {
  if (!fit || fit.auto !== true) return null;
  if (!String(fit.confirmed_by ?? "").trim()) return "an automatic fit nobody has confirmed (fit.confirmed_by is not set)";
  if (String(fit.why ?? "").trim().startsWith(AUTO_WHY)) return "an automatic fit whose why was never replaced";
  return null;
}
