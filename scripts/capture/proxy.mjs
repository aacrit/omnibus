// C6: the <=480p proxy a capture keeps against deletion, and which items a
// public workflow artifact may hold. Pure. Full resolution is fetched at pin
// time by `rights.mjs fetch`, which checks the sha256 the ledger records; the
// proxy is only insurance that the item can still be found and seen.
//
// Per source, the addresses tried in order (every one is on the fetcher's
// allowlist, scripts/lib/rights/http.mjs):
//   commons  a video's 480p (then 360p) transcode, an image's 854 px thumbnail
//   dvids    the adapter's proxy_url (the largest mp4 at or under 480 px)
//   nasa     the adapter's proxy_url (~mobile / ~small video, ~medium / ~small image)
//   voa      the adapter's proxy_url (the largest mp4 at or under 480p)
//   cdc/noaa a still from the agency's own page (media_url), size-capped
// A source with no proxy is kept as metadata and evidence only, with the reason.

import { PD_BASES } from "../lib/rights/licences.mjs";
import { isAllowedUrl } from "../lib/rights/http.mjs";
import { isRefusedHost } from "./listers/wayback.mjs";

export const PROXY_MAX_HEIGHT = 480;
const COMMONS = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/;
const VIDEO_EXT = /\.(webm|ogv|mp4|m4v|mov|mpe?g)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** The proxy addresses for a captured item, best first: [{ url, ext }], or [] with a reason. */
export function proxyCandidates(source, candidate) {
  const media = String(candidate?.media_url ?? "");
  const out = [];
  if (source === "commons") {
    const m = COMMONS.exec(media);
    if (!m) return { urls: [], reason: "the Commons record names no upload.wikimedia.org file" };
    const [, a, ab, name] = m;
    if (VIDEO_EXT.test(name)) {
      for (const t of ["480p.vp9.webm", "360p.vp9.webm", "480p.webm"]) out.push({ url: `https://upload.wikimedia.org/wikipedia/commons/transcoded/${a}/${ab}/${name}/${name}.${t}`, ext: "webm" });
    } else if (IMAGE_EXT.test(name)) {
      out.push({ url: `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${name}/854px-${name}`, ext: extOf(name) });
    } else return { urls: [], reason: `no proxy is made for a ${name.split(".").pop()} file` };
  } else if (source === "dvids" || source === "nasa" || source === "voa") {
    if (!candidate?.proxy_url) return { urls: [], reason: `the ${source} record offers no file at or under ${PROXY_MAX_HEIGHT}p` };
    out.push({ url: candidate.proxy_url, ext: extOf(candidate.proxy_url) });
  } else if (source === "cdc" || source === "noaa") {
    if (!IMAGE_EXT.test(media.split("?")[0])) return { urls: [], reason: "the agency page offers no still of its own" };
    out.push({ url: media, ext: extOf(media) });
  } else return { urls: [], reason: `${source} is a locator; its media is the matching upload elsewhere` };
  // A host that refuses the honest identity (C0) is never asked, not even for a still.
  const urls = out.filter((u) => isAllowedUrl(u.url) && !isRefusedHost(new URL(u.url).hostname) && /^[a-z0-9]{2,5}$/.test(u.ext));
  return urls.length ? { urls, reason: null } : { urls: [], reason: "no proxy address is on the fetcher's allowlist and on a host that answers us" };
}

function extOf(u) {
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(String(u));
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "";
}

/**
 * Whether an item's proxy may go in a workflow artifact. Artifacts on a public
 * repo are public, so only public-domain and Creative Commons items (VOA's own
 * work is pd-us-federal) qualify; an editorial-use, fair-use or unlicensed item
 * is kept there as its URL and evidence only.
 */
export function artifactMayHoldMedia(verdict) {
  if (verdict?.status !== "ok") return false;
  const id = String(verdict.licence ?? "");
  return PD_BASES.includes(id) || id === "cc0-1.0" || /^cc-by-(sa-)?\d\.\d$/.test(id);
}
