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
// credit, and no courtesy, copyright or third-party mark. The fixtures in the
// tests are built from the documented examples, not recordings: no key was
// available for E5b.

import { clip, firstDate, isoSecond, plain } from "../text.mjs";

const API = "https://api.dvidshub.net";
export const COPYRIGHT_PAGE = "https://api.dvidshub.net/docs/copyright";
export const DVIDS_STATEMENT = "All media on the site is produced by U.S. DoD or Federal Agency and is in the public domain unless other copyright status is indicated.";
/** DoD branches as DVIDS names them; "Civilian" is not a DoD branch and is refused. */
export const DOD_BRANCHES = ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Joint", "Space Force"];
const OTHER_STATUS = /\bcourtesy\b|©|\bcopyright(ed)?\b|\ball rights reserved\b|\bused with permission\b|\b(provided|submitted) by\b|\bphoto(graph)? by [^.]*\b(for|of) (the )?[A-Z]/i;

/** "image:123456" or "video:123456". */
export function parseRef(ref) {
  const m = String(ref ?? "").match(/^(image|video|audio):(\d{1,12})$/);
  return m ? { type: m[1], n: m[2] } : null;
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

/** Pure: the asset ids a search response lists, published no later than the window's end. */
export function searchHits(json, window) {
  const end = window?.to ? Date.parse(/T/.test(window.to) ? window.to : `${window.to}T23:59:59Z`) : Infinity;
  return (json?.results ?? []).filter((r) => parseRef(r.id) && Date.parse(r.date_published ?? r.publishdate ?? "") <= end).map((r) => r.id);
}

export function redact(text, key) {
  return key ? String(text).split(key).join("[DVIDS_API_KEY]") : String(text);
}

/** Pure: the candidate a DVIDS asset response describes. */
export function parseDvids(json, { ref, capturedAt }) {
  const r = json?.results;
  const parsed = parseRef(ref);
  if (!r || !parsed) return { status: "not_found" };
  const creditList = Array.isArray(r.credit) ? r.credit.map((c) => plain([c.rank, c.name].filter(Boolean).join(" "))).filter(Boolean) : [];
  const creditText = Array.isArray(r.credit) ? "" : plain(r.credit);
  const branch = plain(r.branch) || null;
  const unit = plain(r.unit_name) || null;
  const reasons = [];
  if (!DOD_BRANCHES.includes(branch)) reasons.push(`branch "${branch ?? "(none)"}" is not a DoD branch`);
  if (!creditList.length) reasons.push(creditText ? `credit "${clip(creditText, 120)}" names no DoD author` : "no credit is named");
  const marks = [r.title, r.description, creditText, ...creditList].map(plain).filter((t) => OTHER_STATUS.test(t));
  if (marks.length) reasons.push(`the record indicates another copyright status or a third party: "${clip(marks[0], 160)}"`);
  const pd = reasons.length === 0;
  const page = `https://www.dvidshub.net/${parsed.type}/${parsed.n}`;
  const capturedText = [
    `Read from the DVIDS API asset record for ${parsed.type} ${parsed.n}.`,
    `DVIDS's statement (${COPYRIGHT_PAGE}): "${DVIDS_STATEMENT}"`,
    `branch: ${branch ?? "(none)"}; unit: ${unit ?? "(none)"}`,
    `credit: ${creditList.join("; ") || creditText || "(none)"}`,
    `date: ${r.date ?? "(none)"}; date_published: ${r.date_published ?? "(none)"}`,
    pd ? "The record indicates no other copyright status: public domain, a US DoD work (17 U.S.C. 105)." : `Refused: ${reasons.join("; ")}.`,
  ].join("\n");
  const files = Array.isArray(r.files) ? r.files.filter((f) => /mp4/.test(String(f.type ?? f.src))) : [];
  const video = files.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]?.src ?? null;
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
      basis: pd ? `DVIDS states its media is public domain unless another copyright status is indicated, and this record indicates none: a US DoD work by ${creditList.join(", ")} (${branch}) (17 U.S.C. 105)` : null,
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
