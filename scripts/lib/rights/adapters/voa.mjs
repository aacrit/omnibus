// Voice of America (voanews.com), a US federal broadcaster (USAGM). Founder
// ruling, 2026-11-13: VOA's own-crew footage is a US federal work in the
// public domain; an item credited to an agency or any other third party
// stays refused. VOA's copyright statement (its Terms of Use page, quoted as
// the evidence) says so in its own words: "All text, audio and video material
// produced exclusively by the Voice of America is in the public domain", and
// AFP, AP and Reuters material licensed to VOA is not.
//
// One video page (www.voanews.com/a/<id>.html) is read for its title, its
// publication time (the page's datePublished), its byline, every credit the
// page states, and the largest mp4 it offers for download on VOA's video host.
// The page must name VOA and state no credit outside it. On-screen marks in
// the picture itself are the vision pass's to read (stage 9). Net-new. Pure
// apart from lookup().

import { THIRD_PARTY_CREDIT, pageCredits, visibleText } from "./gov.mjs";
import { DENIED_NAMES } from "../licences.mjs";
import { clip, decodeEntities, firstDate, isoSecond, plain } from "../text.mjs";

export const VOA_PAGE = /^https:\/\/www\.voanews\.com\/a\/(?:[a-z0-9-]+\/)?\d{1,12}\.html$/;
export const TERMS_URL = "https://www.voanews.com/p/5338.html";
export const VIDEO_HOST = "voa-video-ns.akamaized.net";
export const PD_STATEMENT = "All text, audio and video material produced exclusively by the Voice of America is in the public domain.";
/** Agencies and outlets whose name in a credit makes a VOA item third-party material. */
const AGENCY = DENIED_NAMES.filter((d) => d.name !== "a news network or outlet").map((d) => d.re);

/** The PD statement as the terms page states it, or null. */
export function termsStatement(html) {
  const text = visibleText(html);
  return text.includes(PD_STATEMENT) ? PD_STATEMENT : null;
}

/** Every mp4 the page offers on VOA's video host, as { url, height }, largest first ("_240p" marks a smaller file; none is the full size). */
export function pageVideos(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/(?:href|src|content)=["'](https:\/\/voa-video-ns\.akamaized\.net\/[^"'?]+\.mp4)(?:\?[^"']*)?["']/g)) {
    const url = decodeEntities(m[1]);
    const h = url.match(/_(\d{3,4})p\.mp4$/);
    out.set(url, { url, height: h ? Number(h[1]) : Infinity });
  }
  return [...out.values()].sort((a, b) => b.height - a.height);
}

function published(html) {
  const m = String(html).match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (!m) return null;
  return isoSecond(m[1].replace(" ", "T"));
}

/** Pure: the candidate a VOA video page and its terms page describe. */
export function parseVoaPage(html, { pageUrl, termsHtml, capturedAt }) {
  if (!VOA_PAGE.test(String(pageUrl))) return { status: "not_found", reason: `${clip(pageUrl, 120)} is not a VOA article or video page` };
  const text = visibleText(html);
  const title = plain(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || pageUrl;
  const credits = pageCredits(html);
  const reasons = [];
  if (!/\b(?:VOA|Voice of America)\b/.test(text)) reasons.push("the page does not name VOA");
  const foreign = credits.filter((c) => THIRD_PARTY_CREDIT.test(c) || AGENCY.some((re) => re.test(c)) || !/\b(?:VOA|Voice of America)\b/.test(c));
  if (foreign.length) reasons.push(`the page credits a party outside VOA: ${foreign.map((c) => clip(c, 80)).join("; ")}`);
  const agencyInText = AGENCY.find((re) => re.test(text));
  if (agencyInText) reasons.push(`the page names an agency whose material VOA only licenses: "${clip(text.match(agencyInText)[0], 60)}"`);
  const statement = termsHtml ? termsStatement(termsHtml) : null;
  if (!statement) reasons.push(`VOA's terms page (${TERMS_URL}) could not be read for its public-domain statement`);
  const video = pageVideos(html)[0] ?? null;
  if (!video) reasons.push(`the page offers no mp4 of its own on ${VIDEO_HOST}`);
  const byline = plain(String(html).match(/<a[^>]+class="[^"]*links__item-link[^"]*"[^>]*>([^<]+)<\/a>/)?.[1] ?? "") || null;
  const pub = published(html);
  const ok = reasons.length === 0;
  const capturedText = [
    `Read from the page ${pageUrl} and VOA's Terms of Use (${TERMS_URL}).`,
    `Terms: "${statement ?? "(statement not found)"}" The same page says AFP, AP and Reuters material licensed to VOA is not in the public domain.`,
    `Byline: ${byline ?? "(none)"}; published ${pub ?? "(no time on the page)"}.`,
    `Credits stated on the page: ${credits.map((c) => clip(c, 100)).join("; ") || "(none)"}.`,
    ok ? "No credit outside VOA: VOA's own material, a US federal work, public domain (17 U.S.C. 105)." : `Refused: ${reasons.join("; ")}.`,
  ].join("\n");
  return {
    status: "ok",
    candidate: {
      adapter: "voa",
      ref: pageUrl,
      title: clip(title, 400),
      description: clip(text.slice(0, 600), 1000),
      kind_hint: video ? "footage" : null,
      item_url: pageUrl,
      media_url: video?.url ?? null,
      mime: video ? "video/mp4" : null,
      bytes_expected: null,
      sha1: null,
      licence_raw: ok ? "Voice of America, produced by VOA" : "VOA page, VOA authorship not shown",
      licence: ok ? "pd-us-federal" : null,
      licence_note: ok ? null : reasons.join("; "),
      basis: ok ? `Produced by the Voice of America, a US federal broadcaster (17 U.S.C. 105); VOA's terms: "${PD_STATEMENT}"; the page credits no one outside VOA` : null,
      credit: `Voice of America${byline ? ` (${byline})` : ""}`,
      credit_fields: credits,
      evidence: { url: pageUrl, captured_text: capturedText, captured_at: capturedAt },
      date: firstDate(pub ?? ""),
      published_at: pub,
      categories: [],
      keywords: [],
      own_work: false,
      uploader: null,
      ai_fields_checked: ["title", "description", "page-credits"],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date() }) {
  if (!VOA_PAGE.test(String(ref))) return { status: "not_found", reason: `${clip(ref, 120)} is not a VOA article or video page` };
  const page = await http.getText(ref);
  if (page.status !== "ok") return { status: "not_found" };
  const terms = await http.getText(TERMS_URL);
  return parseVoaPage(page.text, { pageUrl: ref, termsHtml: terms.status === "ok" ? terms.text : null, capturedAt: isoSecond(now().toISOString()) });
}
