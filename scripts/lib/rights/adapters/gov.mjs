// US federal pages (founder ruling, chat 2026-11-12): a page on a federal
// host (http.mjs FEDERAL_HOSTS) is read for proof that a federal body wrote
// it, so its text or its own picture is a work of the US government (17
// U.S.C. 105). The proof is on the page itself: it names the body the host
// belongs to, and it states no credit outside that body. A picture or video
// the page only embeds from elsewhere (YouTube, X, a network player) is never
// taken, and neither is a social share card. Net-new. Pure apart from lookup().

import { hostOf } from "../licences.mjs";
import { isAllowedUrl, isFederalHost } from "../http.mjs";
import { clip, decodeEntities, firstDate, isoSecond, plain } from "../text.mjs";

/** Each federal host's body and how its page names it. A host not listed here is never read as federal. */
export const AGENCIES = [
  { host: "whitehouse.gov", agency: "The White House", re: /\bThe White House\b/ },
  { host: "senate.gov", agency: "the United States Senate", re: /\b(?:United States|U\.S\.) Senat(?:e|or)\b/ },
  { host: "house.gov", agency: "the US House of Representatives", re: /\b(?:United States|U\.S\.) House of Representatives\b/ },
  { host: "congress.gov", agency: "Congress.gov (Library of Congress)", re: /\bCongress\.gov\b|\bLibrary of Congress\b/ },
  { host: "govinfo.gov", agency: "the US Government Publishing Office", re: /\bGovernment Publishing Office\b|\bOffice of the Federal Register\b/ },
  { host: "cdc.gov", agency: "the Centers for Disease Control and Prevention", re: /\bCenters for Disease Control and Prevention\b/ },
  { host: "centcom.mil", agency: "US Central Command", re: /\b(?:U\.S\.|United States) Central Command\b/ },
  { host: "defense.gov", agency: "the US Department of Defense", re: /\b(?:U\.S\. )?Department of (?:Defense|War)\b/ },
  { host: "archives.gov", agency: "the National Archives", re: /\bNational Archives\b/ },
  { host: "trumanlibrary.gov", agency: "the Harry S. Truman Library (National Archives)", re: /\bTruman (?:Presidential )?Library\b/ },
  { host: "eisenhowerlibrary.gov", agency: "the Eisenhower Presidential Library (National Archives)", re: /\bEisenhower (?:Presidential )?Library\b/ },
];

export function agencyFor(host) {
  const h = String(host ?? "").toLowerCase();
  return AGENCIES.find((a) => h === a.host || h.endsWith(`.${a.host}`)) ?? null;
}

// A credit that names a federal photographer or office is not a third party's.
const FEDERAL_CREDIT =
  /\bOfficial White House Photo\b|\bWhite House Photo\b|\b(?:U\.S\.|US) (?:Army|Navy|Air Force|Marine Corps|Coast Guard|Space Force|Senate|House)\b|\bDepartment of (?:Defense|War)\b|\bDoD\b|\bDVIDS\b|\bSenate Photographic Studio\b|\bNational Archives\b|\bCDC\b/;

// Hosts whose iframes carry no picture (tag managers, captchas): not an embed of media.
const NOT_MEDIA = /(^|\.)(googletagmanager\.com|google\.com|gstatic\.com|recaptcha\.net)$/;

// A social share card or site artwork is never a picture of the event.
const SHARE_CARD = /share[-_ ]?card|social[-_ ]?share|og[-_]?image[-_]?default|default[-_]?(share|social|og)|placeholder|\blogo\b|seal\b|-seal|favicon/i;

/** The page's visible text: scripts, styles and tags removed, entities decoded, space collapsed. */
export function visibleText(html) {
  // plain() decodes and then strips again, so an encoded tag never survives as markup.
  return plain(String(html ?? "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, " "));
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[.:]/g, "\\$&")}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name.replace(/[.:]/g, "\\$&")}["']`, "i");
  const m = String(html).match(re);
  return m ? decodeEntities(m[1] ?? m[2] ?? "").trim() || null : null;
}

