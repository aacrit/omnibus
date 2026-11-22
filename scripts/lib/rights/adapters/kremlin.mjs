// kremlin.ru, the website of the President of Russia (T5, show bible v2
// section n). Its terms ("Using Website Content", read again at every lookup and
// held to the reviewed text in state-terms.mjs): all content is licensed under
// CC BY 4.0, except RIA Novosti photographs (MIA Russia Today) and TASS
// photographs posted with the agency and author named. Its video is only on
// kremlin.ru itself.
//
// One event page (/events/president/news/<id>, English or Russian) is read for
// its title, its day, its place, its own video (the mp4 files its player lists
// on static.kremlin.ru) and its photographs (each slide's caption, which names
// a RIA Novosti or TASS photographer when the picture is theirs). A slide that
// credits anyone is refused: only an uncredited Kremlin photograph is the
// Kremlin's own. The page itself is the document, and its text is the
// Kremlin's official transcript (pageTranscript). Every item carries the party
// label RELEASED BY THE KREMLIN. The site is reached over plain http (http.mjs
// PLAIN_HTTP_HOSTS). Net-new. Pure apart from lookup().

import { decodeEntities, clip, isoSecond, plain } from "../text.mjs";
import { hostOf } from "../licences.mjs";
import { readTerms } from "../state-terms.mjs";
import { partyLabel, recordKindFromTitle, textSha } from "../records.mjs";

export const PAGE = /^https?:\/\/(?:en\.)?kremlin\.ru\/events\/president\/(?:news|transcripts)\/\d{1,7}$/;
export const TERMS_URL = "http://en.kremlin.ru/about/copyrights";
export const MEDIA_HOST = "static.kremlin.ru";
export const RELEASED_BY = "the Kremlin";
export const PUBLISHER = "the Presidential Executive Office of Russia (kremlin.ru)";
export const CC_STATEMENT = "All content on this site is licensed under Creative Commons Attribution 4.0 International.";
/** The agencies whose photographs the terms exclude, in English and Russian; any credit at all refuses a slide. */
export const EXCLUDED_AGENCY = /\bRIA Novosti\b|РИА Новости|\bTASS\b|\bТАСС\b|\bSputnik\b|\bСпутник\b|\bMIA Russia Today\b|Россия сегодня/i;

