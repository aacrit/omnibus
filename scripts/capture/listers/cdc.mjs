// C2 lister: the CDC Online Newsroom's Atom feed. Each entry's id is the
// release's own page on www.cdc.gov (its link is a tools.cdc.gov download
// redirect), so the id is the locator; adapters/gov.mjs reads that page.

import { isFederalHost } from "../../lib/rights/http.mjs";
import { defaultSince, httpsUrl, inWindow, makeItem, parseFeed, stamp } from "./feed.mjs";

export const SOURCE = "cdc";
export const FEEDS = ["https://tools.cdc.gov/podcasts/feed.asp?feedid=183"];

/** Pure: the releases a CDC feed lists, at or after `since`. */
export function parseCdcFeed(xml, { capturedAt, since = null }) {
  const out = [];
  for (const e of parseFeed(xml)) {
    const page = httpsUrl(e.guid) ?? httpsUrl(e.link);
    if (!page || !isFederalHost(new URL(page).hostname)) continue;
    if (!inWindow(e.published, since)) continue;
    out.push(makeItem({ source: SOURCE, id: page, url: page, title: e.title, description: e.description, published_at: e.published, captured_at: capturedAt, feed_link: httpsUrl(e.link) }));
  }
  return out;
}

export async function listCdc({ http, now = () => new Date(), since = defaultSince(now()), feeds = FEEDS }) {
  const capturedAt = stamp(now());
  const seen = new Map();
  for (const f of feeds) {
    const r = await http.getText(f);
    if (r.status !== "ok") continue;
    for (const it of parseCdcFeed(r.text, { capturedAt, since })) if (!seen.has(it.id)) seen.set(it.id, it);
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null };
}
