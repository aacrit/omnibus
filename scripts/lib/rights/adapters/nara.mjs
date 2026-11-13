// The National Archives catalogue (catalog.archives.gov, a federal host by
// the founder's ruling, chat 2026-11-12): one description by its National
// Archives identifier (NAID), read from the catalogue's public records search,
// with its use restriction, creators, production date and digital objects.
// Net-new. Pure apart from lookup().
//
// A record passes as pd-us-federal only when its use restriction is
// "Unrestricted" and a federal agency is named as its creator (the series'
// creators, or the record group's). Donated material, a restricted use, or a
// record with no federal creator fails with the reason.

import { clip, isoSecond, plain } from "../text.mjs";

const SEARCH = "https://catalog.archives.gov/proxy/records/search";

export function searchUrl(naId) {
  return `${SEARCH}?${new URLSearchParams({ naId: String(naId) })}`;
}

export function itemUrl(naId) {
  return `https://catalog.archives.gov/id/${encodeURIComponent(String(naId))}`;
}

const FEDERAL_CREATOR = /^(?:Department of|War Department|Navy Department|Executive Office|Office of|Bureau of|National |United States|U\.S\.|Federal |Central Intelligence|Army|Air Force|Marine Corps|Coast Guard)|\bDepartment of (?:Defense|the Air Force|the Army|the Navy|State|War|Agriculture|Commerce|Labor|the Interior|Justice)\b|\bArmy Air Forces\b/;
// A company, society, network or educational centre that happens to start "National" or "United States" (S4 review).
const NOT_AN_AGENCY = /\b(?:Company|Corporation|Corp\.?|Inc\.?|Incorporated|Society|Broadcasting|Network|Television|Radio Center|Association|Foundation|University|College|Pictures|Studios?)\b/i;

/**
 * The federal makers a record flagged "Restricted - Possibly" (Copyright) may pass on (S4 review,
 * 2026-11-13): an explicit list of agencies that made film and photographs, matched against one
 * part of the creator heading. Never the National Archives or a presidential library (custodians),
 * and never a heading that merely starts "National" or "United States".
 */
export const FLAGGED_FEDERAL_MAKERS = [
  /^Department of the Army$/,
  /^War Department$/,
  /^Office of the Chief Signal Officer$/,
  /^Army Pictorial (?:Service|Center)$/,
  /^Department of the Navy$/,
  /^Navy Department$/,
  /^Naval Photographic Center$/,
  /^(?:United States |U\.S\. )?Marine Corps$/,
  /^Department of the Air Force$/,
  /^(?:United States |U\.S\. )?Air Force$/,
  /^Army Air Forces$/,
  /^White House Naval Photographic Unit$/,
  /^(?:United States|U\.S\.) Information Agency$/,
  /^Office of War Information$/,
  /^Department of Defense$/,
  /^Department of State$/,
  /^(?:United States |U\.S\. )?Coast Guard$/,
];
const CUSTODIAN = /\bNational Archives\b|\bPresidential Librar(?:y|ies)\b|\bLibrary\b|\bArchives and Records\b/i;

