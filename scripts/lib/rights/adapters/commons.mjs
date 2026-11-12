// Wikimedia Commons: one file's imageinfo extmetadata (licence, author,
// credit, capture date), its upload history (first upload, uploader), its
// categories (AI-generated, PD basis, logos) and, for an own-work claim, the
// uploader's account age and edit count (laundering heuristics).
//
// The imageinfo/extmetadata query is adapted from void document
// (aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193:design/title-sequence/blender/fetch_assets.py resolve()):
// tweaked to read the licence template id before the short name, to read
// categories and upload history, to keep the response small with
// iiextmetadatafilter, and never to download here (the fetcher does that).

import { readLicence } from "../licences.mjs";
import { clip, firstDate, isoSecond, latestYear, plain } from "../text.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
const EXTMETA = [
  "ObjectName", "ImageDescription", "Artist", "Credit", "DateTimeOriginal", "LicenseShortName", "License",
  "LicenseUrl", "UsageTerms", "AttributionRequired", "Copyrighted", "Restrictions", "Categories",
];

/** Normalises "File:X.jpg", "X.jpg" or a Commons file page URL to "File:X.jpg". */
export function fileTitle(ref) {
  let s = String(ref ?? "").trim();
  const m = s.match(/^https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
  if (m) s = decodeURIComponent(m[1]);
  s = s.replace(/_/g, " ");
  if (!/^File:/i.test(s)) s = `File:${s}`;
  return `File:${s.slice(5)}`;
}

export function infoUrl(ref) {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo|categories",
    cllimit: "max",
    iilimit: "20",
    iiprop: "url|size|sha1|mime|timestamp|user|extmetadata",
    iiextmetadatafilter: EXTMETA.join("|"),
    iiextmetadatalanguage: "en",
    titles: fileTitle(ref),
  });
  return `${API}?${q}`;
}

export function userUrl(name) {
  const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "users", ususers: name, usprop: "registration|editcount" });
  return `${API}?${q}`;
}

