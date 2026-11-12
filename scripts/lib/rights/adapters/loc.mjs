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

import { clip, firstDate, plain } from "../text.mjs";

export function itemUrl(id) {
  return `https://www.loc.gov/item/${encodeURIComponent(String(id))}/?fo=json&at=item`;
}

const FEDERAL = /\b(Farm Security Administration|Office of War Information|U\.?S\.? (federal )?government|federal government|work of the United States|U\.S\. Army|U\.S\. Navy|WPA|Works Progress Administration|National Park Service)\b/i;

/** The oldest year a work can be and still be under US copyright, at `year`: older than this is PD regardless of publication. */
export function pdAgeCutoff(year) {
  return year - 121;
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
  const year = date ? Number(date.slice(0, 4)) : null;
  const yearNow = new Date(capturedAt).getUTCFullYear();
  let licence = null;
  let basis = null;
  let note = null;
  if (/\bpublic domain\b/i.test(rights) && FEDERAL.test(rights)) {
    licence = "pd-us-federal";
    basis = `Library of Congress rights statement: "${clip(rights.match(/[^.]*public domain[^.]*\./i)?.[0] ?? rights, 300)}"; a US federal government collection`;
  } else if (year !== null && year <= pdAgeCutoff(yearNow)) {
    licence = "pd-age";
    basis = `Dated ${date} in the Library of Congress record: created more than 120 years ago, public domain in the US whether or not it was published`;
  } else if (/\bpublic domain\b/i.test(rights)) {
    note = "the rights text says public domain but names no federal source, and the item is under 120 years old";
  } else {
    note = advisory ? `the rights advisory reads "${clip(advisory, 120)}", which is not a licence` : "no rights statement";
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
