// C2 lister: the White House's pages and RSS, as LOCATORS ONLY. Its videos
// are YouTube embeds, which are never downloaded (adapters/gov.mjs refuses a
// third-party embed); a White House item says what happened and when, and
// the matching Commons upload (matchCommons, below) is the media source.

import { defaultSince, httpsUrl, inWindow, makeItem, parseFeed, stamp, youtubeIds } from "./feed.mjs";

export const SOURCE = "whitehouse";
export const FEEDS = ["https://www.whitehouse.gov/videos/feed/", "https://www.whitehouse.gov/news/feed/"];

const WH = /^https:\/\/www\.whitehouse\.gov\//;

/** Pure: the locators a White House feed lists, at or after `since`. Never a media URL. */
export function parseWhiteHouseFeed(xml, { capturedAt, since = null }) {
  const out = [];
  for (const e of parseFeed(xml)) {
    const url = httpsUrl(e.link);
    if (!url || !WH.test(url)) continue;
    if (!inWindow(e.published, since)) continue;
    out.push(
      makeItem({
        source: SOURCE,
        id: url,
        url,
        title: e.title,
        description: e.description.replace(/<p>The post <a[\s\S]*$/i, ""),
        published_at: e.published,
        captured_at: capturedAt,
        locator: true,
        media_url: null,
        kind: /\/videos\//.test(url) ? "video-page" : "page",
        categories: e.categories,
        youtube_ids: youtubeIds(`${e.content} ${e.description}`),
      }),
    );
  }
  return out;
}

export async function listWhiteHouse({ http, now = () => new Date(), since = defaultSince(now()), feeds = FEEDS }) {
  const capturedAt = stamp(now());
  const seen = new Map();
  for (const f of feeds) {
    const r = await http.getText(f);
    if (r.status !== "ok") continue;
    for (const it of parseWhiteHouseFeed(r.text, { capturedAt, since })) if (!seen.has(it.id)) seen.set(it.id, it);
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null };
}

/** Words of a title, normalised for matching: lower case, letters and digits only, the file extension dropped. */
export function titleWords(title) {
  return String(title ?? "")
    .replace(/^File:/i, "")
    .replace(/\.(webm|ogv|mp4|mov|jpe?g|png|tiff?)$/i, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&#?\w+;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);
}

/** Share of the shorter title's words found in the longer one (0..1). */
export function titleOverlap(a, b) {
  const A = titleWords(a);
  const B = new Set(titleWords(b));
  if (!A.length || !B.size) return 0;
  const [short, long] = A.length <= B.size ? [A, B] : [[...B], new Set(A)];
  return short.filter((w) => long.has(w)).length / short.length;
}

export const MATCH_MIN_OVERLAP = 0.8;
/** A Commons upload of a White House video lands from a day before (clock skew) to a week after the post. */
export const MATCH_DAYS_BEFORE = 1;
export const MATCH_DAYS_AFTER = 7;

/**
 * Pure: for each White House locator, the Commons upload that carries its
 * media, or null. A shared YouTube id is a match outright; otherwise the
 * titles must overlap by MATCH_MIN_OVERLAP and the upload must fall in the
 * date window. Commons items are the commons lister's items.
 */
export function matchCommons(whItems, commonsItems) {
  return whItems.map((w) => {
    let best = null;
    for (const c of commonsItems) {
      const sharedYt = (w.youtube_ids ?? []).find((id) => (c.youtube_ids ?? []).includes(id));
      if (sharedYt) {
        best = { commons_id: c.id, commons_url: c.url, by: "youtube-id", youtube_id: sharedYt, score: 1 };
        break;
      }
      const days = w.published_at && c.published_at ? (Date.parse(c.published_at) - Date.parse(w.published_at)) / 86_400_000 : null;
      if (days === null || days < -MATCH_DAYS_BEFORE || days > MATCH_DAYS_AFTER) continue;
      const score = titleOverlap(w.title, c.title);
      if (score >= MATCH_MIN_OVERLAP && (!best || score > best.score)) best = { commons_id: c.id, commons_url: c.url, by: "title", score: Math.round(score * 100) / 100 };
    }
    return { whitehouse_id: w.id, match: best };
  });
}