// Commons categories that state a public-domain basis.
const PD_FEDERAL = /^PD[ -](USGov|US[ -]?Gov(ernment)?|NASA|NOAA|USGS|FEMA|CDC|USAID|NPS|NIH|USDA|USFWS|US[ -]?Army|US[ -]?Navy|US[ -]?Air[ -]?Force|USMC|US[ -]?Marine|US[ -]?Coast[ -]?Guard|DVIDS|White[ -]House|EOP)\b/i;
// A US basis by age: published before the US cutoff, or expired under US rules.
const PD_AGE_US = /^PD[ -](1923|1926|1929|US|US[ -](expired|no[ -]notice|not[ -]renewed|unpublished|1923|1926|1929))\b/i;
// PD-old, PD-old-70, PD-old-assumed, PD-Art (PD-old...): a life-plus term, which is not a US basis on its own.
const PD_OLD = /^PD[ -](old|Art \(PD[ -]old)/i;
const PD_DEDICATION = /^PD[ -](self|author|user|release)\b/i;

/**
 * The PD basis Commons categories state: { id, category } or null. PD-old
 * and its kin count only when the file's latest stated year is old enough
 * for the US too (published 95 years ago or more).
 */
export function pdBasis(categories, { year = null, yearNow = new Date().getUTCFullYear() } = {}) {
  const fed = categories.find((c) => PD_FEDERAL.test(c));
  if (fed) return { id: "pd-us-federal", category: fed };
  const us = categories.find((c) => PD_AGE_US.test(c));
  if (us) return { id: "pd-age", category: us };
  const old = categories.find((c) => PD_OLD.test(c));
  if (old && year !== null && year <= yearNow - 96) return { id: "pd-age", category: old, year };
  const ded = categories.find((c) => PD_DEDICATION.test(c));
  if (ded) return { id: "pd-dedication", category: ded };
  return null;
}

/** Commons "Restrictions" values that forbid our use whatever the licence: a trademark or an insignia. */
export function restrictionReasons(restrictions) {
  return String(restrictions ?? "")
    .split(/[|,\s]+/)
    .filter((r) => /^(trademarked|insignia)$/i.test(r))
    .map((r) => `Commons marks the file "${r.toLowerCase()}", a restriction no licence lifts`);
}

const BASIS_WORDS = {
  "pd-us-federal": "a work of the US federal government (17 U.S.C. 105)",
  "pd-age": "its copyright term has expired",
  "pd-dedication": "released into the public domain by its author",
};

/** Pure: the candidate a recorded imageinfo response (and optional user record) describes. */
export function parseInfo(json, { ref, user = null, capturedAt }) {
  const page = json?.query?.pages?.[0];
  if (!page || page.missing || page.invalid || !page.imageinfo?.length) return { status: "not_found" };
  const history = page.imageinfo;
  const ii = history[0];
  const em = Object.fromEntries(Object.entries(ii.extmetadata ?? {}).map(([k, v]) => [k, v?.value ?? ""]));
  const categories = [
    ...new Set([
      ...(page.categories ?? []).map((c) => String(c.title).replace(/^Category:/, "")),
      ...String(em.Categories ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    ]),
  ];
  const shortName = plain(em.LicenseShortName);
  const template = plain(em.License);
  let read = readLicence(template);
  if (!read.id && read.family !== "pd") read = readLicence(shortName);
  if (!read.id && read.family !== "pd" && em.LicenseUrl) read = readLicence(em.LicenseUrl);
  let licence = read.id;
  let basis = null;
  let licenceNote = null;
  if (read.family === "pd" || template === "pd") {
    const b = pdBasis(categories, { year: latestYear([plain(em.DateTimeOriginal)]), yearNow: new Date(capturedAt).getUTCFullYear() });
    if (b) {
      licence = b.id;
      basis = `Wikimedia Commons marks the file public domain (category "${b.category}"): ${BASIS_WORDS[b.id]}`;
    } else {
      licence = null;
      licenceNote = "public domain with no basis category (US federal, by age or by dedication)";
    }
  } else if (licence) {
    basis = `Wikimedia Commons file page: ${shortName || template}${em.UsageTerms ? ` (${plain(em.UsageTerms)})` : ""}`;
  }
  const creditRaw = plain(em.Credit);
  const ownWork = /int-own-work/.test(String(em.Credit)) || /^own work\b/i.test(creditRaw);
  const artist = plain(em.Artist) || null;
  const first = history[history.length - 1];
  const mediaUrl = String(ii.url ?? "").split("?")[0];
  const capturedText = [
    "Read from the Wikimedia Commons API (imageinfo extmetadata) for this file page.",
    `LicenseShortName: ${shortName || "(none)"}`,
    `License: ${template || "(none)"}`,
    `LicenseUrl: ${plain(em.LicenseUrl) || "(none)"}`,
    `UsageTerms: ${plain(em.UsageTerms) || "(none)"}`,
    `Artist: ${artist || "(none)"}`,
    `Credit: ${creditRaw || "(none)"}`,
    basis && licence?.startsWith("pd") ? `Basis category: ${basis.match(/"([^"]+)"/)?.[1]}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    status: "ok",
    candidate: {
      adapter: "commons",
      ref: page.title,
      title: plain(em.ObjectName) || page.title.replace(/^File:/, ""),
      description: clip(plain(em.ImageDescription), 1000),
      item_url: ii.descriptionurl,
      media_url: mediaUrl,
      mime: ii.mime ?? null,
      bytes_expected: Number.isInteger(ii.size) ? ii.size : null,
      sha1: ii.sha1 ?? null,
      licence_raw: shortName || template || null,
      licence,
      licence_note: licenceNote,
      basis,
      credit: artist ? `${artist}, via Wikimedia Commons` : creditRaw ? `${creditRaw}, via Wikimedia Commons` : null,
      // The raw Artist and Credit text, so an outlet named only in Credit is refused before download, as the lint does.
      credit_fields: [artist, creditRaw].filter(Boolean),
      evidence: { url: ii.descriptionurl, captured_text: capturedText, captured_at: capturedAt },
      date: firstDate(em.DateTimeOriginal),
      published_at: isoSecond(first.timestamp),
      categories,
      keywords: [],
      own_work: ownWork,
      uploader: ownWork ? parseUser(user, first.user) : null,
      restriction_reasons: restrictionReasons(plain(em.Restrictions)),
      ai_fields_checked: ["commons-categories", "title", "description", "credit", "licence"],
      ref_requested: ref,
    },
  };
}

/** The uploader record from a list=users response, or null when unreadable. */
export function parseUser(json, name) {
  const u = json?.query?.users?.[0];
  if (!u || u.missing || u.invalid) return name ? { name, registration: null, editcount: null } : null;
  return { name: u.name, registration: u.registration ?? null, editcount: Number.isInteger(u.editcount) ? u.editcount : null };
}

/** Network lookup: imageinfo, then the uploader when the file claims own work. */
export async function lookup(ref, { http, now = () => new Date() }) {
  const info = await http.getJson(infoUrl(ref));
  if (info.status !== "ok") return { status: "not_found" };
  const capturedAt = isoSecond(now().toISOString());
  const page = info.json?.query?.pages?.[0];
  const firstUser = page?.imageinfo?.[page.imageinfo.length - 1]?.user;
  let user = null;
  const draft = parseInfo(info.json, { ref, capturedAt });
  if (draft.status === "ok" && draft.candidate.own_work && firstUser) {
    const u = await http.getJson(userUrl(firstUser));
    user = u.status === "ok" ? u.json : null;
    return parseInfo(info.json, { ref, user, capturedAt });
  }
  return draft;
}
