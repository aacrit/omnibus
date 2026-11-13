// Stage 8, step 1: the rundown's asset requests (episodes/<issue>/rundown.json
// asset_requests, each a ladder of searches) resolved into the fetcher's
// request file (episodes/<issue>/assets.json): concrete candidates in ladder
// order, each with its step's tier and date window. Nothing is chosen here;
// the fetcher still checks every candidate's rights, provenance and date.
//
// How each step is resolved:
//   commons  a "File:" name is pinned as given; anything else is a Commons
//            search (CirrusSearch syntax, as the rundown writes it), top hits
//   nasa     NASA Images search with the step's parameters, top hits
//   loc      loc.gov search with the step's parameters, top items
//   dvids    passed through; the adapter skips it without DVIDS_API_KEY
//   gov-federal, wayback-date-witness
//            the episode's pins file (episodes/<issue>/asset-pins.json) says
//            how: a pinned item, a federal RSS feed filtered to the window, a
//            Wayback CDX search inside the window, or a probe of a host that
//            has no readable search (its answer becomes the reason)
//   e6-graphics, and hosts outside the allowlist
//            not fetched; recorded with the reason, for the drop record
// Net-new. Network only through the injected http.

import { hostRefusal, isOwnUrl } from "./http.mjs";
import { REQUESTS_SCHEMA_ID } from "./ledger.mjs";
import { findCaptures } from "./adapters/wayback.mjs";
import { redact as dvidsRedact, searchHits as dvidsHits, searchUrl as dvidsSearchUrl } from "./adapters/dvids.mjs";
import { clip } from "./text.mjs";

export const SEARCH_HITS = 8;

