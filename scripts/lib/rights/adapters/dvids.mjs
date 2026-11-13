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

import { clip, firstDate, isoSecond, plain } from "../text.mjs";

const API = "https://api.dvidshub.net";
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
/** Another force, an alliance or a news agency named as the author or unit. */
const THIRD_PARTY = /\b(?:NATO|Natochannel|Allied Command|Royal (?:Navy|Air Force|Marines|Australian|Canadian|Netherlands|Danish|Norwegian)|British Army|Bundeswehr|Canadian Armed Forces|Australian Defence|Self-Defense Force|JGSDF|JMSDF|JASDF|Republic of Korea|ROK (?:Army|Navy|Air Force|Marine)|Ministry of Defen[cs]e|Armed Forces of|Associated Press|AP Photo|Reuters|Getty|AFP|Agence France|EPA|Xinhua)\b/i;
const OTHER_STATUS = /\bcourtesy\b|©|\bcopyright(ed)?\b|\ball rights reserved\b|\bused with permission\b|\b(provided|submitted) by\b|\bphoto(graph)? by [^.]*\b(for|of) (the )?[A-Z]/i;
/** A record field that would carry another status: any non-empty one refuses the item, whatever it says. */
const STATUS_FIELD = /copyright|restrict|licen[cs]e|^rights$|usage_rights/i;

function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return plain(String(v)) !== "";
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
  for (const [k, v] of Object.entries(r)) if (STATUS_FIELD.test(k) && nonEmpty(v)) reasons.push(`the record has a ${k} field ("${clip(plain(typeof v === "string" ? v : JSON.stringify(v)), 80)}")`);
  if (!creditList.length) reasons.push(creditText ? `credit "${clip(creditText, 120)}" names no DoD author` : "no credit is named");
  const marks = [r.title, r.description, creditText, ...creditList].map(plain).filter((t) => OTHER_STATUS.test(t));
  if (marks.length) reasons.push(`the record indicates another copyright status or a third party: "${clip(marks[0], 160)}"`);
  // The author is someone outside the US military: another force, an alliance, a news agency.
  const outside = [unit, creditText, ...credits.map((c) => c.name), attribution].filter((t) => t && THIRD_PARTY.test(t));
  if (outside.length) reasons.push(`the record names a third party as author or unit: "${clip(outside[0], 160)}"`);
  // A closing "(... photo by ...)" line must name a US body or a US-only rank.
  if (attribution && !outside.length && !US_UNIT.test(attribution) && !US_ONLY_RANK.test(attribution)) reasons.push(`the description's attribution "${clip(attribution, 160)}" names no US body`);
  const pd = reasons.length === 0;
  const page = `https://www.dvidshub.net/${parsed.type}/${parsed.n}`;
  const capturedText = [
    `Read from the DVIDS API asset record for ${parsed.type} ${parsed.n}.`,
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
      mime: null,
      bytes_expected: null,
      sha1: null,
      licence_raw: pd ? "public domain (DVIDS statement; no other status indicated)" : `DVIDS record: ${reasons.join("; ")}`,
      licence: pd ? "pd-us-federal" : null,
      licence_note: pd ? null : reasons.join("; "),
      basis: pd ? `DVIDS states its media is public domain unless another copyright status is indicated, and this record indicates none: a US federal government work by ${creditList.join(", ")} (${branch}) (17 U.S.C. 105)` : null,
      credit: [creditList.join(", "), unit, "DVIDS"].filter(Boolean).join(", "),
      credit_fields: [creditText].filter(Boolean),
      evidence: { url: page, captured_text: capturedText, captured_at: capturedAt },
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

export async function lookup(ref, { http, env = process.env, now = () => new Date() }) {
  const key = env.DVIDS_API_KEY;
  if (!key) return { status: "skipped", reason: "DVIDS needs an API key (DVIDS_API_KEY is not set); skipped" };
  if (!parseRef(ref)) return { status: "not_found", reason: `"${clip(ref, 120)}" is not a DVIDS asset id (the resolver searches when the key is set)` };
  try {
    const r = await http.getJson(assetUrl(ref, key));
    if (r.status !== "ok") return { status: "not_found" };
    return parseDvids(r.json, { ref, capturedAt: isoSecond(now().toISOString()) });
  } catch (err) {
    throw new Error(redact(err.message, key));
  }
}
