// C2 lister: DVIDS through its API, by publish date, with the key from the
// environment (DVIDS_API_KEY, a repo secret on Actions). The key goes only
// into the request URL: it is never logged, never in an item, and any error
// that could carry the URL is redacted (adapters/dvids.mjs redact). Items
// point at DVIDS's public pages, which need no key.

import { parseRef, redact } from "../../lib/rights/adapters/dvids.mjs";
import { isoSecond } from "../../lib/rights/text.mjs";
import { defaultSince, makeItem, stamp } from "./feed.mjs";

export const SOURCE = "dvids";
const API = "https://api.dvidshub.net";
const SITE = "https://www.dvidshub.net";
export const TYPES = ["video", "image"];
export const PAGE_SIZE = 50;
export const MAX_PAGES = 4;

/** A DVIDS search for everything published inside [from, to], newest first. */
export function publishedUrl({ from, to, types = TYPES, page = 1, q = null }, key) {
  const p = new URLSearchParams({ max_results: String(PAGE_SIZE), sort: "publishdate", sortdir: "desc", page: String(page), api_key: String(key) });
  if (q) p.set("q", q);
  for (const t of types) p.append("type[]", t);
  p.set("from_publishdate", isoSecond(from));
  if (to) p.set("to_publishdate", isoSecond(to));
  return `${API}/search?${p}`;
}

/** Pure: the assets a search answer lists, published at or after `since`. */
export function parseSearch(json, { capturedAt, since = null }) {
  const out = [];
  for (const r of json?.results ?? []) {
    const ref = parseRef(r.id);
    if (!ref) continue;
    const published = r.publishdate ?? r.date_published ?? null;
    if (since && published && Date.parse(published) < Date.parse(since)) continue;
    out.push(
      makeItem({
        source: SOURCE,
        id: r.id,
        url: `${SITE}/${ref.type}/${ref.n}`,
        title: r.title ?? r.id,
        description: r.short_description ?? r.description ?? "",
        published_at: published,
        captured_at: capturedAt,
        event_date: r.date ? String(r.date).slice(0, 10) : null,
        kind: ref.type,
        unit: r.unit_name ?? null,
        branch: r.branch ?? null,
        credit: typeof r.credit === "string" ? r.credit : null,
        duration_s: r.duration ?? null,
        keywords: r.keywords ?? null,
      }),
    );
  }
  return out;
}

export async function listDvids({ http, env = process.env, now = () => new Date(), since = defaultSince(now()), types = TYPES, maxPages = MAX_PAGES }) {
  const key = env.DVIDS_API_KEY;
  if (!key) return { source: SOURCE, items: [], skipped: "DVIDS needs an API key (DVIDS_API_KEY is not set); skipped" };
  const capturedAt = stamp(now());
  const seen = new Map();
  try {
    for (let page = 1; page <= maxPages; page++) {
      const r = await http.getJson(publishedUrl({ from: since, to: now().toISOString(), types, page }, key));
      if (r.status !== "ok") break;
      const items = parseSearch(r.json, { capturedAt, since });
      for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
      const total = Number(r.json?.page_info?.total_results ?? 0);
      if ((r.json?.results ?? []).length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
    }
  } catch (err) {
    throw new Error(redact(err?.message ?? String(err), key));
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null };
}