/** "q=Explorer 1 teletype; media_type=video; year_start=1958" as an object. */
export function stepParams(query) {
  const out = {};
  for (const part of String(query).split(/;\s*/)) {
    const m = part.match(/^\s*([a-z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function commonsSearchUrl(q, limit = SEARCH_HITS) {
  const p = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "search", srnamespace: "6", srlimit: String(limit), srsearch: q });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

export function nasaSearchUrl(params) {
  const p = new URLSearchParams();
  for (const k of ["q", "media_type", "year_start", "year_end", "center"]) if (params[k]) p.set(k, params[k]);
  p.set("page_size", String(SEARCH_HITS));
  return `https://images-api.nasa.gov/search?${p}`;
}

export function locSearchUrl(params) {
  const p = new URLSearchParams({ q: params.q ?? "", fo: "json", c: String(SEARCH_HITS) });
  if (params.dates) p.set("dates", params.dates);
  return `https://www.loc.gov/search/?${p}`;
}

/** The fallback tier a request's fallback text names: tier 4 (drawn), tier 5 (typeset), or null. */
export function fallbackTier(text) {
  const m = String(text ?? "").match(/\btier ([45])\b/i);
  if (m) return Number(m[1]);
  if (/\bDRAWN\b|\blocator map\b|\bprinted (front )?page\b|\bcount card\b|\bend frame\b/.test(String(text))) return 4;
  if (/\btypeset\b/i.test(String(text))) return 5;
  return null;
}

function hostOfStep(step) {
  return String(step.host ?? "").split(/\s/)[0];
}

/** Pure: the items an RSS feed lists inside a window whose title or description matches. */
export function rssItems(xml, { match, window, field = "title" }) {
  const re = new RegExp(match, "i");
  const from = Date.parse(String(window.from).length === 10 ? `${window.from}T00:00:00Z` : window.from);
  const to = Date.parse(String(window.to).length === 10 ? `${window.to}T23:59:59Z` : window.to);
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const g = (k) => (m[1].match(new RegExp(`<${k}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${k}>`)) ?? [])[1] ?? "";
    const t = Date.parse(g("pubDate"));
    if (!Number.isFinite(t) || t < from || t > to) continue;
    if (!re.test(field === "title" ? g("title") : `${g("title")} ${g("description")}`)) continue;
    const link = g("link").trim();
    if (/^https:\/\//.test(link)) out.push({ link, title: g("title").trim(), at: new Date(t).toISOString() });
  }
  return out;
}

async function resolvePin(pin, step, { http, echoPick }) {
  const tier = pin.tier ?? step.tier;
  const window = step.window ? { from: step.window.from, to: step.window.to } : undefined;
  const host = pin.host ?? hostOfStep(step);
  if (pin.finder === "rss") {
    const found = [];
    for (let page = 1; page <= (pin.pages ?? 1); page++) {
      const url = page === 1 ? pin.feed : `${pin.feed}?paged=${page}`;
      let r;
      try {
        r = await http.getText(url);
      } catch (err) {
        return { candidates: [], not_fetched: [{ tier, host, reason: `the feed ${url} could not be read: ${clip(err.message, 200)}` }] };
      }
      if (r.status !== "ok") break;
      found.push(...rssItems(r.text, { match: pin.match, window, field: pin.field }));
    }
    if (!found.length) return { candidates: [], not_fetched: [{ tier, host, reason: `${pin.feed} lists no item matching /${pin.match}/ between ${window.from} and ${window.to}` }] };
    return { candidates: found.map((f) => ({ adapter: "gov", ref: f.link, tier, window })), not_fetched: [] };
  }
  if (pin.finder === "cdx") {
    const caps = [];
    for (const pattern of [].concat(pin.pattern)) {
      try {
        caps.push(...(await findCaptures(pattern, window, { http })));
      } catch (err) {
        return { candidates: [], not_fetched: [{ tier, host: "web.archive.org", reason: `the Wayback index could not be read for ${pattern}: ${clip(err.message, 200)}` }] };
      }
    }
    if (!caps.length) {
      return { candidates: [], not_fetched: [{ tier, host: "web.archive.org", reason: `not captured: the Wayback Machine holds no capture of ${[].concat(pin.pattern).join(" or ")} between ${window.from} and ${window.to}` }] };
    }
    const latest = caps.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, pin.limit ?? 5);
    return { candidates: latest.map((c) => ({ adapter: "wayback", ref: c.capture_url, tier, window, pinned: true })), not_fetched: [] };
  }
  if (pin.finder === "probe") {
    try {
      const r = await http.getText(pin.url);
      return { candidates: [], not_fetched: [{ tier, host, reason: r.status === "ok" ? pin.why : `${pin.url} answered not found` }] };
    } catch (err) {
      return { candidates: [], not_fetched: [{ tier, host, reason: `${pin.url}: ${clip(err.message, 200)}; ${pin.why}` }] };
    }
  }
  const c = { adapter: pin.adapter, ref: pin.ref, tier, pinned: true };
  if (window) c.window = window;
  if (pin.media) c.media = pin.media;
  const sha = pin.sha256 ?? (pin.sha256_from ? echoPick?.sources?.find((s) => `echo-pick:${s.id}` === pin.sha256_from)?.sha256 : undefined);
  if (pin.sha256_from && !sha) throw new Error(`pin ${pin.ref}: ${pin.sha256_from} names no source with a sha256`);
  if (sha) c.sha256 = sha;
  return { candidates: [c], not_fetched: [] };
}

const VIDEO = /\.(webm|ogv|mp4|m4v|mov|mpe?g)$/i;

/** For a footage request, a step's video hits before its stills (stills stay as the rostrum fallback). */
export function videoFirst(cands) {
  return [...cands.filter((c) => VIDEO.test(c.ref)), ...cands.filter((c) => !VIDEO.test(c.ref))];
}

async function searchStep(stepIn, { http, env }) {
  const step = { ...stepIn, query: stepIn.query ?? stepIn.ref ?? "" };
  const window = step.window ? { from: step.window.from, to: step.window.to } : undefined;
  const base = { tier: step.tier, ...(window ? { window } : {}) };
  if (step.adapter === "commons") {
    if (/^File:/.test(step.query)) return [{ adapter: "commons", ref: step.query, ...base, pinned: true }];
    const r = await http.getJson(commonsSearchUrl(step.query));
    const hits = r.status === "ok" ? (r.json?.query?.search ?? []).map((h) => h.title) : [];
    return hits.map((t) => ({ adapter: "commons", ref: t, ...base }));
  }
  if (step.adapter === "nasa") {
    const r = await http.getJson(nasaSearchUrl(stepParams(step.query)));
    const ids = r.status === "ok" ? (r.json?.collection?.items ?? []).map((i) => i.data?.[0]?.nasa_id).filter(Boolean) : [];
    return ids.slice(0, SEARCH_HITS).map((id) => ({ adapter: "nasa", ref: id, ...base }));
  }
  if (step.adapter === "loc") {
    const r = await http.getJson(locSearchUrl(stepParams(step.query)));
    const ids = r.status === "ok" ? (r.json?.results ?? []).map((x) => String(x.id ?? "").match(/\/item\/([^/]+)\/?$/)?.[1]).filter(Boolean) : [];
    return [...new Set(ids)].slice(0, SEARCH_HITS).map((id) => ({ adapter: "loc", ref: id, ...base }));
  }
  if (step.adapter === "dvids") {
    // Without a key the step stays a search the adapter skips with its reason; with one, DVIDS is searched inside the window.
    const key = env?.DVIDS_API_KEY;
    if (!key) return [{ adapter: "dvids", ref: clip(`search: ${step.query}`, 400), ...base }];
    try {
      const r = await http.getJson(dvidsSearchUrl(stepParams(step.query), window, key));
      return r.status === "ok" ? dvidsHits(r.json, window).slice(0, SEARCH_HITS).map((id) => ({ adapter: "dvids", ref: id, ...base })) : [];
    } catch (err) {
      throw new Error(dvidsRedact(err.message, key));
    }
  }
  return null;
}

/**
 * Resolves every request. pins: { <request id>: [pin, ...] } for the
 * federal and Wayback steps; echoPick: the episode's echo-pick.json (for
 * pinned sha256 values). Returns the assets.json document.
 */
export async function resolveRequests(rundown, { pins = {}, echoPick = null, http, env = process.env, log = () => {} }) {
  const requests = [];
  for (const req of rundown.asset_requests ?? []) {
    const candidates = [];
    const notFetched = [];
    for (const step of req.ladder ?? []) {
      const host = hostOfStep(step);
      const adapter = String(step.adapter ?? "");
      if (adapter === "e6-graphics") {
        notFetched.push({ tier: step.tier, host, reason: `drawn by E6 from ${host} data, not fetched: ${clip(step.query ?? step.ref, 300)}` });
        continue;
      }
      if (/^gov-federal|^wayback/.test(adapter)) {
        const mine = (pins[req.id] ?? []).filter((p) => !p.exclude && (p.tier ?? step.tier) === step.tier && (!p.host || p.host === host));
        if (!mine.length) {
          notFetched.push({ tier: step.tier, host, reason: `no readable search on ${host} and no pinned item, so the step was not resolved` });
          continue;
        }
        for (const pin of mine) {
          const r = await resolvePin(pin, step, { http, echoPick });
          candidates.push(...r.candidates);
          notFetched.push(...r.not_fetched);
        }
        continue;
      }
      if (adapter === "voidnews") {
        // void news's own pages are pinned (deployment, page, tour target); the capture step renders them.
        const mine = (pins[req.id] ?? []).filter((p) => p.adapter === "voidnews" && (p.tier ?? step.tier) === step.tier);
        if (!mine.length) notFetched.push({ tier: step.tier, host, reason: "no own page is pinned for this request" });
        for (const p of mine) candidates.push({ adapter: "voidnews", ref: p.ref, tier: step.tier, pinned: true, ...(step.window ? { window: { from: step.window.from, to: step.window.to } } : {}) });
        continue;
      }
      if (!adapter || adapter === "null") {
        notFetched.push({ tier: step.tier, host, reason: `${host} is outside the fetcher's allowlist and its federal extension` });
        continue;
      }
      // A pinned item for a searchable step (a founder ruling, an echo pick) goes before the search's hits.
      for (const pin of (pins[req.id] ?? []).filter((p) => !p.exclude && p.adapter === adapter && (p.tier ?? step.tier) === step.tier)) {
        candidates.push(...(await resolvePin(pin, step, { http, echoPick })).candidates);
      }
      let found;
      try {
        found = await searchStep(step, { http, env });
      } catch (err) {
        notFetched.push({ tier: step.tier, host, reason: `the search failed: ${clip(err.message, 300)}` });
        continue;
      }
      if (found === null) notFetched.push({ tier: step.tier, host, reason: `adapter ${adapter} is not one the fetcher has` });
      else if (!found.length) notFetched.push({ tier: step.tier, host, reason: `the search found nothing: ${clip(step.query ?? step.ref, 300)}` });
      else candidates.push(...(req.kind === "footage" ? videoFirst(found) : found));
    }
    const seen = new Set();
    const excludes = (pins[req.id] ?? []).filter((p) => p.exclude);
    const unique = candidates.filter((c) => {
      const k = `${c.adapter}|${c.ref}`;
      if (seen.has(k)) return false;
      seen.add(k);
      const ex = excludes.find((p) => (p.exclude === "*" ? !c.pinned && (p.tier ?? c.tier) === c.tier : p.exclude === c.ref));
      if (ex) {
        notFetched.push({ tier: c.tier, host: c.adapter, reason: `excluded on review: ${clip(c.ref, 200)}: ${clip(ex.why ?? "no reason given", 300)}` });
        return false;
      }
      return true;
    });
    requests.push({
      id: req.id,
      kind: req.kind,
      for: req.for,
      title: clip(req.purpose ?? req.id, 400),
      fallback: { tier: fallbackTier(req.fallback), text: clip(req.fallback ?? "none stated", 1000) },
      candidates: unique,
      not_fetched: notFetched,
    });
    log(`${req.id}: ${unique.length} candidate(s), ${notFetched.length} step(s) not fetched`);
  }
  return { schema: REQUESTS_SCHEMA_ID, issue: rundown.issue, source: "rundown.json asset_requests, resolved by node scripts/rights.mjs resolve", requests };
}

/** Every pinned address must be one the fetcher may reach (a pins file cannot widen the allowlist). */
export function pinProblems(pins) {
  const out = [];
  for (const [id, list] of Object.entries(pins ?? {})) {
    for (const p of list) {
      // An own page is reached only on void news's own hosts, never through the fetcher's allowlist.
      if (p.adapter === "voidnews") {
        for (const u of [p.ref, p.deployment?.url]) if (!isOwnUrl(u)) out.push(`${id}: ${u} is not one of void news's own hosts`);
        continue;
      }
      for (const u of [p.ref, p.media, p.feed, p.url].filter((x) => typeof x === "string" && /^https?:/.test(x))) {
        const r = hostRefusal(u);
        if (r) out.push(`${id}: ${r}`);
      }
    }
  }
  return out;
}
