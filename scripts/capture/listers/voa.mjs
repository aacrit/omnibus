// C2 lister: Voice of America's RSS. Only VOA's own article pages are kept,
// and an item its feed credits to a wire (AP, Reuters, AFP...) is dropped:
// the capture takes VOA's own-crew footage only, and adapters/voa.mjs still
// judges each page's video before anything is fetched.

import { THIRD_PARTY_CREDIT } from "../../lib/rights/adapters/gov.mjs";
import { VOA_PAGE } from "../../lib/rights/adapters/voa.mjs";
import { defaultSince, httpsUrl, inWindow, makeItem, parseFeed, stamp } from "./feed.mjs";

export const SOURCE = "voa";
export const FEEDS = ["https://www.voanews.com/api/"];

/** Pure: VOA's own pages a feed lists, at or after `since`, with the wire-credited ones left out and counted. */
export function parseVoaFeed(xml, { capturedAt, since = null }) {
  const items = [];
  let wire = 0;
  for (const e of parseFeed(xml)) {
    const url = httpsUrl(e.link);
    if (!url || !VOA_PAGE.test(url)) continue;
    if (!inWindow(e.published, since)) continue;
    if (THIRD_PARTY_CREDIT.test(e.author)) {
      wire++;
      continue;
    }
    items.push(
      makeItem({
        source: SOURCE,
        id: url,
        url,
        title: e.title,
        description: e.description,
        published_at: e.published,
        captured_at: capturedAt,
        byline: e.author.replace(/^[^(]*\(([^)]*)\)\s*$/, "$1") || null,
        categories: e.categories,
      }),
    );
  }
  return { items, wire };
}

export async function listVoa({ http, now = () => new Date(), since = defaultSince(now()), feeds = FEEDS }) {
  const capturedAt = stamp(now());
  const seen = new Map();
  let wire = 0;
  for (const f of feeds) {
    const r = await http.getText(f);
    if (r.status !== "ok") continue;
    const p = parseVoaFeed(r.text, { capturedAt, since });
    wire += p.wire;
    for (const it of p.items) if (!seen.has(it.id)) seen.set(it.id, it);
  }
  return { source: SOURCE, items: [...seen.values()], skipped: null, wire_dropped: wire };
}
