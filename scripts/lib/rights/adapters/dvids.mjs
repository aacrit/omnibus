// DVIDS (Defense Visual Information Distribution Service) API. Optional: it
// needs an API key, read from the DVIDS_API_KEY environment variable only.
// Without one the adapter skips cleanly and says so; nothing fails. The key
// is never written to the ledger, the evidence or an error message. Net-new.
//
// Field names follow DVIDS's own documentation (api.dvidshub.net/docs/asset_api
// and /docs/search_api, read 2026-11-12): an asset has title, description,
// date, date_published, branch, unit_name, credit (an array, or "Courtesy"
// text when DVIDS does not know the author), keywords, image (stills) and
// files[] (video mp4s). There is no per-item licence field. DVIDS states
// (api.dvidshub.net/docs/copyright) that all its media is produced by the
// US DoD or a federal agency and is public domain unless another copyright
// status is indicated; so an item passes as pd-us-federal on that statement
// only when its own record indicates nothing else: a DoD branch, a named
// credit, and no courtesy, copyright or third-party mark.
//
// E5c checked these against the live API (2026-11-12, recordings in
// tests/fixtures/rights/dvids-*.json): an asset's credit is an array of
// { id, name, rank, url }, or the bare string "Courtesy" when DVIDS names no
// author; dates carry the publisher's offset (-05:00); a video lists mp4s
// from 144p to a 2160p master on d34w7g4gy10iej.cloudfront.net, and a still's
// file is on the same host; hls_url and closed_caption_urls embed the API key,
// so they are never read or kept. Search has no OR operator: terms and quoted
// phrases are all required, so a step's alternatives are searched one by one.
//
// The licence is read where a claimant can read it (E5c review): the item's
// public page on www.dvidshub.net, fetched without a key. Its "PUBLIC DOMAIN"
// mark, credit line, unit, VIRIN and "must comply with the restrictions shown
// on https://www.dvidshub.net/about/copyright" line are quoted as the
// evidence, and the API record read is kept as a second evidence entry at its
// address with the key removed. An item whose page cannot be read, or does not
// say so, or disagrees with the API record, is refused.

import { clip, firstDate, isoSecond, plain } from "../text.mjs";

const API = "https://api.dvidshub.net";
const SITE = "https://www.dvidshub.net";
export const RESTRICTIONS_PAGE = "https://www.dvidshub.net/about/copyright";
/** The disclosure the credits carry whenever a DVIDS item airs (CoS, under the founder's delegation, 2026-11-13). */
export const DOW_DISCLOSURE = "The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.";
export const COPYRIGHT_PAGE = "https://api.dvidshub.net/docs/copyright";
export const DVIDS_STATEMENT = "All media on the site is produced by U.S. DoD or Federal Agency and is in the public domain unless other copyright status is indicated.";
/** US armed-service branches as DVIDS names them (DoD, and the Coast Guard under DHS); "Civilian" is refused. */
export const DOD_BRANCHES = ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Joint", "Space Force"];
/**
 * Rank forms only the US services use (E5b review). "Joint" names no service,
 * so a Joint item needs a credit with one of these, or a US unit. Forms other
 * forces share are left out: Sgt, Staff Sgt and SSgt (the British Army writes
 * SSgt), Capt, Lt, Maj, Col, bare Petty Officer and Leading or Able Seaman
 * (the Royal Navy's).
 */