function meta(html, attr, name) {
  const n = name.replace(/[.:]/g, "\\$&");
  const m = String(html).match(new RegExp(`<meta[^>]+${attr}=["']${n}["'][^>]*content=["']([^"']*)["']`, "i"));
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/** Every mp4 the page's own player lists on static.kremlin.ru: { url, label }, the high-quality file first. */
export function pageVideos(html) {
  const out = [];
  for (const m of String(html).matchAll(/<source\b[^>]*type=["']video\/mp4["'][^>]*>/gi)) {
    const src = m[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const url = decodeEntities(src);
    if (hostOf(url) !== MEDIA_HOST || !/\/media\/events\/video\//.test(url)) continue;
    out.push({ url, label: plain(m[0].match(/\bdata-label=["']([^"']*)["']/i)?.[1] ?? "") });
  }
  return out.sort((a, b) => Number(/high/i.test(b.label) || /Высокое/i.test(b.label)) - Number(/high/i.test(a.label) || /Высокое/i.test(a.label)));
}

const fileName = (u) => {
  try {
    return new URL(u).pathname.split("/").pop();
  } catch {
    return null;
  }
};

/** The slide that holds a photograph (by its file name in src or srcset), as { caption, credit, html }, or null. */
export function photoSlide(html, mediaUrl) {
  const name = fileName(mediaUrl);
  if (!name) return null;
  for (const m of String(html).matchAll(/<div class="slide[^"]*"\s+data-cycle-desc="([^"]*)">([\s\S]*?)<\/div>\s*<\/div>/g)) {
    const imgs = [...m[2].matchAll(/<img\b[^>]*>/gi)].map((i) => i[0]);
    if (!imgs.some((i) => i.includes(name))) continue;
    const caption = plain(decodeEntities(m[1]));
    const credit = caption.match(/\b(?:Photo|Фото)\s*:\s*(.+)$/i)?.[1]?.trim() ?? null;
    return { caption, credit, html: m[0] };
  }
  return null;
}

/** The official transcript the page holds: the article body's paragraphs as text, or "". */
export function transcriptText(html) {
  const s = String(html);
  const a = s.search(/<div[^>]+class="[^"]*\bentry-content\b/);
  if (a < 0) return "";
  let body = s.slice(a);
  const end = body.search(/<div class="read__cut|<div class="read__tags|<\/article>/);
  if (end > 0) body = body.slice(0, end);
  return [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => plain(decodeEntities(p[1]))).filter(Boolean).join("\n");
}

/** The page's own language, from <html lang>: "en" or "ru". */
export function pageLang(html, pageUrl) {
  return String(html).match(/<html[^>]*\blang="([a-z]{2})"/i)?.[1]?.toLowerCase() ?? (/\/\/en\./.test(pageUrl) ? "en" : "ru");
}

/** Pure: the candidate a Kremlin event page and its terms page describe. */
export function parseKremlinPage(html, { pageUrl, termsHtml, kind, media = null, capturedAt, terms }) {
  if (!PAGE.test(String(pageUrl))) return { status: "not_found", reason: `${clip(pageUrl, 120)} is not a kremlin.ru event page` };
  const title = meta(html, "property", "og:title") || plain(String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "") || pageUrl;
  const day = String(html).match(/<time[^>]*class="read__published"[^>]*datetime="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? meta(html, "itemprop", "datePublished");
  const place = plain(String(html).match(/<div class="read__place[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "") || null;
  const t = readTerms("kremlin-en", termsHtml, terms ? { terms } : {});
  const reasons = [...t.problems];
  if (t.text && !t.text.includes(CC_STATEMENT)) reasons.push(`the terms no longer state "${CC_STATEMENT}"`);
  let mediaUrl = null;
  let ext = null;
  let slide = null;
  let videos = [];
  if (kind === "footage") {
    videos = pageVideos(html);
    if (!videos.length) reasons.push("the page's player lists no mp4 of its own on static.kremlin.ru");
    else if (media) {
      if (!videos.some((v) => v.url === media)) reasons.push(`media ${clip(media, 160)} is not one of the page's own video files`);
      else mediaUrl = media;
    } else mediaUrl = videos[0].url;
  } else if (kind === "still") {
    if (!media) reasons.push("a still names the photograph it takes (the pin's media), never the page's share card");
    else if (hostOf(media) !== MEDIA_HOST || !/\/media\/events\/photos\//.test(media)) reasons.push(`media ${clip(media, 160)} is not one of the page's photographs on static.kremlin.ru`);
    else {
      slide = photoSlide(html, media);
      if (!slide) reasons.push("the photograph sits in no captioned slide of the page, so its credit cannot be read");
      else if (slide.credit && EXCLUDED_AGENCY.test(slide.credit)) reasons.push(`the slide credits "${clip(slide.credit, 80)}": a RIA Novosti or TASS photograph, which the Kremlin's terms exclude from CC BY 4.0`);
      else if (slide.credit) reasons.push(`the slide credits "${clip(slide.credit, 80)}", a photographer outside the Kremlin: not shown to be the Kremlin's own picture`);
      else mediaUrl = media;
    }
  } else if (kind === "document") {
    mediaUrl = pageUrl;
    ext = ".html";
  } else reasons.push(`a ${kind} is not read from a kremlin.ru page`);
  if (!day) reasons.push("the page states no day");
  const rk = kind === "footage" ? recordKindFromTitle(title) : null;
  const ok = reasons.length === 0;
  const capturedText = [
    `Read from the page ${pageUrl} and the President of Russia website's terms (${TERMS_URL}).`,
    `Terms: "${CC_STATEMENT}" The terms exclude RIA Novosti photographs (MIA Russia Today) and TASS photographs posted with the agency and author named. Terms text sha256 ${t.sha256 ?? "(not read)"}.`,
    `Title: "${clip(title, 200)}"; day ${day ?? "(none)"}${place ? `; place ${place}` : ""}.`,
    kind === "footage" ? `The page's own video files: ${videos.map((v) => `${v.url} (${v.label || "no label"})`).join("; ") || "(none)"}.` : null,
    slide ? `The photograph's slide caption: "${clip(slide.caption, 300)}"; credit ${slide.credit ? `"${clip(slide.credit, 100)}"` : "none (the Kremlin's own)"}.` : null,
    ok ? `Released by the Kremlin under CC BY 4.0 (Creative Commons Attribution 4.0 International); party label ${partyLabel(RELEASED_BY)}.` : `Refused: ${reasons.join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    status: "ok",
    candidate: {
      adapter: "kremlin",
      ref: pageUrl,
      title: clip(title, 400),
      description: clip(slide?.caption ?? meta(html, "property", "og:description") ?? "", 1000),
      kind_hint: kind,
      item_url: pageUrl,
      media_url: mediaUrl,
      // The capture's proxy: the page's standard-quality file; never used by the fetcher.
      proxy_url: videos.find((v) => !/high|Высокое/i.test(v.label))?.url ?? null,
      ext,
      mime: kind === "footage" ? "video/mp4" : kind === "document" ? "text/html" : null,
      bytes_expected: null,
      sha1: null,
      licence_raw: ok ? "CC BY 4.0 (kremlin.ru terms)" : "kremlin.ru page, not shown to be under the site's CC BY 4.0",
      licence: ok ? "cc-by-4.0" : null,
      licence_note: ok ? null : reasons.join("; "),
      basis: ok ? `kremlin.ru's terms (${TERMS_URL}): "${CC_STATEMENT}"; ${slide ? "an uncredited Kremlin photograph, not a RIA Novosti or TASS one" : kind === "footage" ? "the page's own video" : "the page's own text"} (bible v2 section n)` : null,
      credit: `Kremlin.ru (${PUBLISHER.replace(/^the /, "")}), CC BY 4.0, ${pageUrl}`,
      credit_fields: slide?.credit ? [slide.credit] : [],
      evidence: { url: pageUrl, captured_text: capturedText, captured_at: capturedAt },
      date: day ?? null,
      // The page states only its day: recorded as that day's last UTC second, the latest it can mean, so a
      // "published by" check can only be stricter for it.
      published_at: day ? `${day}T23:59:59Z` : null,
      categories: [],
      keywords: [],
      own_work: false,
      uploader: null,
      released_by: RELEASED_BY,
      party_label: partyLabel(RELEASED_BY),
      ...(rk ? { record_kind: rk.kind, record_kind_note: rk.evidence } : {}),
      ai_fields_checked: ["title", "description", "slide-caption"],
    },
  };
}

/** The official transcript record the page holds (bible v2 section e): the Kremlin's own text, for sot-verbatim. */
export function pageTranscript(html, { pageUrl, id, itemId, capturedAt }) {
  if (!PAGE.test(String(pageUrl))) return null;
  const text = transcriptText(html);
  if (!text) return null;
  const lang = pageLang(html, pageUrl);
  return {
    id,
    source: "official",
    item_id: itemId,
    lang,
    ...(lang === "en" ? { translated_from: "ru" } : {}),
    url: pageUrl,
    publisher: PUBLISHER,
    text,
    text_sha256: textSha(text),
    captured_at: capturedAt,
  };
}

export async function lookup(ref, { http, now = () => new Date(), kind = "footage", candidate = {} }) {
  if (!PAGE.test(String(ref))) return { status: "not_found", reason: `${clip(ref, 120)} is not a kremlin.ru event page` };
  const page = await http.getText(ref);
  if (page.status !== "ok") return { status: "not_found" };
  const terms = await http.getText(TERMS_URL);
  return parseKremlinPage(page.text, { pageUrl: ref, termsHtml: terms.status === "ok" ? terms.text : null, kind, media: candidate.media ?? null, capturedAt: isoSecond(now().toISOString()) });
}

