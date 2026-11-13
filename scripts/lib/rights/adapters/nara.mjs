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
const DONATED = /\bdonat(?:ed|ion)\b|\bgift of\b|\bcourtesy of\b|\bcopyright(?:ed)?\b|\bused with permission\b/i;

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
  const federal = creators.filter((c) => FEDERAL_CREATOR.test(c) && !custodianOnly(c, year));
  const group = (hit.ancestors ?? []).find((a) => a.levelOfDescription === "recordGroup");
  const texts = [hit.title, hit.scopeAndContentNote, ...(hit.ancestors ?? []).map((a) => a.title), hit.useRestriction?.note, ...(hit.notes ?? [])].map(plain);
  const donated = texts.find((t) => DONATED.test(t));
  const reasons = [];
  if (use !== "Unrestricted") reasons.push(`the catalogue's use restriction is "${use}", not Unrestricted`);
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
    ok ? "A record of a US federal agency, unrestricted: public domain (17 U.S.C. 105)." : `Refused: ${reasons.join("; ")}.`,
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
      licence_raw: ok ? "National Archives record of a federal agency, unrestricted" : `National Archives record: ${reasons.join("; ")}`,
      licence: ok ? "pd-us-federal" : null,
      licence_note: ok ? null : reasons.join("; "),
      basis: ok ? `National Archives identifier ${hit.naId}${local ? ` (${local})` : ""}: a record created by ${agency}, a US federal agency (17 U.S.C. 105); use restriction Unrestricted` : null,
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
    },
  };
}

export async function lookup(ref, { http, now = () => new Date(), kind = "still" }) {
  if (!/^\d{1,12}$/.test(String(ref))) return { status: "not_found", reason: `"${clip(ref, 80)}" is not a National Archives identifier` };
  const r = await http.getJson(searchUrl(ref));
  if (r.status !== "ok") return { status: "not_found" };
  return parseNara(r.json, { ref, capturedAt: isoSecond(now().toISOString()), kind });
}
