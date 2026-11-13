// C2 lister: NASA's images-api, videos and images of the current year,
// newest first by NASA's own date_created (the API has no publication date;
// that field is the one it gives). adapters/nasa.mjs judges each item later.

import { defaultSince, inWindow, makeItem, stamp } from "./feed.mjs";

export const SOURCE = "nasa";
const API = "https://images-api.nasa.gov";
export const MEDIA_TYPES = ["video", "image"];
export const PAGE_SIZE = 100;
export const MAX_PAGES = 2;

export function searchUrl({ year, mediaType, page = 1, pageSize = PAGE_SIZE }) {
  const p = new URLSearchParams({ media_type: mediaType, year_start: String(year), page_size: String(pageSize), page: String(page) });
  return `${API}/search?${p}`;
}

/** Pure: the items a search answer lists, created at or after `since`. */
export function parseSearch(json, { capturedAt, since = null }) {
  const out = [];
  for (const it of json?.collection?.items ?? []) {
    const d = it.data?.[0];
    if (!d?.nasa_id) continue;
    if (!inWindow(d.date_created, since)) continue;
    out.push(
      makeItem({
        source: SOURCE,
        id: d.nasa_id,
        url: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
        title: d.title ?? d.nasa_id,
        description: d.description ?? "",
        published_at: d.date_created ?? null,
        captured_at: capturedAt,
        kind: d.media_type ?? null,
        center: d.center ?? null,
        keywords: d.keywords ?? [],
        manifest_url: it.href ?? null,
      }),
    );
  }
  return out;
}

export async function listNasa({ http, now = () => new Date(), since = defaultSince(now()), mediaTypes = MEDIA_TYPES, maxPages = MAX_PAGES }) {
  const capturedAt = stamp(now());
  const year = new Date(since).getUTCFullYear();
  const seen = new Map();
  for (const mediaType of mediaTypes) {
    for (let page = 1; page <= maxPages; page++) {
      const r = await http.getJson(searchUrl({ year, mediaType, page }));
      if (r.status !== "ok") break;
      for (const it of parseSearch(r.json, { capturedAt, since })) if (!seen.has(it.id)) seen.set(it.id, it);
      if ((r.json?.collection?.items ?? []).length < PAGE_SIZE) break;
    }
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null };
}