export const US_ONLY_RANK = /\b(?:Spc|Specialist|PFC|Pfc|Private First Class|TSgt|Tech\.? Sgt|Technical Sergeant|MSgt|Master Sgt|Master Sergeant|SMSgt|Senior Master Sgt|CMSgt|Chief Master Sgt|SFC|Sgt\.? 1st Class|Sergeant First Class|GySgt|Gunnery Sgt|Gunnery Sergeant|Petty Officer (?:1st|2nd|3rd|First|Second|Third) Class|PO[123]|(?<!(?:Leading|Able|Ordinary) )Seaman|Senior Airman|SrA|Airman(?: 1st Class| First Class)?|A1C|Amn)\b/;
/** A unit DVIDS lists that is plainly a US body. */
export const US_UNIT = /(?:^|[^A-Za-z])(?:U\.\s?S\.|US|USA|United States|USCENTCOM|USEUCOM|USINDOPACOM|USNORTHCOM|USSOUTHCOM|USAFRICOM|USSOCOM|USTRANSCOM|USSPACECOM|USCYBERCOM|USSTRATCOM|DoD|DoW|Pentagon|Joint Chiefs of Staff|Defense Media Activity|(?:Department|Secretary|Office of the Secretary) of (?:War|Defense|the Army|the Navy|the Air Force))(?![A-Za-z])/;
/**
 * Another force, an alliance, a news agency, a broadcaster or the press pool
 * named as the author or unit: a network's camera or a pool feed is not a
 * federal work, even under a DoD unit. Bare "Fox" also refuses a service
 * member surnamed Fox, a refusal on the safe side.
 */
const THIRD_PARTY = /\b(?:NATO|Natochannel|Allied Command|Royal (?:Navy|Air Force|Marines|Australian|Canadian|Netherlands|Danish|Norwegian)|British Army|Bundeswehr|Canadian Armed Forces|Australian Defence|Self-Defense Force|JGSDF|JMSDF|JASDF|Republic of Korea|ROK (?:Army|Navy|Air Force|Marine)|Ministry of Defen[cs]e|Armed Forces of|Associated Press|AP Photo|Reuters|Getty|AFP|Agence France|EPA|Xinhua|CNN|Fox|NBC|ABC|CBS|C-SPAN|pool)\b/i;
const OTHER_STATUS = /\bcourtesy\b|©|\bcopyright(ed)?\b|\ball rights reserved\b|\bused with permission\b|\b(provided|submitted) by\b|\bphoto(graph)? by [^.]*\b(for|of) (the )?[A-Z]/i;
/** A record field that would carry another status: any non-empty one refuses the item, whatever it says. */
const STATUS_FIELD = /copyright|restrict|licen[cs]e|^rights$|usage_rights/i;

