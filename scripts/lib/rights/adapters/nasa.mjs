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

// NASA's own centres and offices. JPL is left out on purpose: it is run by
// Caltech, and "NASA/JPL-Caltech" is a Caltech credit, not a federal work.
const NASA_UNITS = /^(HQ|JSC|KSC|GSFC|Goddard|MSFC|Marshall|ARC|Ames|LaRC|Langley|GRC|Glenn|AFRC|Armstrong|SSC|Stennis|WSTF|Johnson|Kennedy|NASA HQ|Headquarters)$/i;
// Anything that names an organisation, so it cannot be a NASA staff photographer's name.
const ORG = /Caltech|JPL|MSSS|Malin|SpaceX|Boeing|Lockheed|Northrop|Blue Origin|Sierra|Axiom|Orbital|Ball|Maxar|Planet|\bESA\b|JAXA|\bCSA\b|ISRO|CNES|DLR|Roscosmos|Hubble|Webb|STScI|AURA|APL|SwRI|Univ|College|Institut|Observatory|Laboratory|\bLab\b|Inc\b|LLC|Corp|Ltd|GmbH|Getty|Reuters|\bAP\b|AFP|Agency|Company|Team|Science/i;
const PERSON = /^[A-Z][A-Za-z.'’-]*( [A-Z][A-Za-z.'’-]*){0,3}$/;

/**
 * Whether one credit is NASA's alone: "NASA", "NASA/<centre>", or
 * "NASA/<staff photographer>". "NASA/JPL-Caltech", "SpaceX", "Boeing",
 * "ESA/Hubble & NASA" and anything joined with & , or "and" are not.
 */
export function isNasaOnlyCredit(raw) {
  const s = plain(raw).replace(/^[\s(]+|[\s).]+$/g, "").replace(/^NASA['’]s\s+/i, "NASA ");
  if (!s) return true;
  if (/[&,;]|\band\b|\bwith\b/i.test(s)) return false;
  const parts = s.split(/\s*\/\s*/);
  if (!/^NASA$/i.test(parts[0])) return false;
  return parts.slice(1).every((p) => NASA_UNITS.test(p) || (PERSON.test(p) && !ORG.test(p)));
}

// A credit statement inside free text: "Photo credit: Boeing", "Image Credit: (NASA/Keegan Barber)", "courtesy of SpaceX", "© ESA".
const CREDIT_IN_TEXT = /(?:(?:photo|image|video|illustration|animation)\s+)?(?:credits?|courtesy(?: of)?)\s*[:\-]?\s*\(?([^)\n;]{1,120}?)\)?(?=$|[.;\n]\s|\s{2,}|\s*\/\s*Acknowledg|$)|©\s*([^.;\n]{1,80})/gi;

/** Every credit a record states: the credit fields whole, and credit statements found in its text fields. */
export function statedCredits(d) {
  const out = [];
  for (const k of ["photographer", "secondary_creator"]) {
    const v = plain(d[k]);
    if (v) out.push([k, v]);
  }
  for (const k of ["title", "description", "description_508"]) {
    const t = plain(d[k]);
    for (const m of t.matchAll(CREDIT_IN_TEXT)) {
      const v = (m[1] ?? m[2] ?? "").trim();
      if (v) out.push([k, v.replace(/^image credit:\s*/i, "")]);
    }
  }
  return out;
}

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
  const description = [plain(d.description), plain(d.description_508)].filter(Boolean).join(" ");
  const credits = statedCredits(d);
  const named = credits.filter(([, v]) => !isNasaOnlyCredit(v));
  const licence = named.length ? null : "pd-us-federal";
  const centre = plain(d.center) || null;
  const capturedText = [
    `Read from the NASA Image and Video Library API (${searchUrl(d.nasa_id)}).`,
    `nasa_id: ${d.nasa_id}`,
    `center: ${centre ?? "(none)"}`,
    `photographer: ${photographer ?? "(none)"}`,
    `secondary_creator: ${secondary ?? "(none)"}`,
    `date_created: ${d.date_created ?? "(none)"}`,
    `credits stated: ${credits.map(([k, v]) => `${k}: ${clip(v, 120)}`).join("; ") || "(none)"}`,
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
      credit: photographer ? (/^NASA\b/i.test(photographer) ? photographer : `${photographer}, NASA`) : `NASA${centre ? `/${centre}` : ""}`,
      credit_fields: credits.map(([, v]) => v),
      evidence: { url: searchUrl(d.nasa_id), captured_text: capturedText, captured_at: capturedAt },
      date: firstDate(d.date_created),
      published_at: isoSecond(d.date_created),
      categories: [],
      keywords: (d.keywords ?? []).map(String),
      own_work: false,
      uploader: null,
      ai_fields_checked: ["keywords", "title", "description", "description_508", "photographer", "secondary_creator"],
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
