// NASA Image and Video Library (images-api.nasa.gov): the search record for
// one nasa_id (title, centre, date, photographer, secondary creator,
// keywords, description) and its asset manifest (the original file). Net-new.
//
// NASA material is generally not under copyright as a US federal work, but
// the library also holds partner and third-party items. So an item passes as
// pd-us-federal only when no field credits anyone outside NASA; otherwise it
// fails with the field that named them.

import { clip, firstDate, isoSecond, plain } from "../text.mjs";

const API = "https://images-api.nasa.gov";

export function searchUrl(nasaId) {
  return `${API}/search?${new URLSearchParams({ nasa_id: String(nasaId) })}`;
}

export function assetUrl(nasaId) {
  return `${API}/asset/${encodeURIComponent(String(nasaId))}`;
}

// A credit to anyone but NASA (partner agencies, agencies, "courtesy of", a copyright notice).
const THIRD_PARTY_ACRONYM = /\b(ESA|JAXA|CSA|ISRO|CNES|DLR|AP|AFP)\b/;
const THIRD_PARTY_WORDS = /\b(Roscosmos|Associated Press|Reuters|Getty|courtesy of|copyright)\b|©|\(c\)/i;
const THIRD_PARTY = { test: (s) => THIRD_PARTY_ACRONYM.test(s) || THIRD_PARTY_WORDS.test(s) };

const KIND = { image: "still", video: "footage", audio: "sound" };

/** The original (or largest) file in an asset manifest, upgraded to https. */
export function pickOriginal(manifest, mediaType) {
  const hrefs = (manifest?.collection?.items ?? []).map((i) => String(i.href ?? "")).filter(Boolean);
  const media = hrefs.filter((h) => !/\.(json|srt|vtt|txt)$/i.test(h));
  const order = mediaType === "video" ? ["~orig.", "~large.", "~medium."] : ["~orig.", "~large.", "~medium."];
  for (const tag of order) {
    const h = media.find((x) => x.includes(tag));
    if (h) return h.replace(/^http:\/\//, "https://");
  }
  return media[0]?.replace(/^http:\/\//, "https://") ?? null;
}

/** Pure: the candidate a recorded search response and asset manifest describe. */
export function parseNasa(search, manifest, { ref, capturedAt }) {
  const item = search?.collection?.items?.[0];
  const d = item?.data?.[0];
  if (!d || String(d.nasa_id).toLowerCase() !== String(ref).toLowerCase()) return { status: "not_found" };
  const photographer = plain(d.photographer) || null;
  const secondary = plain(d.secondary_creator) || null;
  const description = plain(d.description_508 || d.description);
  const named = [
    ["photographer", photographer],
    ["secondary_creator", secondary],
    ["description", description],
  ].filter(([, v]) => v && THIRD_PARTY.test(v));
  const licence = named.length ? null : "pd-us-federal";
  const centre = plain(d.center) || null;
  const capturedText = [
    `Read from the NASA Image and Video Library API (${searchUrl(d.nasa_id)}).`,
    `nasa_id: ${d.nasa_id}`,
    `center: ${centre ?? "(none)"}`,
    `photographer: ${photographer ?? "(none)"}`,
    `secondary_creator: ${secondary ?? "(none)"}`,
    `date_created: ${d.date_created ?? "(none)"}`,
    named.length ? `third-party credit in ${named.map(([k]) => k).join(", ")}` : "No field credits anyone outside NASA.",
  ].join("\n");
  return {
    status: "ok",
    candidate: {
      adapter: "nasa",
      ref: d.nasa_id,
      kind_hint: KIND[d.media_type] ?? null,
      title: plain(d.title) || d.nasa_id,
      description: clip(description, 1000),
      item_url: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
      media_url: pickOriginal(manifest, d.media_type),
      mime: null,
      bytes_expected: null,
      sha1: null,
      licence_raw: named.length ? `NASA record crediting ${named.map(([, v]) => clip(v, 80)).join("; ")}` : "NASA, US federal work",
      licence,
      licence_note: named.length ? `the record credits a party outside NASA in ${named.map(([k]) => k).join(", ")}` : null,
      basis: licence
        ? `NASA Image and Video Library record ${d.nasa_id}${centre ? ` (NASA ${centre})` : ""}: a work of NASA, a US federal agency (17 U.S.C. 105); no field credits anyone outside NASA`
        : null,
      credit: photographer ? `${photographer}, NASA` : `NASA${centre ? `/${centre}` : ""}`,
      evidence: { url: searchUrl(d.nasa_id), captured_text: capturedText, captured_at: capturedAt },
      date: firstDate(d.date_created),
      published_at: isoSecond(d.date_created),
      categories: [],
      keywords: (d.keywords ?? []).map(String),
      own_work: false,
      uploader: null,
      ai_fields_checked: ["keywords", "title", "description", "photographer", "secondary_creator"],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date() }) {
  const search = await http.getJson(searchUrl(ref));
  if (search.status !== "ok") return { status: "not_found" };
  const manifest = await http.getJson(assetUrl(ref));
  if (manifest.status !== "ok") return { status: "not_found" };
  return parseNasa(search.json, manifest.json, { ref, capturedAt: isoSecond(now().toISOString()) });
}