function nonEmpty(v) {
  // A boolean false ("restricted": false) states that no restriction applies; true is a status.
  if (v == null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return plain(String(v)) !== "";
}

/**
 * Every field at any depth (files[0].license, credit[1].copyright) whose name
 * speaks of another status and whose value is not empty, as [path, value].
 */
export function statusFields(record, at = "", depth = 0) {
  const out = [];
  if (!record || typeof record !== "object" || depth > 5) return out;
  const list = Array.isArray(record);
  for (const [k, v] of Object.entries(record)) {
    const p = list ? `${at}[${k}]` : at ? `${at}.${k}` : k;
    if (!list && STATUS_FIELD.test(k) && nonEmpty(v)) out.push([p, v]);
    else if (v && typeof v === "object") out.push(...statusFields(v, p, depth + 1));
  }
  return out;
}

/** The description's closing attribution, "(DoW video by U.S. Army Staff Sgt. Daniel Proper)", or null. */
export function attributionOf(description) {
  const m = plain(description).match(/\(([^()]*\b(?:photos?|videos?|footage|graphics?|illustrations?|images?)\b[^()]*)\)\s*$/i);
  return m ? m[1] : null;
}

/** "image:123456" or "video:123456". */
export function parseRef(ref) {
  const m = String(ref ?? "").match(/^(image|video|audio):(\d{1,12})$/);
  return m ? { type: m[1], n: m[2] } : null;
}

/**
 * A step's query as DVIDS can run it: DVIDS has no OR, so `"U.S. Central
 * Command" OR CENTCOM task force` is two searches. Quoted phrases stay whole.
 */
export function queryAlternatives(q) {
  const out = [];
  let cur = [];
  for (const t of String(q ?? "").match(/"[^"]*"|\S+/g) ?? []) {
    if (t === "OR") {
      if (cur.length) out.push(cur.join(" "));
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

export function assetUrl(ref, key) {
  return `${API}/asset?${new URLSearchParams({ id: String(ref), api_key: String(key) })}`;
}

/** A DVIDS search for a rundown step ("q=Hegseth; type=image OR video") inside its window: published by the window's end. */
export function searchUrl(params, window, key) {
  const p = new URLSearchParams({ q: params.q ?? "", max_results: "50", sort: "date_published", sortdir: "desc", api_key: String(key) });
  for (const t of String(params.type ?? "image").split(/\s+OR\s+/i).map((s) => s.trim()).filter(Boolean)) p.append("type[]", t);
  if (window?.from) p.set("from_date", /T/.test(window.from) ? window.from : `${window.from}T00:00:00Z`);
  if (window?.to) p.set("to_publishdate", /T/.test(window.to) ? isoSecond(window.to) : `${window.to}T23:59:59Z`);
  return `${API}/search?${p}`;
}

/** Pure: the hits a search response lists, published no later than the window's end, as { id, published } (ms). */
export function searchResults(json, window) {
  const end = window?.to ? Date.parse(/T/.test(window.to) ? window.to : `${window.to}T23:59:59Z`) : Infinity;
  return (json?.results ?? [])
    .map((r) => ({ id: r.id, published: Date.parse(r.date_published ?? r.publishdate ?? "") }))
    .filter((r) => parseRef(r.id) && r.published <= end);
}

/** Pure: the asset ids a search response lists, published no later than the window's end. */
export function searchHits(json, window) {
  return searchResults(json, window).map((r) => r.id);
}

export function redact(text, key) {
  return key ? String(text).split(key).join("[DVIDS_API_KEY]") : String(text);
}

/** Pure: the candidate a DVIDS asset response describes. */
export function parseDvids(json, { ref, capturedAt }) {
  const r = json?.results;
  const parsed = parseRef(ref);
  if (!r || !parsed) return { status: "not_found" };
  const credits = Array.isArray(r.credit) ? r.credit.map((c) => ({ rank: plain(c?.rank ?? ""), name: plain(c?.name ?? "") })) : [];
  const creditList = credits.map((c) => [c.rank, c.name].filter(Boolean).join(" ")).filter(Boolean);
  const creditText = Array.isArray(r.credit) ? "" : plain(r.credit);
  const branch = plain(r.branch) || null;
  const unit = plain(r.unit_name) || null;
  const attribution = attributionOf(r.description);
  const reasons = [];
  if (!DOD_BRANCHES.includes(branch)) reasons.push(`branch "${branch ?? "(none)"}" is not a US armed service`);
  // "Joint" names no service: a credit must carry a rank form only the US uses, or the unit must be a US body.
  if (branch === "Joint" && !credits.some((c) => US_ONLY_RANK.test(c.rank)) && !US_UNIT.test(unit ?? "")) {
    reasons.push(`branch Joint, unit "${clip(unit ?? "(none)", 120)}" is not plainly a US body, and no credit carries a US-only rank`);
  }
  // DVIDS documents no licence field; a non-empty one is another status, whatever it says.
  for (const [k, v] of statusFields(r)) reasons.push(`the record has a ${k} field ("${clip(plain(typeof v === "string" ? v : JSON.stringify(v)), 80)}")`);
  if (!creditList.length) reasons.push(creditText ? `credit "${clip(creditText, 120)}" names no DoD author` : "no credit is named");
  const marks = [r.title, r.description, creditText, ...creditList].map(plain).filter((t) => OTHER_STATUS.test(t));
  if (marks.length) reasons.push(`the record indicates another copyright status or a third party: "${clip(marks[0], 160)}"`);
  // The author is someone outside the US military: another force, an alliance, a news agency.
  const outside = [unit, creditText, ...credits.map((c) => c.name), attribution].filter((t) => t && THIRD_PARTY.test(t));
  if (outside.length) reasons.push(`the record names a third party as author or unit: "${clip(outside[0], 160)}"`);
  // A closing "(... photo by ...)" line must name a US body or a US-only rank.
  if (attribution && !outside.length && !US_UNIT.test(attribution) && !US_ONLY_RANK.test(attribution)) reasons.push(`the description's attribution "${clip(attribution, 160)}" names no US body`);
  const pd = reasons.length === 0;
  const page = publicPageUrl(ref);
  const capturedText = [
    `Read from the DVIDS API asset record for ${parsed.type} ${parsed.n} (${apiReadUrl(ref)}, the key removed).`,
    `DVIDS's statement (${COPYRIGHT_PAGE}): "${DVIDS_STATEMENT}"`,
    `branch: ${branch ?? "(none)"}; unit: ${unit ?? "(none)"}`,
    `credit: ${creditList.join("; ") || creditText || "(none)"}`,
    `attribution: ${attribution ?? "(none)"}`,
    `VIRIN ${plain(r.virin) || "(none)"}; category: ${plain(r.category) || "(none)"}`,
    `date: ${plain(r.date) || "(none)"}; date_published: ${plain(r.date_published) || "(none)"}`,
    pd ? "The record indicates no other copyright status: public domain, a US federal government work (17 U.S.C. 105)." : `Refused: ${reasons.join("; ")}.`,
  ].join("\n");
  // The 1080p file, the films' target; the 2160p master only when nothing at or under 1080p exists (D: budget).
  const files = Array.isArray(r.files) ? r.files.filter((f) => /mp4/.test(String(f.type ?? f.src))) : [];
  const bySize = (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.size ?? 0) - (a.size ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0);
  const atMost = files.filter((f) => (f.height ?? 0) <= 1080).sort(bySize);
  const video = (atMost[0] ?? [...files].sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0])?.src ?? null;
  const media = parsed.type === "video" ? video : typeof r.image === "string" ? r.image : null;
  // The capture's proxy (scripts/capture/proxy.mjs): the largest mp4 at or under 480 px, never used by the fetcher.
  const small = files.filter((f) => Number(f.height) > 0 && f.height <= 480).sort(bySize)[0]?.src ?? null;
  const proxy = parsed.type === "video" ? small : parsed.type === "image" && typeof r.image === "string" ? r.image : null;
  return {
    status: "ok",
    candidate: {
      adapter: "dvids",
      ref: String(ref),
      kind_hint: { image: "still", video: "footage", audio: "sound" }[parsed.type],
      title: clip(plain(r.title), 400) || String(ref),
      description: clip(plain(r.description), 1000),
      item_url: page,
      media_url: media ? String(media).replace(/^http:\/\//, "https://") : null,
      proxy_url: proxy ? String(proxy).replace(/^http:\/\//, "https://") : null,
      mime: null,
      bytes_expected: null,
      sha1: null,
      licence_raw: pd ? "public domain (DVIDS statement; no other status indicated)" : `DVIDS record: ${reasons.join("; ")}`,
      licence: pd ? "pd-us-federal" : null,
      licence_note: pd ? null : reasons.join("; "),
      basis: pd ? `DVIDS states its media is public domain unless another copyright status is indicated, and this record indicates none: a US federal government work by ${creditList.join(", ")} (${branch}) (17 U.S.C. 105)` : null,
      credit: [creditList.join(", "), unit, "DVIDS"].filter(Boolean).join(", "),
      credit_fields: [creditText].filter(Boolean),
      // No licence evidence until the public page is read (withPublicPage): the fetcher refuses a candidate without it.
      evidence: null,
      api_evidence: { url: apiReadUrl(ref), captured_text: capturedText, captured_at: capturedAt },
      dvids: { virin: plain(r.virin) || null, unit, names: credits.map((c) => c.name).filter(Boolean), branch, credits: creditList },
      date: firstDate(r.date),
      published_at: isoSecond(r.date_published),
      categories: [],
      keywords: (Array.isArray(r.keywords) ? r.keywords : String(r.keywords ?? "").split(",")).map((k) => String(k).trim()).filter(Boolean),
      own_work: false,
      uploader: null,
      ai_fields_checked: ["keywords", "title", "description", "credit"],
    },
  };
}

/** The item's public page, which anyone can read without a key. */
export function publicPageUrl(ref) {
  const p = parseRef(ref);
  return p ? `${SITE}/${p.type}/${p.n}` : null;
}

/** The API asset address the record was read from, without the key. */
export function apiReadUrl(ref) {
  return parseRef(ref) ? `${API}/asset?id=${ref}` : null;
}

const firstMatch = (html, re) => html.match(re)?.[1] ?? null;
const BYLINE = /^(?:courtesy\s+)?(?:video|photo|image|audio|graphic|illustration|footage|podcast|news|story)s?\b.*\bby\b|^courtesy\b/i;
const COMPLY = /^This work, .+, by .+, identified by DVIDS, must comply with the restrictions shown on https:\/\/www\.dvidshub\.net\/about\/copyright\.?$/;

/**
 * Pure: what an item's public page states, as plain text: the title, its
 * "PUBLIC DOMAIN" mark, the credit line ("Video by Staff Sgt. Daniel
 * Proper"), the unit, the VIRIN and the restrictions line. A field the page
 * lacks is null.
 */
export function parsePublicPage(html) {
  const h = String(html ?? "");
  const h4s = [...h.matchAll(/<h4\b[^>]*class="[^"]*\bpublic-domain\b[^"]*"[^>]*>([\s\S]*?)<\/h4>/gi)].map((m) => plain(m[1]));
  const h3s = [...h.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gi)].map((m) => ({ attrs: m[1], text: plain(m[2]) }));
  const unitH3 = h3s.find((x) => /class="[^"]*\bthe_unit\b/.test(x.attrs));
  const unitRaw = firstMatch(h, /<h3\b[^>]*class="[^"]*\bthe_unit\b[^"]*"[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const title = firstMatch(h, /<title>\s*DVIDS - [A-Za-z]+ - ([\s\S]*?)<\/title>/i);
  return {
    title: title ? plain(title) : null,
    public_domain: h4s.some((t) => /^PUBLIC DOMAIN$/.test(t)) ? "PUBLIC DOMAIN" : null,
    byline: h3s.find((x) => x !== unitH3 && BYLINE.test(x.text))?.text ?? null,
    unit: unitRaw ? plain(unitRaw) : null,
    virin: plain(firstMatch(h, /<td>\s*VIRIN:\s*<\/td>\s*<td>([\s\S]*?)<\/td>/i) ?? "") || null,
    restrictions: plain(firstMatch(h, /<p\b[^>]*class="[^"]*\bcopyright_info\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ?? "") || null,
  };
}

/**
 * Pure: the candidate parseDvids judged from the API record, with the public
 * page as its licence evidence and the API read as a second evidence entry.
 * The page must mark the item PUBLIC DOMAIN, carry DVIDS's restrictions line,
 * and agree with the record on its VIRIN, unit and credited names; its credit
 * line and unit are held to the same third-party and courtesy rules. Any
 * failure refuses the item. `page` is parsePublicPage's result, or null with
 * `unread` saying why it could not be read.
 */
export function withPublicPage(candidate, page, { capturedAt, unread = null }) {
  const c = { ...candidate };
  const d = c.dvids ?? {};
  const url = c.item_url;
  const reasons = [];
  if (!page) reasons.push(`the public item page ${url} could not be read${unread ? ` (${clip(unread, 200)})` : ""}, so no licence evidence names the source`);
  else {
    if (!page.public_domain) reasons.push(`the public page ${url} does not mark the item PUBLIC DOMAIN`);
    if (!page.restrictions || !COMPLY.test(page.restrictions)) reasons.push(`the public page carries no "must comply with the restrictions shown on ${RESTRICTIONS_PAGE}" line`);
    if (!page.virin || !d.virin || page.virin !== d.virin) reasons.push(`the page's VIRIN "${clip(page.virin ?? "(none)", 60)}" differs from the API record's "${clip(d.virin ?? "(none)", 60)}"`);
    if (!page.unit || page.unit !== d.unit) reasons.push(`the page's unit "${clip(page.unit ?? "(none)", 120)}" differs from the API record's "${clip(d.unit ?? "(none)", 120)}"`);
    if (!page.byline) reasons.push("the public page names no credit line");
    else {
      const missing = (d.names ?? []).filter((n) => !page.byline.includes(n));
      if (missing.length) reasons.push(`the page's credit line "${clip(page.byline, 160)}" does not name ${missing.join(", ")}`);
      if (OTHER_STATUS.test(page.byline) || THIRD_PARTY.test(page.byline)) reasons.push(`the page's credit line "${clip(page.byline, 160)}" indicates another status or a third party`);
    }
    if (page.unit && THIRD_PARTY.test(page.unit)) reasons.push(`the page names a third party as the unit: "${clip(page.unit, 160)}"`);
  }
  const pd = c.licence === "pd-us-federal" && reasons.length === 0;
  const all = [...(c.licence_note ? [c.licence_note] : []), ...reasons];
  const q = (v) => (v ? `"${v}"` : "(none)");
  const text = page
    ? [
        `Read from the public DVIDS item page ${url}, fetched without a key.`,
        `The page's mark: ${q(page.public_domain)}`,
        `credit line: ${q(page.byline)}`,
        `unit: ${q(page.unit)}`,
        `VIRIN: ${q(page.virin)}`,
        `The page's restrictions line: ${q(page.restrictions)}`,
        pd
          ? "The page and the API record (the second evidence entry) indicate no other copyright status: public domain, a US federal government work (17 U.S.C. 105)."
          : `Refused: ${all.join("; ")}.`,
      ].join("\n")
    : null;
  delete c.dvids;
  delete c.api_evidence;
  return {
    ...c,
    licence: pd ? "pd-us-federal" : null,
    licence_raw: pd ? `PUBLIC DOMAIN (the public page ${url}; no other status indicated)` : `DVIDS: ${all.join("; ")}`,
    licence_note: pd ? null : all.join("; "),
    basis: pd
      ? `the public DVIDS page marks it PUBLIC DOMAIN, and DVIDS states its media is public domain unless another copyright status is indicated; neither the page nor the API record indicates one: a US federal government work by ${(d.credits ?? []).join(", ")} (${d.branch}) (17 U.S.C. 105)`
      : null,
    evidence: text ? { url, captured_text: text, captured_at: capturedAt } : null,
    evidence_also: [candidate.api_evidence].filter(Boolean),
    disclosure: DOW_DISCLOSURE,
  };
}

export async function lookup(ref, { http, env = process.env, now = () => new Date() }) {
  const key = env.DVIDS_API_KEY;
  if (!key) return { status: "skipped", reason: "DVIDS needs an API key (DVIDS_API_KEY is not set); skipped" };
  if (!parseRef(ref)) return { status: "not_found", reason: `"${clip(ref, 120)}" is not a DVIDS asset id (the resolver searches when the key is set)` };
  const capturedAt = isoSecond(now().toISOString());
  let found;
  try {
    const r = await http.getJson(assetUrl(ref, key));
    if (r.status !== "ok") return { status: "not_found" };
    found = parseDvids(r.json, { ref, capturedAt });
  } catch (err) {
    throw new Error(redact(err.message, key));
  }
  if (found.status !== "ok") return found;
  // The public page, without the key: the licence a claimant can read.
  let page = null;
  let unread = null;
  try {
    const p = await http.getText(publicPageUrl(ref));
    if (p.status === "ok") page = parsePublicPage(p.text);
    else unread = "not found";
  } catch (err) {
    unread = redact(err.message, key);
  }
  return { status: "ok", candidate: withPublicPage(found.candidate, page, { capturedAt, unread }) };
}
