// Library of Congress JSON API (www.loc.gov/item/<id>/?fo=json&at=item):
// title, date, contributors, rights statement and advisory, the image
// derivatives. Net-new; the rights reading follows void document's Panama
// ledger practice (aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193:
// films/panama-canal/footage-ledger.json rights_checked), where "No known
// restrictions" alone was never taken as a licence.
//
// An item passes only when its rights text says public domain and names a
// US federal source (pd-us-federal), or when its date is old enough that it
// is public domain whether or not it was published (pd-age, 120 years).

import { clip, firstDate, latestYear, plain } from "../text.mjs";

export { latestYear };

export function itemUrl(id) {
  return `https://www.loc.gov/item/${encodeURIComponent(String(id))}/?fo=json&at=item`;
}

const FEDERAL = /\b(Farm Security Administration|Office of War Information|U\.?S\.? (federal )?government|federal government|work of the United States|U\.S\. Army|U\.S\. Navy|WPA|Works Progress Administration|National Park Service)\b/i;

/** Latest year a work of unknown authorship can be created in and be PD at `year` (120 years from creation). */
export function pdAgeCutoff(year) {
  return year - 121;
}

/** Latest year a work can be published in and be PD in the US at `year` (95 years from publication). */
export function publishedCutoff(year) {
  return year - 96;
}

// LoC's standard link titles, which name copyright and restrictions on every item page without stating any.
// LoC's standard link titles, and its standard "not aware of any copyright" statement, which state no caution.
const LOC_BOILERPLATE =
  /The Library of Congress is not aware of any U\.S\. copyright protection[^.]*?(?:\([^)]*\)[^.]*?)*(?:\.(?!\w)|$)|Rights and Restrictions Information|More about Copyright and other Restrictions|Copyright and other Restrictions|No known restrictions( on publication)?\.?/gi;
const CAUTION = /\b(may be protected|copyright(ed)?|restricted|restrictions apply|not (been )?evaluated|permission (is )?required|rights status not evaluated)\b/i;

/**
 * Rights text split into sentences. A full stop after a lone capital letter
 * ("U.S.", "U.S.C.", "Dorothea M. Lange") does not end a sentence.
 */
