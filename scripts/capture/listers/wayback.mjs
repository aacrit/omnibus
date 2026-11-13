// C2: the Wayback Machine as a LOCATOR for hosts that refuse the honest
// identity (founder ruling, 2026-11-13). A capture of a refused host's PAGE
// may be read to date an item and to locate it (its title, its time, the
// DVIDS or Commons item it names); it is never used to fetch media, and a
// host that answers us is read directly, not through Wayback. Media comes
// only through DVIDS and Commons. Refusals throw; nothing is fetched first.

import { cdxUrl, parseCdx, witnessOf } from "../../lib/rights/adapters/wayback.mjs";
import { clip } from "../../lib/rights/text.mjs";

/** Hosts that refused the honest request in C0 (docs/DECISIONS.md, 2026-11-13); a subdomain counts as its host. */
export const REFUSED_HOSTS = ["war.gov", "state.gov", "noaa.gov"];

export const USE = "date and locate only; never a media source";

/** A media file's address: by extension, by a media host, or by a Wayback media flag (im_, oe_, js_, cs_, if_). */
const MEDIA_EXT = /\.(?:mp4|m4v|webm|mov|ogv|mkv|avi|m3u8|mpd|ts|mp3|m4a|wav|aac|ogg|flac|jpe?g|png|gif|webp|avif|tiff?|bmp|svg|heic|pdf|zip)(?:$|[?#])/i;
const MEDIA_HOST = /^(?:media|video|videos|img|images|cdn|static|assets|vod)[0-9-]*\./i;
const WAYBACK_MEDIA_FLAG = /^\/web\/\d{14}(?:im_|oe_|js_|cs_|if_|fw_)\//;

export class NotALocator extends Error {}

/** Whether a host refused the honest request in C0. */
export function isRefusedHost(host) {
  const h = String(host ?? "").toLowerCase();
  return REFUSED_HOSTS.some((r) => h === r || h.endsWith(`.${r}`));
}

/** Why a URL may not be located through Wayback, or null. Pure. */
export function locatorRefusal(url, { refusedHosts = REFUSED_HOSTS } = {}) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return `not a URL: ${clip(url, 120)}`;
  }
  let original = u;
  if (u.hostname === "web.archive.org") {
    if (WAYBACK_MEDIA_FLAG.test(u.pathname)) return `refused ${clip(url, 160)}: a Wayback media capture; Wayback is never a media source`;
    const w = witnessOf(String(url).replace(/\/web\/(\d{14})id_\//, "/web/$1/"));
    if (!w) return `refused ${clip(url, 160)}: not a dated Wayback capture of a page`;
    original = new URL(w.original_url);
  }
  if (MEDIA_EXT.test(original.pathname) || MEDIA_HOST.test(original.hostname)) return `refused ${clip(url, 160)}: a media file; Wayback is never a media source`;
  const h = original.hostname.toLowerCase();
  if (!refusedHosts.some((r) => h === r || h.endsWith("." + r))) return `refused ${clip(url, 160)}: ${h} answers the honest request, so it is read directly, not through Wayback`;
  return null;
}

export function assertLocator(url, opts) {
  const why = locatorRefusal(url, opts);
  if (why) throw new NotALocator(why);
}

/**
 * Network: every capture of a refused host's page (or a page prefix ending in
 * "*") inside a window, as { timestamp, original, capture_url, captured_at, use }.
 */
export async function locate(pattern, window, { http, refusedHosts = REFUSED_HOSTS }) {
  const page = String(pattern).replace(/\*$/, "");
  assertLocator(/^https?:\/\//.test(page) ? page : `https://${page}`, { refusedHosts });
  const r = await http.getJson(cdxUrl(pattern, window));
  if (r.status !== "ok") return [];
  return parseCdx(r.json, window)
    .filter((c) => locatorRefusal(c.original, { refusedHosts }) === null)
    .map((c) => ({ ...c, captured_at: witnessOf(c.capture_url).captured_at, use: USE }));
}

/**
 * Network: one captured page's HTML, read to date and locate its item. The
 * capture must be of a refused host's page; anything else throws before any request.
 */
export async function readCapturedPage(captureUrl, { http, refusedHosts = REFUSED_HOSTS }) {
  assertLocator(captureUrl, { refusedHosts });
  const w = witnessOf(String(captureUrl).replace(/\/web\/(\d{14})id_\//, "/web/$1/"));
  const r = await http.getText(w.raw_url);
  if (r.status !== "ok") return { status: "not_found", witness: w, use: USE };
  return { status: "ok", html: r.text, witness: w, use: USE };
}