/** Every credit the page states: "Photo by X", "Photo credit: X", "Courtesy of X", "© X", and every figcaption's credit. */
export function pageCredits(html, text = visibleText(html)) {
  const out = [];
  // The office that stands directly before "Photo by" ("Official White House Photo by X") is part of the credit.
  const re = /(?:\b((?:Official )?White House|U\.S\. (?:Army|Navy|Air Force|Marine Corps|Coast Guard|Senate)|DoD|Senate)\s+)?\b(?:photo|image|video|footage)s?\s+(?:credit\s*:?|by)\s*([^.;|\n]{2,100})|\bcredit\s*:\s*([^.;|\n]{2,100})|\bcourtesy\s+(?:of\s+)?([^.;|\n]{2,100})|©\s*([^.;|\n]{2,80})/gi;
  for (const m of text.matchAll(re)) {
    const who = (m[2] ?? m[3] ?? m[4] ?? m[5]).trim();
    out.push(m[1] ? `${m[1]} Photo by ${who}` : who);
  }
  return [...new Set(out)];
}

/** Every iframe, embed or object source that is not on a federal host and is not a tag manager: a third-party embed. */
export function thirdPartyEmbeds(html) {
  const srcs = [...String(html).matchAll(/<(?:iframe|embed|object)[^>]+(?:src|data)=["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));
  return [...new Set(srcs.filter((s) => {
    const h = hostOf(s.startsWith("//") ? `https:${s}` : s);
    return h && !isFederalHost(h) && !NOT_MEDIA.test(h);
  }))];
}

/** Whether a media address appears on the page as a src, href or content value (the page's own file, not a guess). */
export function pageNames(html, url) {
  const u = String(url);
  const path = (() => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  })();
  const h = String(html);
  return h.includes(u) || h.includes(u.replace(/^https:/, "")) || (path.length > 8 && h.includes(path));
}

function pageVideo(html, base) {
  for (const m of String(html).matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base).toString();
      if (/\.(mp4|m4v|webm|mov)(\?|$)/i.test(u)) return u;
    } catch {
      // not a URL
    }
  }
  return null;
}

const EXT = { document: ".html" };

/**
 * Pure: the candidate a federal page describes. kind is the request's kind;
 * media, when given, is the file to take, which must be on the same body's
 * host and named on the page. A document with no media is the page itself.
 */