export function sentencesOf(text) {
  return String(text ?? "")
    .split(/(?<!(?:^|[^A-Za-z])[A-Z]\.)(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The first cautionary sentence in rights text once LoC's boilerplate is removed, or null. */
export function cautionIn(text) {
  return sentencesOf(String(text ?? "").replace(LOC_BOILERPLATE, " ")).find((s) => CAUTION.test(s)) ?? null;
}

// A statement about a class of works ("Works created by U.S. government employees are in the public
// domain") says nothing about this item. It passes only when it names a collection known to be federal.
const CLASS_LEVEL = /\b(works?|photographs?|images?|items?|materials?|records?)\s+(created|made|taken|produced|prepared|authored)\s+by\b|\bemployees?\b/i;
const KNOWN_FEDERAL_COLLECTIONS = [/\bFarm Security Administration\/Office of War Information\b/i];

/** Whether a sentence speaks of a class of works rather than a named collection. */
export function isClassLevel(sentence) {
  return CLASS_LEVEL.test(sentence) && !KNOWN_FEDERAL_COLLECTIONS.some((re) => re.test(sentence));
}

function federalPd(s) {
  return /\bpublic domain\b/i.test(s) && FEDERAL.test(s) && !/\b(not|may|except|unless)\b/i.test(s);
}

/** The sentence that states public domain and names a federal source together, about this collection, or null. */
export function federalPdSentence(text) {
  return sentencesOf(text).find((s) => federalPd(s) && !isClassLevel(s)) ?? null;
}

/** A federal public-domain sentence that speaks only of a class of works, or null. */
export function classLevelSentence(text) {
  return sentencesOf(text).find((s) => federalPd(s) && isClassLevel(s)) ?? null;
}

function largestImage(urls) {
  const parsed = (urls ?? []).map((u) => {
    const [base, frag] = String(u).split("#");
    const w = Number(new URLSearchParams(frag ?? "").get("w") ?? 0);
    return { url: base.replace(/^\/\//, "https://"), w };
  });
  parsed.sort((a, b) => b.w - a.w);
  const best = parsed.find((p) => /\.(jpe?g|tiff?)$/i.test(p.url)) ?? parsed[0];
  return best?.url ?? null;
}

/** Pure: the candidate a recorded LoC item response describes. */
export function parseLoc(json, { ref, capturedAt }) {
  const it = json?.item;
  if (!it || !it.id) return { status: "not_found" };
  const rights = (Array.isArray(it.rights) ? it.rights : [it.rights]).filter(Boolean).map(plain).join(" ");
  const advisory = plain(it.rights_advisory) || null;
  const date = firstDate(it.date) ?? firstDate((it.created_published ?? [])[0]);
  // A range ("1890-1935", "between 1900 and 1940") is judged by its latest year.
  const year = latestYear([it.date, ...(it.created_published ?? []), ...(it.dates ?? []).flatMap((d) => Object.keys(d ?? {}))]);
  const yearNow = new Date(capturedAt).getUTCFullYear();
  const caution = cautionIn(`${rights} ${advisory ?? ""}`);
  const federal = federalPdSentence(rights);
  const named = (it.contributor_names ?? []).length > 0;
  const published = (it.created_published ?? []).some((s) => /\s:\s|\bpublished\b|\bpublisher\b/i.test(String(s)));
  let licence = null;
  let basis = null;
  let note = null;
  if (caution) {
    note = `the rights text says "${clip(caution, 120)}"`;
  } else if (federal) {
    licence = "pd-us-federal";
    basis = `Library of Congress rights statement: "${clip(federal, 300)}"; a US federal government collection`;
  } else if (year !== null && published && year <= publishedCutoff(yearNow)) {
    licence = "pd-age";
    basis = `Published in ${year} per the Library of Congress record (latest year stated): more than 95 years ago, so its US copyright term has ended`;
  } else if (year !== null && !named && year <= pdAgeCutoff(yearNow)) {
    licence = "pd-age";
    basis = `Created by ${year} per the Library of Congress record (latest year stated), author unknown: more than 120 years from creation, so public domain in the US whether or not it was published`;
  } else if (classLevelSentence(rights)) {
    note = `the rights text speaks of a class of works ("${clip(classLevelSentence(rights), 120)}"), not of this item or a known federal collection`;
  } else if (/\bpublic domain\b/i.test(rights)) {
    note = "the rights text says public domain but not in the same sentence as a federal source, and no age basis applies";
  } else {
    note = advisory ? `the rights advisory reads "${clip(advisory, 120)}", which is not a licence` : "no rights statement, and no age basis applies";
  }
  const creditLine = rights.match(/Credit Line:\s*([^.]+)\./i)?.[1]?.trim() ?? "Library of Congress";
  const contributor = (it.contributor_names ?? [])[0];
  const person = contributor ? plain(contributor).replace(/,\s*(photographer|artist|creator|author)\.?$/i, "") : null;
  const personName = person && /,/.test(person) ? person.split(/,\s*/).reverse().join(" ") : person;
  const digital = String(it.reproduction_number ?? "").match(/LC-[A-Z]+-[a-z0-9-]+/)?.[0] ?? null;
  const capturedText = [
    `Read from the Library of Congress JSON API (${itemUrl(ref)}).`,
    `rights: ${clip(rights, 1500) || "(none)"}`,
    `rights_advisory: ${advisory ?? "(none)"}`,
    `date: ${it.date ?? "(none)"}`,
  ].join("\n");
  const subjects = (it.subject ?? it.subjects ?? []).map(String);
  return {
    status: "ok",
    candidate: {
      adapter: "loc",
      ref: String(ref),
      kind_hint: (it.online_format ?? []).includes("video") ? "footage" : (it.online_format ?? []).includes("audio") ? "sound" : "still",
      title: clip(plain(it.title), 400) || String(ref),
      description: clip((it.notes ?? []).map(plain).join(" "), 1000),
      item_url: String(it.url ?? `https://www.loc.gov/item/${ref}/`).replace(/^http:/, "https:"),
      media_url: largestImage(it.image_url),
      mime: null,
      bytes_expected: null,
      sha1: null,
      licence_raw: clip(rights || advisory || "", 200) || null,
      licence,
      licence_note: note,
      basis,
      credit: [personName, `${creditLine}${digital ? `, ${digital}` : ""}`].filter(Boolean).join(". "),
      evidence: { url: String(it.url ?? `https://www.loc.gov/item/${ref}/`).replace(/^http:/, "https:"), captured_text: capturedText, captured_at: capturedAt },
      date,
      published_at: null,
      categories: [],
      keywords: subjects,
      own_work: false,
      uploader: null,
      ai_fields_checked: ["subjects", "title", "notes", "rights"],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date() }) {
  const r = await http.getJson(itemUrl(ref));
  if (r.status !== "ok") return { status: "not_found" };
  return parseLoc(r.json, { ref, capturedAt: now().toISOString().replace(/\.\d{3}Z$/, "Z") });
}
