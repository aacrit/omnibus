// Sources refused by default whatever licence Commons shows (T5, show bible v2
// section n; v2 analyst brief, 2026-11-21). Each rule reads a Commons transfer's
// own record: its Artist and Credit fields, its file page's |author= and
// |source= lines and licence templates, its categories and its uploader. A
// subject named only in a title or description is not a source, so those are
// not read here. Net-new. Pure.

import { clip } from "./text.mjs";

/**
 * Each rule: the name, the pattern, and why it is refused. A rule is lifted only by a founder or CoS ruling
 * recorded in docs/decisions/, never by a pin.
 */
export const REFUSED_SOURCES = Object.freeze([
  {
    name: "C-SPAN",
    re: /\bC-?SPAN\b|c-span\.org|youtube\.com\/@CSPAN\b/i,
    why: "C-SPAN's own camera coverage (committee hearings above all) is not a federal work, whatever Commons' PD-CSPAN tag says; only a chamber's own floor feed is, and that is taken from the chamber, never through C-SPAN (bible v2 section n)",
  },
  {
    name: "Kanal13",
    re: /\bKanal ?13(?:AZ)?\b/i,
    why: "Kanal13's CC BY uploads look like re-uploads of agency pool footage; refused by default (v2 analyst brief, 2026-11-21)",
  },
  {
    name: "VTV (Venezolana de Televisión)",
    re: /\bVTV\b|Venezolana de Televisi[oó]n|VTV[- ]?canal ?8|vtv\.com\.ve/i,
    why: "Venezuelan state television; Commons' public-domain mark rests on terms nobody has reviewed, so it is refused until they are (bible v2 section n)",
  },
]);

/**
 * A foreign state's official-works mark on Commons ("PD Venezuela official", {{PD-VenezuelaGov}},
 * "PD-RU-exempt"): not a public-domain basis we accept until that state's terms are reviewed. The US
 * federal marks are pdBasis's in commons.mjs and never match here.
 */
const FOREIGN_STATE_PD = /^\{?\{?\s*PD[ -](?!US\b|USGov|US[ -]?Gov|NASA|NOAA|USGS|FEMA|CDC|USAID|NPS|NIH|USDA|USFWS|US[ -]?Army|US[ -]?Navy|US[ -]?Air|USMC|US[ -]?Marines?|US[ -]?Military|US[ -]?Coast|DVIDS|White[ -]House|EOP|self|author|user|release|old|Art|1923|1926|1929|algorithm|CSPAN)([A-Z][A-Za-z]+)(?:[ -]?(?:Gov|government|official|exempt|EdictGov|Statute))/i;

/** The lines of a Commons file page that state its source: |author=, |source=, and every template outside {{Information}}. */
export function sourceLines(wikitext = "") {
  return String(wikitext ?? "")
    .split("\n")
    .filter((l) => /^\s*\|\s*(?:author|source)\s*=/.test(l) || (/\{\{/.test(l) && !/\{\{\s*(?:Information|int:|[a-z]{2,3}\s*\|)/.test(l)))
    .map((l) => clip(l.trim(), 400));
}

/** Every address a Commons file page's |source= and |author= lines name. */
export function sourceUrls(wikitext = "") {
  const out = [];
  for (const l of sourceLines(wikitext).filter((x) => /^\|\s*(?:author|source)\s*=/.test(x))) {
    for (const m of l.matchAll(/https?:\/\/[^\s\]|}<>"]+/g)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/** Every reason a candidate's own source record puts it on the refused-sources list, or []. */
export function sourceRefusals({ credits = [], wikitext = "", categories = [], uploader = null, evidenceText = "" }) {
  const fields = [...credits, ...sourceLines(wikitext), ...categories, uploader?.name, ...String(evidenceText ?? "").split("\n").filter((l) => /^(?:Artist|Credit|Source|Author|Uploader):/i.test(l))]
    .filter(Boolean)
    .map(String);
  const out = [];
  for (const r of REFUSED_SOURCES) {
    const hit = fields.find((f) => r.re.test(f));
    if (hit) out.push(`refused source ${r.name} ("${clip(hit.match(r.re)[0], 60)}"): ${r.why}`);
  }
  const marks = [...categories.map(String), ...sourceLines(wikitext)];
  const pd = marks.map((m) => m.replace(/^Category:/, "")).find((m) => FOREIGN_STATE_PD.test(m));
  if (pd) out.push(`a foreign state's official-works mark ("${clip(pd, 80)}") is not a basis until that state's terms are reviewed: refused`);
  return out;
}