/** The heading's parts ("Department of Defense. Department of the Army. Office of the Chief Signal Officer. (dates)"), without the dates. */
function headingParts(heading) {
  return String(heading)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .split(/\.\s+|\.$/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Whether a creator heading names a maker the flagged path accepts: on the explicit list, dated, and no custodian. */
export function flaggedFederalMaker(heading) {
  const h = String(heading);
  if (CUSTODIAN.test(h) || NOT_AN_AGENCY.test(h)) return false;
  if (!/\((?:ca\. )?(?:\d{2}\/\d{2}\/)?\d{4}\s*-/.test(h)) return false; // an undated heading is a custodian's, not a maker's
  return headingParts(h).some((p) => FLAGGED_FEDERAL_MAKERS.some((re) => re.test(p)));
}

const DONATED = /\bdonat(?:ed|ion)\b|\bgift of\b|\bcourtesy of\b|\bcopyright(?:ed)?\b|\bused with permission\b/i;

// NARA's own boilerplate beside its "possibly copyright" flag: it is the flag, not a statement about the record.
const FLAG_NOTE = /^Some or all of this material may be restricted by copyright or other intellectual property rights restrictions\.?$/i;
// A commercial newsreel or studio named anywhere on the record keeps NARA's copyright flag standing.
const COMMERCIAL_NEWSREEL = /\b(?:Universal|MCA|Paramount|Movietone|Fox|Path[eé]|Hearst|News of the Day|Telenews|March of Time|Warner|RKO|Metro-Goldwyn|MGM|Columbia Pictures|CBS|NBC|ABC)\b/i;

/**
 * NARA's conservative flag: use restriction "Restricted - Possibly" with Copyright as its only
 * specific restriction. On a federal agency's own film series it is a blanket caution, so such a
 * record may pass only with its federal maker proven on the record (founder ruling, relayed by the
 * coordinator, 2026-11-13). "Undetermined" and every other restriction never pass.
 */
export function conservativeFlag(rec) {
  const u = rec?.useRestriction ?? {};
  const specific = u.specificUseRestrictions ?? [];
  return plain(u.status) === "Restricted - Possibly" && specific.length === 1 && specific[0] === "Copyright";
}

const IMAGE_ORDER = ["Image (TIFF)", "Image (JPG)", "Image (JPEG)", "Image (PNG)"];

const VIDEO_ORDER = ["Audio/Visual File (MP4)", "Video (MP4)"];

/** The best digital object on the catalogue's own host: for footage an MP4, otherwise TIFF over JPEG over PNG. */
export function pickObject(objects, kind = "still") {
  const list = (objects ?? []).filter((o) => /^https:\/\/catalog\.archives\.gov\//.test(String(o.objectUrl ?? "")));
  for (const t of kind === "footage" ? VIDEO_ORDER : IMAGE_ORDER) {
    const o = list.find((x) => x.objectType === t);
    if (o) return o;
  }
  return null;
}

function productionDate(rec) {
  const d = rec.productionDates?.[0] ?? rec.coverageDates?.[0] ?? rec.coverageStartDate ?? null;
  if (!d?.year) return null;
  const mm = d.month ? `-${String(d.month).padStart(2, "0")}` : "";
  const dd = d.month && d.day ? `-${String(d.day).padStart(2, "0")}` : "";
  return `${d.year}${mm}${dd}`;
}

/** Pure: the candidate a recorded records-search response describes. */
/**
 * A creator heading with its dates ("... Eisenhower Library. (07/31/2011 - )")
 * that began after the record was made is the record's custodian, not its
 * author: a library founded in 2011 did not film 1952.
 */
export function custodianOnly(heading, year) {
  const m = String(heading).match(/\((\d{2})\/(\d{2})\/(\d{4})\s*-/);
  return Boolean(m && year && Number(m[3]) > Number(year));
}

export function parseNara(json, { ref, capturedAt, kind = "still" }) {
  const hit = json?.body?.hits?.hits?.[0]?._source?.record;
  if (!hit || String(hit.naId) !== String(ref)) return { status: "not_found" };
  const use = plain(hit.useRestriction?.status) || "(none)";
  const creators = (hit.ancestors ?? []).flatMap((a) => (a.creators ?? []).map((c) => plain(c.heading))).concat((hit.creators ?? []).map((c) => plain(c.heading)));
  const year = (hit.productionDates?.[0] ?? hit.coverageStartDate ?? hit.coverageDates?.[0])?.year ?? null;
  const custodians = creators.filter((c) => FEDERAL_CREATOR.test(c) && custodianOnly(c, year));
  const federalAll = creators.filter((c) => FEDERAL_CREATOR.test(c) && !NOT_AN_AGENCY.test(c) && !custodianOnly(c, year));
  const group = (hit.ancestors ?? []).find((a) => a.levelOfDescription === "recordGroup");
  const texts = [hit.title, hit.scopeAndContentNote, ...(hit.ancestors ?? []).map((a) => a.title), hit.useRestriction?.note, ...(hit.notes ?? [])].map(plain);
  const flagged = conservativeFlag(hit);
  // A flagged record passes only on a maker from the explicit list (S4 review): never NARA, a library, or an undated heading.
  const federal = flagged ? federalAll.filter(flaggedFederalMaker) : federalAll;
  const donated = texts.find((t) => DONATED.test(t) && !(flagged && FLAG_NOTE.test(t)));
  const reasons = [];
  const commercial = flagged ? texts.concat(creators).find((t) => COMMERCIAL_NEWSREEL.test(t)) : null;
  if (use !== "Unrestricted" && !flagged) reasons.push(`the catalogue's use restriction is "${use}", not Unrestricted`);
  if (flagged && !group) reasons.push(`the catalogue's use restriction is "${use}" (Copyright) and the record sits in a collection, not a federal record group, so the flag stands`);
  if (commercial) reasons.push(`the catalogue's use restriction is "${use}" (Copyright) and the record names a commercial newsreel or studio ("${clip(commercial, 120)}"), so the flag stands`);
  if (flagged && !federal.length) reasons.push(`the catalogue's use restriction is "${use}" (Copyright) and no federal maker is proven on the record (an agency on the list of film-making agencies, FLAGGED_FEDERAL_MAKERS), so the flag stands`);
  if (flagged && !year) reasons.push(`the catalogue's use restriction is "${use}" (Copyright) and the record states no production year, so its maker cannot be shown to have made it`);
  if (!federal.length) reasons.push(custodians.length ? `the federal body named (${clip(custodians[0], 120)}) began after the record was made, so it holds the record and did not make it` : "no federal agency is named as the record's creator");
  if (donated) reasons.push(`the record speaks of donated or copyright material: "${clip(donated, 120)}"`);
  const obj = pickObject(hit.digitalObjects, kind);
  const ok = reasons.length === 0;
  const local = plain(hit.localIdentifier) || null;
  const capturedText = [
    `Read from the National Archives catalogue (${searchUrl(ref)}).`,
    `naId: ${hit.naId}; local identifier: ${local ?? "(none)"}`,
    `record group: ${group ? `${group.recordGroupNumber ?? ""} ${plain(group.title)}`.trim() : "(none)"}`,
    `creators: ${creators.join("; ") || "(none)"}`,
    `use restriction: ${use}; access restriction: ${plain(hit.accessRestriction?.status) || "(none)"}`,
    ok
      ? flagged
        ? `NARA flags the record "Restricted - Possibly" (Copyright), a blanket caution on the series; its maker, ${federal[0]}, is a US federal agency named on the record, so it is a work of the US government: public domain (17 U.S.C. 105).`
        : "A record of a US federal agency, unrestricted: public domain (17 U.S.C. 105)."
      : `Refused: ${reasons.join("; ")}.`,
  ].join("\n");
  const agency = federal[0]?.replace(/\s*\([^)]*\)\s*$/, "") ?? null;
  return {
    status: "ok",
    candidate: {
      adapter: "nara",
      ref: String(hit.naId),
      kind_hint: obj ? (/^(?:Audio\/Visual|Video)/.test(obj.objectType) ? "footage" : "still") : null,
      title: clip(plain(hit.title), 400) || `NAID ${hit.naId}`,
      description: clip(plain(hit.scopeAndContentNote), 1000),
      item_url: itemUrl(hit.naId),
      media_url: obj?.objectUrl ?? null,
      mime: null,
      // The catalogue's objectFileSize is not a real size for every object, so it is not checked.
      bytes_expected: null,
      sha1: null,
      licence_raw: ok ? (flagged ? "National Archives record of a federal agency, flagged possibly restricted (Copyright) as a series caution" : "National Archives record of a federal agency, unrestricted") : `National Archives record: ${reasons.join("; ")}`,
      licence: ok ? "pd-us-federal" : null,
      licence_note: ok ? null : reasons.join("; "),
      basis: ok ? `National Archives identifier ${hit.naId}${local ? ` (${local})` : ""}: a record created by ${agency}, a US federal agency (17 U.S.C. 105); use restriction ${flagged ? "Restricted - Possibly (Copyright), NARA's series caution, passed on the federal maker the record names" : "Unrestricted"}` : null,
      credit: `${agency ?? "US federal government"}, via the National Archives (NAID ${hit.naId}${local ? `, ${local}` : ""})`,
      credit_fields: [],
      evidence: { url: itemUrl(hit.naId), captured_text: capturedText, captured_at: capturedAt },
      date: productionDate(hit),
      published_at: null,
      categories: (hit.subjects ?? []).map((s) => plain(s.heading)),
      keywords: [],
      own_work: false,
      uploader: null,
      ai_fields_checked: ["title", "scopeAndContentNote", "subjects", "creators"],
      // The record's own identifiers: a date record's must appear in the source it dates (S4 review).
      record_ids: [String(hit.naId), ...(local ? [local] : [])],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date(), kind = "still" }) {
  if (!/^\d{1,12}$/.test(String(ref))) return { status: "not_found", reason: `"${clip(ref, 80)}" is not a National Archives identifier` };
  const r = await http.getJson(searchUrl(ref));
  if (r.status !== "ok") return { status: "not_found" };
  return parseNara(r.json, { ref, capturedAt: isoSecond(now().toISOString()), kind });
}
