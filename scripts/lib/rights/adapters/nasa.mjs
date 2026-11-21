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
const NASA_UNITS =
  /^(HQ|JSC|KSC|GSFC|Goddard|MSFC|Marshall|ARC|Ames|LaRC|Langley|GRC|Glenn|AFRC|Armstrong|SSC|Stennis|WSTF|Johnson|Kennedy|NASA HQ|Headquarters|NASA Headquarters|Goddard Space Flight Center|Marshall Space Flight Center|Johnson Space Center|Kennedy Space Center|Stennis Space Center|Ames Research Center|Langley Research Center|Glenn Research Center|Armstrong Flight Research Center|White Sands Test Facility|Wallops Flight Facility|Wallops|Michoud Assembly Facility|Michoud|Scientific Visualization Studio|SVS|Conceptual Image Lab|(?:Goddard Space Flight Center|Goddard) (?:Conceptual Image Lab|Scientific Visualization Studio)|Earth Observatory|Worldview|EOSDIS)$/i;
// T2c: a short list of NASA missions that stand after "NASA/" ("NASA/Explorer 1", "NASA/Apollo 11").
const NASA_MISSIONS = /^(Mercury|Gemini|Apollo|Skylab|Explorer|Artemis|Space Shuttle|International Space Station|ISS)( [0-9]{1,3}| [IVX]{1,4})?$/;
// Anything that names an organisation, so it cannot be a NASA staff photographer's name.
// Whole words only: "Laura Rochon" is not AURA, "Ben Kaplan" is not APL, "Sierra Smith" is not Sierra Space.
const ORG =
  /\b(Caltech|JPL|MSSS|Malin|SpaceX|Boeing|Lockheed|Northrop|Grumman|Blue Origin|Sierra Space|Sierra Nevada|Axiom|Orbital|Ball Aerospace|Maxar|Planet Labs?|ESA|JAXA|CSA|ISRO|CNES|DLR|Roscosmos|Hubble|Webb|STScI|AURA|APL|SwRI|Univ(ersity)?|College|Institut[eo]?|Observatory|Laborator(y|ies)|Labs?|Inc|LLC|Corp(oration)?|Ltd|GmbH|Getty|Reuters|AP|AFP|Agency|Company|Team|Sciences?|Aerospace|Space|Machines|Systems|Technolog(y|ies)|Industries|Dynamics|Robotics|Aerojet|Rocketdyne|Jacobs|Hopkins|State|Research|Propulsion|Canyon|Foundation|Museum|Society|Group|Studios?|Media|News|Press|Images|Photos|Photography)\b/i;
// T2c: a staff name is 2 to 4 words, each capitalised and none in capitals throughout
// ("Bill Ingalls", "J. D. Smith"); "ULA", "CNSA", "ASI", "JHUAPL" and a lone "Bigelow" are not names.
const PERSON = /^[A-Z][A-Za-z.'’-]*( [A-Z][A-Za-z.'’-]*){1,3}$/;
const ALL_CAPS_WORD = /(^|\s)[A-Z]{2,}(?=\s|$)/;

const isPerson = (p) => PERSON.test(p) && !ALL_CAPS_WORD.test(p) && !ORG.test(p);

/**
 * Whether one credit is NASA's alone: "NASA", "NASA/<centre>", "NASA/<mission>",
 * or "NASA/<staff photographer>" (T2c: 2 to 4 words, not in capitals). "NASA/JPL-Caltech", "SpaceX", "Boeing",
 * "ESA/Hubble & NASA" and anything joined with & , or "and" are not.
 */
export function isNasaOnlyCredit(raw, { staff = [] } = {}) {
  const s = plain(raw).replace(/^[\s(]+|[\s).]+$/g, "").replace(/^NASA['’]s\s+/i, "NASA ").replace(/^NASA\s+(?=[A-Z])/, "NASA/");
  if (!s) return true;
  if (/[&,;]|\band\b|\bwith\b/i.test(s)) return false;
  const parts = s.split(/\s*\/\s*/);
  if (!/^NASA$/i.test(parts[0])) return false;
  // A name is a NASA photographer only when the record's own photographer or secondary_creator field names the same person.
  const staffNames = new Set(staff.map((x) => plain(x).split("/").pop().replace(/[()]/g, "").trim().toLowerCase()).filter(Boolean));
  return parts.slice(1).every((p) => NASA_UNITS.test(p) || NASA_MISSIONS.test(p) || (isPerson(p) && staffNames.has(p.toLowerCase())));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A bare staff name ("Bill Ingalls") in a credit field, accepted only when the
 * record is held by a NASA centre (JPL is not one here) and its own title or
 * description credits "NASA/<the same name>". A name shape alone cannot tell a
 * photographer from a contractor ("United Launch Alliance", "Virgin Galactic").
 */
export function isNasaStaffName(raw, { centre, texts = [] } = {}) {
  const name = plain(raw).trim();
  if (!NASA_UNITS.test(plain(centre)) || !isPerson(name)) return false;
  const credited = new RegExp(`\\bNASA\\s*/\\s*${escapeRe(name).replace(/ /g, "\\s+")}(?![A-Za-z'’-])`, "i");
  return texts.some((t) => credited.test(plain(t)));
}

// A credit statement inside free text: "Photo credit: Boeing", "Image Credit: (NASA/Keegan Barber)",
// "Photo: Boeing", "Photo by SpaceX.", "Images by Northrop Grumman", "courtesy of SpaceX", "© ESA".
// A bare "credit" needs a colon, so prose ("The team credits the success") is never read as one.
const CREDIT_TAIL = String.raw`\s*\(?([^)\n;]{1,120}?)\)?(?=$|[.;\n]\s|\s{2,}|\s*\/\s*Acknowledg|$)`;
const CREDIT_LEAD = [
  String.raw`\b(?:photo|image|video|illustration|animation)s?\s+credits?\s*:?`,
  String.raw`\bcredits?\s*:`,
  String.raw`\bcourtesy\s+of\b\s*:?|\bcourtesy\s*:`,
  String.raw`\b(?:photo|image|video|illustration)s?(?:\s+by)?\s*:`,
  String.raw`\b(?:photo|image|video|illustration)s?\s+by\b`,
].join("|");
const CREDIT_IN_TEXT = new RegExp(String.raw`(?:${CREDIT_LEAD})${CREDIT_TAIL}|©\s*([^.;\n]{1,80})`, "gi");

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

/** The capture's small copy (scripts/capture/proxy.mjs): ~mobile or ~small video, ~medium or ~small image; never used by the fetcher. */
export function pickProxy(manifest, mediaType) {
  const hrefs = (manifest?.collection?.items ?? []).map((i) => String(i.href ?? "")).filter((h) => h && !/\.(json|srt|vtt|txt)$/i.test(h));
  const order = mediaType === "video" ? ["~mobile.", "~small.", "~preview."] : ["~medium.", "~small."];
  for (const tag of order) {
    const h = hrefs.find((x) => x.includes(tag));
    if (h) return h.replace(/^http:\/\//, "https://");
  }
  return null;
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
  const centre = plain(d.center) || null;
  const texts = [d.title, d.description, d.description_508];
  const staffField = (k, v) => (k === "photographer" || k === "secondary_creator") && isNasaStaffName(v, { centre, texts });
  const staff = [photographer, secondary].filter(Boolean);
  const named = credits.filter(([k, v]) => !isNasaOnlyCredit(v, { staff }) && !staffField(k, v));
  const licence = named.length ? null : "pd-us-federal";
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
      proxy_url: pickProxy(manifest, d.media_type),
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