export function parseFederalPage(html, { pageUrl, kind, media = null, capturedAt, witness = null }) {
  const host = hostOf(pageUrl);
  const body = agencyFor(host);
  if (!body) return { status: "not_found", reason: `${host} is not a federal publisher this adapter knows` };
  const text = visibleText(html);
  const site = meta(html, "og:site_name");
  const title = meta(html, "og:title") ?? (String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? visibleText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]) : null) ?? pageUrl;
  const named = body.re.exec(`${site ?? ""} ${text}`)?.[0] ?? null;
  const credits = pageCredits(html, text);
  const outside = credits.filter((c) => !body.re.test(c) && !FEDERAL_CREDIT.test(c));
  const embeds = thirdPartyEmbeds(html);
  const reasons = [];
  let mediaUrl = null;
  let kindHint = kind;
  if (media) {
    if (!isAllowedUrl(media)) reasons.push(`media ${clip(media, 200)} is not on the fetcher's allowlist`);
    else if (agencyFor(hostOf(media))?.host !== body.host) reasons.push(`media ${clip(media, 200)} is not on ${body.host}: a third party's file`);
    else if (!pageNames(html, media) && !/\.xml$/i.test(new URL(pageUrl).pathname)) reasons.push(`media ${clip(media, 200)} is not named on the page`);
    mediaUrl = media;
  } else if (kind === "document") {
    // The document is the page itself: read live, or from the dated capture that witnesses it.
    mediaUrl = witness ? witness.raw_url : pageUrl;
  } else if (kind === "still") {
    const og = meta(html, "og:image");
    if (!og) reasons.push("the page carries no picture of its own");
    else if (SHARE_CARD.test(og)) reasons.push(`the page's only picture is its share card or site artwork (${clip(og, 160)}), not a picture of the event`);
    else if (agencyFor(hostOf(og))?.host !== body.host) reasons.push(`the page's picture is on ${hostOf(og)}, not ${body.host}: a third party's file`);
    else mediaUrl = og;
  } else if (kind === "footage") {
    const v = pageVideo(html, pageUrl);
    if (v && agencyFor(hostOf(v))?.host === body.host) mediaUrl = v;
    else if (embeds.length) reasons.push(`the page's video is a third-party embed (${embeds.map((e) => hostOf(e.startsWith("//") ? `https:${e}` : e)).join(", ")}), never taken`);
    else reasons.push("the page holds no video file of its own");
  } else {
    reasons.push(`a ${kind} is not read from a federal page`);
  }
  if (!named) reasons.push(`the page does not name ${body.agency}`);
  if (outside.length) reasons.push(`the page credits a party outside ${body.agency}: ${outside.map((c) => clip(c, 80)).join("; ")}`);
  const ok = reasons.length === 0;
  const published = meta(html, "article:published_time") ?? meta(html, "parsely-pub-date") ?? String(html).match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? String(html).match(/<dateIssued[^>]*>([^<]+)</i)?.[1] ?? null;
  const capturedText = [
    `Read from the page ${pageUrl}${witness ? ` as captured by the Wayback Machine at ${witness.captured_at} (${witness.capture_url})` : ""}.`,
    `Host ${host} belongs to ${body.agency}, a body of the US federal government.`,
    `The page names it: ${named ? `"${clip(named, 80)}"` : "(not found)"}${site ? `; og:site_name "${clip(site, 80)}"` : ""}.`,
    `Credits stated on the page: ${credits.map((c) => clip(c, 100)).join("; ") || "(none)"}.`,
    `Embeds from other hosts: ${embeds.map((e) => clip(e, 120)).join("; ") || "(none)"}.`,
    ok ? `No credit outside ${body.agency}: a work of the US federal government, public domain (17 U.S.C. 105).` : `Refused: ${reasons.join("; ")}.`,
  ].join("\n");
  const ymd = firstDate(published ?? "");
  return {
    status: "ok",
    candidate: {
      adapter: witness ? "wayback" : "gov",
      title: clip(title, 400) || pageUrl,
      description: clip(meta(html, "og:description") ?? meta(html, "description") ?? "", 1000),
      kind_hint: kindHint,
      item_url: witness ? witness.original_url : pageUrl,
      media_url: mediaUrl,
      ext: mediaUrl === pageUrl || (witness && mediaUrl === witness.raw_url) ? EXT.document : null,
      mime: null,
      bytes_expected: null,
      sha1: null,
      licence_raw: ok ? `${body.agency}, US federal work` : `${host} page, federal authorship not proven`,
      licence: ok ? "pd-us-federal" : null,
      licence_note: ok ? null : reasons.join("; "),
      basis: ok ? `Published on ${host} by ${body.agency}, a body of the US federal government (17 U.S.C. 105); the page names it and states no credit outside it${witness ? `. The Wayback capture of ${witness.captured_at} is the text's date witness only, never its licence` : ""}` : null,
      credit: body.agency.replace(/^the /, ""),
      credit_fields: credits,
      related_urls: embeds.map((e) => (e.startsWith("//") ? `https:${e}` : e)),
      evidence: { url: witness ? witness.capture_url : pageUrl, captured_text: capturedText, captured_at: capturedAt },
      date: witness ? witness.captured_at.slice(0, 10) : ymd,
      published_at: published ? isoSecond(published) ?? ymd : null,
      categories: [],
      keywords: [],
      own_work: false,
      uploader: null,
      witness,
      ai_fields_checked: ["title", "description", "page-credits", "embeds"],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date(), kind = "document", candidate = {} }) {
  const page = await http.getText(ref);
  if (page.status !== "ok") return { status: "not_found" };
  return parseFederalPage(page.text, { pageUrl: ref, kind, media: candidate.media ?? null, capturedAt: isoSecond(now().toISOString()) });
}
