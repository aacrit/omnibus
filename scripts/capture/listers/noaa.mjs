// C2 lister: NOAA's newsroom RSS (https://www.noaa.gov/rss.xml). NOAA's own
// pages answered 403 (CloudFront) to the honest identity (C0,
// docs/DECISIONS.md 2026-11-13) while its RSS answers, so each item keeps the
// feed's own HTML for it (item_html, capped) as the text C4's evidence step
// may judge with adapters/gov.mjs. The pages themselves are not re-asked.

import { defaultSince, httpsUrl, inWindow, makeItem, parseFeed, stamp } from "./feed.mjs";

export const SOURCE = "noaa";
export const FEEDS = ["https://www.noaa.gov/rss.xml"];
export const MAX_ITEM_HTML = 64 * 1024;

const NOAA = /^https:\/\/(?:[a-z0-9-]+\.)*noaa\.gov\//;

/** Pure: the items NOAA's feed lists, at or after `since`. */
export function parseNoaaFeed(xml, { capturedAt, since = null }) {
  const out = [];
  for (const e of parseFeed(xml)) {
    const url = httpsUrl(e.link);
    if (!url || !NOAA.test(url)) continue;
    if (!inWindow(e.published, since)) continue;
    const credits = [...e.description.matchAll(/Image credit:\s*([^)<"]{1,160})/gi)].map((m) => m[1].trim());
    out.push(
      makeItem({
        source: SOURCE,
        id: e.guid || url,
        url,
        title: e.title,
        description: e.description,
        published_at: e.published,
        captured_at: capturedAt,
        image_credits: [...new Set(credits)],
        item_html: e.description.length > MAX_ITEM_HTML ? e.description.slice(0, MAX_ITEM_HTML) : e.description,
      }),
    );
  }
  return out;
}

export async function listNoaa({ http, now = () => new Date(), since = defaultSince(now()), feeds = FEEDS }) {
  const capturedAt = stamp(now());
  const seen = new Map();
  for (const f of feeds) {
    const r = await http.getText(f);
    if (r.status !== "ok") continue;
    for (const it of parseNoaaFeed(r.text, { capturedAt, since })) if (!seen.has(it.id)) seen.set(it.id, it);
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null };
}
