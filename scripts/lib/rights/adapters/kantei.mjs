// The Prime Minister's Office of Japan, kantei.go.jp (T5, show bible v2 section
// n). Its copyright policy (English, for reference, and the Japanese original)
// applies the Digital Agency's Public Data License 1.0, whose clause 1.7 says
// the State permits use under CC BY 4.0. All three pages are read again at every
// lookup and held to their reviewed text (state-terms.mjs). PDL1.0 asks for the
// source and, for edited content, a statement that it was edited and by whom,
// so the credit is the policy's own form, "Created by editing ...". It never
// covers symbols, logos or character designs, nor content that states other
// terms: a picture whose caption carries any credit or copyright notice is
// refused. kantei's own video is on YouTube, never taken; only a video file on
// kantei's own host would be. Net-new. Pure apart from lookup().

import { decodeEntities, clip, isoSecond, plain } from "../text.mjs";
import { LOGO, hostOf } from "../licences.mjs";
import { readTerms } from "../state-terms.mjs";
import { partyLabel } from "../records.mjs";

export const PAGE = /^https:\/\/(?:japan|www)\.kantei\.go\.jp\/[A-Za-z0-9_./-]+\.html$/;
export const TERMS_EN = "https://japan.kantei.go.jp/policies/terms_e.html";
export const TERMS_JP = "https://www.kantei.go.jp/jp/terms.html";
export const PDL_URL = "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0";
export const RELEASED_BY = "the Prime Minister's Office of Japan";
export const SITE = "Official Website of the Prime Minister's Office of Japan";
/** PDL1.0 clause 1.7, the grant: "the State permits users to use this content under CC BY". */
export const PDL_GRANT = "利用者がCC BYに従って利用することを許諾します";
/** A caption that states someone's rights: other terms apply, so the picture is refused. */
const RIGHTS_NOTICE = /©|\(c\)|copyright|\bphoto(?:graph)?\s*(?:by|:)|courtesy|提供|撮影|\bAFP\b|\bReuters\b|\bKyodo\b|共同|\bJiji\b|時事|\bPool\b/i;

function meta(html, name) {
  const n = name.replace(/[.:]/g, "\\$&");
  const m = String(html).match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i"));
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/** The page's own pictures: every <img> under /contents/ on the page's host, as { url, alt }. */
export function pagePictures(html, pageUrl) {
  const out = [];
  for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const src = m[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    let url;
    try {
      url = new URL(decodeEntities(src), pageUrl).toString();
    } catch {
      continue;
    }
    if (hostOf(url) !== hostOf(pageUrl) || !/\/contents\//.test(new URL(url).pathname)) continue;
    out.push({ url, alt: plain(decodeEntities(m[0].match(/\balt=["']([^"']*)["']/i)?.[1] ?? "")) });
  }
  return out;
}

function pageVideo(html, pageUrl) {
  for (const m of String(html).matchAll(/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), pageUrl).toString();
      if (/\.(mp4|m4v|webm|mov)(\?|$)/i.test(u) && hostOf(u) === hostOf(pageUrl)) return u;
    } catch {
      // not a URL
    }
  }
  return null;
}

