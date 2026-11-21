// C2 lister: new Wikimedia Commons uploads in the White House, DoD, State and
// NASA video categories, newest first, through the MediaWiki API (metadata
// only; the rights adapter adapters/commons.mjs judges each file later).

import { plain } from "../../lib/rights/text.mjs";
import { defaultSince, inWindow, makeItem, stamp, youtubeIds } from "./feed.mjs";

export const SOURCE = "commons";
const API = "https://commons.wikimedia.org/w/api.php";

/** Category names read on 2026-11-13 from Commons's own category search. */
export const CATEGORIES = [
  "Category:Videos by The White House posted on YouTube (Donald Trump, 2025-2029)",
  "Category:Videos by the United States Department of Defense",
  "Category:Videos by the Defense Visual Information Distribution Service",
  "Category:Videos by the United States Department of State",
  "Category:Videos of United States State Department Press Briefings",
  "Category:Videos by NASA",
];

export const PAGE_LIMIT = 50;
export const MAX_PAGES = 4;

export function categoryUrl(category, { limit = PAGE_LIMIT, cont = null } = {}) {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "categorymembers",
    gcmtitle: category,
    gcmtype: "file",
    gcmsort: "timestamp",
    gcmdir: "desc",
    gcmlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|timestamp|mime|size|extmetadata",
    iiextmetadatafilter: "ImageDescription|DateTimeOriginal|Credit|LicenseShortName",
  });
  if (cont) p.set("gcmcontinue", cont);
  return `${API}?${p}`;
}

function cleanMediaUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (k.startsWith("utm_")) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return null;
  }
}

/** Pure: the files a categorymembers answer lists, uploaded at or after `since`. */
export function parseCategory(json, { category, capturedAt, since = null }) {
  const out = [];
  for (const p of json?.query?.pages ?? []) {
    const ii = p.imageinfo?.[0];
    if (!ii || !p.title) continue;
    if (!inWindow(ii.timestamp, since)) continue;
    const ext = ii.extmetadata ?? {};
    out.push(
      makeItem({
        source: SOURCE,
        id: p.title,
        url: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
        title: p.title.replace(/^File:/, "").replace(/\.[a-z0-9]{2,4}$/i, ""),
        description: plain(ext.ImageDescription?.value ?? ""),
        // Commons's own field: the upload's time. The event's date, when the file page states one, is event_date.
        published_at: ii.timestamp,
        captured_at: capturedAt,
        event_date: plain(ext.DateTimeOriginal?.value ?? "") || null,
        licence_short: plain(ext.LicenseShortName?.value ?? "") || null,
        youtube_ids: youtubeIds(ext.Credit?.value ?? ""),
        media_url: cleanMediaUrl(ii.url),
        mime: ii.mime ?? null,
        bytes: ii.size ?? null,
        duration_s: ii.duration ?? null,
        category,
      }),
    );
  }
  return out;
}

/** Whether the answer's oldest listed file is already older than the window (so later pages are older still). */
function exhausted(json, since) {
  const ts = (json?.query?.pages ?? []).map((p) => p.imageinfo?.[0]?.timestamp).filter(Boolean).sort();
  return Boolean(since && ts.length && Date.parse(ts[0]) < Date.parse(since));
}

export async function listCommons({ http, now = () => new Date(), since = defaultSince(now()), categories = CATEGORIES, maxPages = MAX_PAGES }) {
  const capturedAt = stamp(now());
  const seen = new Map();
  for (const category of categories) {
    let cont = null;
    for (let page = 0; page < maxPages; page++) {
      const r = await http.getJson(categoryUrl(category, { cont }));
      if (r.status !== "ok") break;
      for (const it of parseCategory(r.json, { category, capturedAt, since })) if (!seen.has(it.id)) seen.set(it.id, it);
      cont = r.json?.continue?.gcmcontinue ?? null;
      if (!cont || exhausted(r.json, since)) break;
    }
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null };
}
