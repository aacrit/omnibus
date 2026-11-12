// DVIDS (Defense Visual Information Distribution Service) API. Optional: it
// needs an API key, read from the DVIDS_API_KEY environment variable only.
// Without one the adapter skips cleanly and says so; nothing fails. The key
// is never written to the ledger, the evidence or an error message. Net-new.
//
// DVIDS items are usually US military works, but the bible asks for the
// per-item mark to be checked: an item passes only when its own record says
// public domain. A record that says nothing either way fails, and the
// fetcher moves on to the next candidate.
//
// Unverified against the live API in this ticket (no key was available):
// the field names read here (results.title, description, date, date_published,
// credit[].name, unit_name, keywords, image, url, and a public-domain mark in
// license, copyright or restrictions) come from the API's documented asset
// shape and are checked against a hand-built fixture, not a recording.

import { clip, firstDate, isoSecond, plain } from "../text.mjs";

const API = "https://api.dvidshub.net";

/** "image:123456" or "video:123456". */
export function parseRef(ref) {
  const m = String(ref ?? "").match(/^(image|video|audio):(\d{1,12})$/);
  return m ? { type: m[1], n: m[2] } : null;
}

export function assetUrl(ref, key) {
  return `${API}/asset?${new URLSearchParams({ id: String(ref), api_key: String(key) })}`;
}

export function redact(text, key) {
  return key ? String(text).split(key).join("[DVIDS_API_KEY]") : String(text);
}

const PD_MARK = /\bpublic domain\b/i;

/** Pure: the candidate a DVIDS asset response describes. */
export function parseDvids(json, { ref, capturedAt }) {
  const r = json?.results;
  const parsed = parseRef(ref);
  if (!r || !parsed) return { status: "not_found" };
  const marks = [r.license, r.copyright, r.restrictions].filter((x) => typeof x === "string" && x.trim()).map(plain);
  const pd = marks.some((m) => PD_MARK.test(m)) && !marks.some((m) => /\b(restricted|copyright(ed)? by|all rights reserved)\b/i.test(m));
  const credits = (Array.isArray(r.credit) ? r.credit : []).map((c) => plain([c.rank, c.name].filter(Boolean).join(" "))).filter(Boolean);
  const unit = plain(r.unit_name) || null;
  const page = `https://www.dvidshub.net/${parsed.type}/${parsed.n}`;
  const capturedText = [
    `Read from the DVIDS API asset record for ${parsed.type} ${parsed.n}.`,
    `license: ${plain(r.license) || "(none)"}`,
    `copyright: ${plain(r.copyright) || "(none)"}`,
    `restrictions: ${plain(r.restrictions) || "(none)"}`,
    `credit: ${credits.join("; ") || "(none)"}`,
    `unit: ${unit ?? "(none)"}`,
  ].join("\n");
  const media = typeof r.image === "string" ? r.image : (r.image?.url ?? r.files?.[0]?.src ?? null);
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
      licence_raw: marks.join("; ") || null,
      licence: pd ? "pd-us-federal" : null,
      licence_note: pd ? null : "the DVIDS record carries no public-domain mark",
      basis: pd ? `DVIDS record marks the item public domain ("${clip(marks.find((m) => PD_MARK.test(m)), 200)}"): a US military work (17 U.S.C. 105)` : null,
      credit: [credits.join(", "), unit, "DVIDS"].filter(Boolean).join(", "),
      evidence: { url: page, captured_text: capturedText, captured_at: capturedAt },
      date: firstDate(r.date),
      published_at: isoSecond(r.date_published),
      categories: [],
      keywords: (Array.isArray(r.keywords) ? r.keywords : String(r.keywords ?? "").split(",")).map((k) => String(k).trim()).filter(Boolean),
      own_work: false,
      uploader: null,
      ai_fields_checked: ["keywords", "title", "description", "license"],
    },
  };
}

export async function lookup(ref, { http, env = process.env, now = () => new Date() }) {
  const key = env.DVIDS_API_KEY;
  if (!key) return { status: "skipped", reason: "DVIDS needs an API key (DVIDS_API_KEY is not set); skipped" };
  if (!parseRef(ref)) return { status: "not_found" };
  try {
    const r = await http.getJson(assetUrl(ref, key));
    if (r.status !== "ok") return { status: "not_found" };
    return parseDvids(r.json, { ref, capturedAt: isoSecond(now().toISOString()) });
  } catch (err) {
    throw new Error(redact(err.message, key));
  }
}