/** Pure: the candidate a kantei page and its three terms pages describe. */
export function parseKanteiPage(html, { pageUrl, termsHtml = {}, kind, media = null, capturedAt, terms }) {
  if (!PAGE.test(String(pageUrl))) return { status: "not_found", reason: `${clip(pageUrl, 120)} is not a kantei.go.jp page` };
  const opt = terms ? { terms } : {};
  const reads = [readTerms("kantei-en", termsHtml.en, opt), readTerms("kantei-jp", termsHtml.jp, opt), readTerms("pdl-1.0", termsHtml.pdl, opt)];
  const reasons = reads.flatMap((r) => r.problems);
  if (reads[2].text && !reads[2].text.includes(PDL_GRANT)) reasons.push("PDL1.0 no longer states its CC BY grant (clause 1.7)");
  const title = (meta(html, "og:title") ?? plain(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")).split(" | ")[0].trim() || pageUrl;
  const day = String(html).match(/<time[^>]*datetime=["']?(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  let mediaUrl = null;
  let ext = null;
  let picture = null;
  if (kind === "still") {
    const pics = pagePictures(html, pageUrl);
    if (!media) reasons.push("a still names the picture it takes (the pin's media), never the page's share card");
    else {
      picture = pics.find((p) => p.url === media) ?? null;
      if (!picture) reasons.push(`media ${clip(media, 160)} is not one of the page's own pictures on ${hostOf(pageUrl)}`);
      else if (RIGHTS_NOTICE.test(picture.alt)) reasons.push(`the picture's caption states another party's rights ("${clip(picture.alt.match(RIGHTS_NOTICE)[0], 40)}"): content under other terms, which PDL1.0 does not cover`);
      else if (LOGO.test(picture.alt) || LOGO.test(media)) reasons.push("a logo or symbol mark, which PDL1.0 never covers");
      else mediaUrl = media;
    }
  } else if (kind === "footage") {
    const v = pageVideo(html, pageUrl);
    if (!v) reasons.push("the page holds no video file of its own on kantei.go.jp (its videos are YouTube embeds, never taken)");
    else if (media && media !== v) reasons.push(`media ${clip(media, 160)} is not the page's own video file`);
    else mediaUrl = v;
  } else if (kind === "document") {
    mediaUrl = pageUrl;
    ext = ".html";
  } else reasons.push(`a ${kind} is not read from a kantei.go.jp page`);
  if (!day) reasons.push("the page states no day");
  const ok = reasons.length === 0;
  const credit = `Created by editing "${clip(title, 200)}" (${SITE}) (${pageUrl}), CC BY 4.0 under PDL1.0`;
  const capturedText = [
    `Read from the page ${pageUrl}, the Prime Minister's Office copyright policy (${TERMS_EN}; the Japanese original ${TERMS_JP}) and the Public Data License 1.0 (${PDL_URL}).`,
    `The policy applies PDL1.0. PDL1.0 clause 1.7: "${PDL_GRANT}" (the State permits use under CC BY 4.0, Creative Commons Attribution 4.0 International).`,
    `Terms text sha256: ${reads.map((r) => `${r.entry?.id ?? "?"} ${r.sha256 ?? "(not read)"}`).join("; ")}.`,
    `Title: "${clip(title, 200)}"; day ${day ?? "(none)"}.`,
    picture ? `The picture's own caption (alt): "${clip(picture.alt, 200)}".` : null,
    ok ? `Under CC BY 4.0 by PDL1.0's grant; party label ${partyLabel(RELEASED_BY)}.` : `Refused: ${reasons.join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    status: "ok",
    candidate: {
      adapter: "kantei",
      ref: pageUrl,
      title: clip(picture?.alt ? `${title}: ${picture.alt}` : title, 400),
      description: clip(meta(html, "og:description") ?? meta(html, "description") ?? "", 1000),
      kind_hint: kind,
      item_url: pageUrl,
      media_url: mediaUrl,
      ext,
      mime: kind === "document" ? "text/html" : null,
      bytes_expected: null,
      sha1: null,
      licence_raw: ok ? "CC BY 4.0 (PDL1.0 clause 1.7)" : "kantei.go.jp page, not shown to be under PDL1.0's CC BY grant",
      licence: ok ? "cc-by-4.0" : null,
      licence_note: ok ? null : reasons.join("; "),
      basis: ok ? `The Prime Minister's Office applies the Public Data License 1.0 (${TERMS_EN}), whose clause 1.7 permits use under CC BY 4.0 (${PDL_URL}); the picture states no other party's rights (bible v2 section n)` : null,
      credit,
      credit_fields: [],
      evidence: { url: pageUrl, captured_text: capturedText, captured_at: capturedAt },
      date: day,
      published_at: day ? `${day}T23:59:59Z` : null,
      categories: [],
      keywords: [],
      own_work: false,
      uploader: null,
      released_by: RELEASED_BY,
      party_label: partyLabel(RELEASED_BY),
      ai_fields_checked: ["title", "description", "picture-caption"],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date(), kind = "still", candidate = {} }) {
  if (!PAGE.test(String(ref))) return { status: "not_found", reason: `${clip(ref, 120)} is not a kantei.go.jp page` };
  const page = await http.getText(ref);
  if (page.status !== "ok") return { status: "not_found" };
  const termsHtml = {};
  for (const [k, u] of [["en", TERMS_EN], ["jp", TERMS_JP], ["pdl", PDL_URL]]) {
    const r = await http.getText(u);
    termsHtml[k] = r.status === "ok" ? r.text : null;
  }
  return parseKanteiPage(page.text, { pageUrl: ref, termsHtml, kind, media: candidate.media ?? null, capturedAt: isoSecond(now().toISOString()) });
}
