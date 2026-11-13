// The licence allowlist (show bible section f) and the source denylist.
//
// Adapted from void document (aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193):
//   studio/engine/render.py LICENCE_OK, LICENCE_SHARE_ALIKE, licence_allowed()
//   web/src/cc-licences.json (CC kinds and versions, ported versions)
// Tweaked: document allows CC BY-SA only per film; every omnibus episode is
// CC BY-SA 4.0 (founder ruling), so share-alike is on the allowlist. Public
// domain must name its basis (US federal, by age, by explicit dedication),
// "EU free reuse with mandatory credit" is added, and MIT (document's sound
// exception) is left behind. Pure: no I/O.

import { createHash } from "node:crypto";

/** CC licence versions that exist (1.0 to 4.0; 2.1 only as Japanese ports). */
export const CC_VERSIONS = ["1.0", "2.0", "2.1", "2.5", "3.0", "4.0"];

/**
 * BY-SA versions an adaptation may be shared from under the episode's CC BY-SA 4.0. BY-SA 1.0 has no
 * "later version" clause, so a 1.0 work cannot go into a 4.0 episode: refused (E9i review, 2026-11-13).
 */
export const SA_VERSIONS = CC_VERSIONS.filter((v) => v !== "1.0");

/** The three public-domain bases the bible allows. */
export const PD_BASES = ["pd-us-federal", "pd-age", "pd-dedication"];

/**
 * Ledger class own_property (founder ruling, chat 2026-11-12): void news's
 * own printed pages, published by the same owner. Not a licence anyone
 * granted: our own work, shown as printed. Only the voidnews adapter may
 * claim it, and only for a page captured from void news's own hosts.
 */
export const OWN_PROPERTY = "own-property";
export const OWN_ADAPTER = "voidnews";

/**
 * Ledger class editorial-use (founder ruling, 2026-11-13): footage an
 * institution publishes free for news or editorial use, under terms whose
 * page is captured as the evidence, with the credit those terms require.
 * The item keeps its own terms (it is not relicensed under the episode's
 * CC BY-SA 4.0).
 *
 * Closed (S4 review, 2026-11-13): no adapter fetches a terms page yet, so the
 * class is off ALLOWED_IDS and every editorial-use item is refused. It reopens
 * only with an adapter that fetches the terms page itself (its url on the
 * fetcher's FETCH_HOSTS, the captured text hashed with a witness), and only for
 * a terms page on REVIEWED_TERMS_PAGES (editorialTermsProblems).
 */
export const EDITORIAL_USE = "editorial-use";

/**
 * Ledger class fair-use-excerpt (founder ruling, 2026-11-13): a broadcast or
 * outlet clip, only as evidence of coverage in The Weight beside the board,
 * bounded by the fair-use lints (scripts/lib/rights/lints.mjs lintFairUse).
 * It is the only class that may carry an outlet's material; agencies
 * (AP, Reuters, AFP, Getty) stay refused whatever the class.
 */
export const FAIR_USE = "fair-use-excerpt";

/** Every canonical licence id that passes. Anything else fails the gate. */
export const ALLOWED_IDS = new Set([
  ...PD_BASES,
  "cc0-1.0",
  ...CC_VERSIONS.map((v) => `cc-by-${v}`),
  ...SA_VERSIONS.map((v) => `cc-by-sa-${v}`),
  "eu-reuse-credit",
  OWN_PROPERTY,
  FAIR_USE,
]);

/** The credit the EU's reuse decision makes mandatory: "© European Union, 2026". */
export const EU_CREDIT = /^© European Union, (19|20)\d\d\b/;

const NC_ND = /(^|[^a-z])(by)?[-_ ]?(nc|nd)([^a-z]|$)|non[-_ ]?commercial|no[-_ ]?deriv|noderiv|bync|bynd/i;

const CC_KIND_WORDS = [
  // longest first, so "by-nc-sa" is never read as "by"
  ["by-nc-nd", /\bby[- ]?nc[- ]?nd\b|attribution[- ]noncommercial[- ]no ?derivs?/i],
  ["by-nc-sa", /\bby[- ]?nc[- ]?sa\b|attribution[- ]noncommercial[- ]share ?alike/i],
  ["by-nd-nc", /\bby[- ]?nd[- ]?nc\b/i],
  ["by-nc", /\bby[- ]?nc\b|attribution[- ]noncommercial/i],
  ["by-nd", /\bby[- ]?nd\b|attribution[- ]no ?derivs?|attribution[- ]noderivatives/i],
  ["by-sa", /\bby[- ]?sa\b|attribution[- ]share ?alike/i],
  ["by", /\bby\b|attribution\b/i],
];

/**
 * Reads a licence as a source states it ("CC BY-SA 2.0", "cc-by-sa-2.0-de",
 * a creativecommons.org URL, "Creative Commons Attribution 2.0", "CC0",
 * "Public domain", "© European Union, 2026") into
 * { family, kind, version, port, id }. id is the canonical ledger id, or
 * null when the licence cannot be read or is not one we allow.
 * family: "cc" | "cc0" | "pd" | "eu" | "unknown".
 */
export function readLicence(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { family: "unknown", kind: null, version: null, port: null, id: null, raw: s };
  if (ALLOWED_IDS.has(s)) return fromCanonical(s);
  const low = s.toLowerCase();

  if (/^©\s*european union\b/i.test(s) || /\beu(ropean union)? (free )?reuse\b/i.test(s) || /2011\/833\/eu/i.test(s)) {
    return { family: "eu", kind: null, version: null, port: null, id: "eu-reuse-credit", raw: s };
  }
  if (/\bcc0\b|\bcc[- ]zero\b|publicdomain\/zero\/|public domain dedication \(cc0/i.test(s)) {
    return { family: "cc0", kind: null, version: "1.0", port: null, id: "cc0-1.0", raw: s };
  }
  if (/^(public domain|pd)$/i.test(s) || /publicdomain\/mark\//i.test(s) || /^public domain mark/i.test(s)) {
    // Public domain with no stated basis: readable, but not allowed until a basis is given.
    return { family: "pd", kind: null, version: null, port: null, id: null, raw: s };
  }

  const isCc = /\bcc\b|creative ?commons|creativecommons\.org\/licenses\//i.test(low) || /^cc-/.test(low);
  if (!isCc) return { family: "unknown", kind: null, version: null, port: null, id: null, raw: s };

  let kind = null;
  const url = low.match(/creativecommons\.org\/licenses\/([a-z-]+)\/(\d\.\d)(?:\/([a-z]{2,3}))?/);
  if (url) kind = url[1];
  else {
    const body = low.replace(/^cc[- ]?/, "");
    for (const [k, re] of CC_KIND_WORDS) {
      if (re.test(body) || re.test(low)) {
        kind = k;
        break;
      }
    }
  }
  if (kind === "by-nd-nc") kind = "by-nc-nd";
  // A non-commercial or no-derivatives term in any spelling ("BYNC", "by_nc",
  // "Non Commercial", "NoDerivatives") fails before the kind match can call it BY.
  if (NC_ND.test(low)) kind = kind === "by" || kind === "by-sa" || !kind ? "nc-or-nd" : kind;
  const vm = url ? [null, url[2]] : low.match(/(?:^|[^\d.])(\d\.\d)(?![\d.])/);
  const version = vm ? vm[1] : null;
  const port = url?.[3] ?? low.match(/\d\.\d[- ]([a-z]{2,3})\b/)?.[1] ?? null;
  const allowedKind = kind === "by" || kind === "by-sa";
  const id = allowedKind && version && (kind === "by-sa" ? SA_VERSIONS : CC_VERSIONS).includes(version) ? `cc-${kind}-${version}` : null;
  return { family: "cc", kind, version, port, id, raw: s };
}

function fromCanonical(id) {
  if (PD_BASES.includes(id)) return { family: "pd", kind: null, version: null, port: null, id, raw: id };
  if (id === "cc0-1.0") return { family: "cc0", kind: null, version: "1.0", port: null, id, raw: id };
  if (id === "eu-reuse-credit") return { family: "eu", kind: null, version: null, port: null, id, raw: id };
  if (id === OWN_PROPERTY) return { family: "own", kind: null, version: null, port: null, id, raw: id };
  if (id === EDITORIAL_USE) return { family: "editorial", kind: null, version: null, port: null, id, raw: id };
  if (id === FAIR_USE) return { family: "fair-use", kind: null, version: null, port: null, id, raw: id };
  const m = id.match(/^cc-(by|by-sa)-(\d\.\d)$/);
  return { family: "cc", kind: m[1], version: m[2], port: null, id, raw: id };
}

/** The human name of a canonical id: "CC BY-SA 2.0", "Public domain (US federal work)". */
export function licenceName(id) {
  if (id === "pd-us-federal") return "Public domain (US federal government work)";
  if (id === "pd-age") return "Public domain (copyright expired)";
  if (id === "pd-dedication") return "Public domain (dedicated by the author)";
  if (id === "cc0-1.0") return "CC0 1.0";
  if (id === "eu-reuse-credit") return "EU reuse with credit (Commission Decision 2011/833/EU)";
  if (id === OWN_PROPERTY) return "Own property (void news, the same owner's publication)";
  if (id === EDITORIAL_USE) return "Editorial use under the publisher's stated terms";
  if (id === FAIR_USE) return "Fair-use excerpt (evidence of coverage, The Weight only)";
  const m = String(id).match(/^cc-(by|by-sa)-(\d\.\d)$/);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  return String(id);
}

/** The licence's deed and legal text addresses, and what it lets us do, for the dispute packet. */
export function licenceTerms(id, item = null) {
  const m = String(id).match(/^cc-(by|by-sa)-(\d\.\d)$/);
  if (m) {
    const deed = `https://creativecommons.org/licenses/${m[1]}/${m[2]}/`;
    const sa = m[1] === "by-sa";
    return {
      id,
      name: licenceName(id),
      deed_url: deed,
      legalcode_url: `${deed}legalcode`,
      terms: sa
        ? "Anyone may copy, adapt and share the work, including commercially, provided the author is credited, the licence is named, changes are indicated, and adaptations are shared under the same or a compatible licence. The episode is published under CC BY-SA 4.0."
        : "Anyone may copy, adapt and share the work, including commercially, provided the author is credited, the licence is named and changes are indicated.",
    };
  }
  if (id === "cc0-1.0") {
    return {
      id,
      name: licenceName(id),
      deed_url: "https://creativecommons.org/publicdomain/zero/1.0/",
      legalcode_url: "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
      terms: "The author has waived all copyright and related rights worldwide, to the extent the law allows. No permission or credit is required.",
    };
  }
  if (id === "pd-us-federal") {
    return {
      id,
      name: licenceName(id),
      deed_url: "https://www.copyright.gov/title17/92chap1.html#105",
      legalcode_url: "https://www.law.cornell.edu/uscode/text/17/105",
      terms: "A work prepared by an officer or employee of the United States Government as part of their official duties is not protected by copyright in the United States (17 U.S.C. 105).",
    };
  }
  if (id === "pd-age") {
    return {
      id,
      name: licenceName(id),
      deed_url: "https://www.copyright.gov/help/faq/faq-duration.html",
      legalcode_url: "https://www.law.cornell.edu/uscode/text/17/304",
      terms: "The work's term of copyright has ended, so it is in the public domain. The ledger's basis states why.",
    };
  }
  if (id === "pd-dedication") {
    // No deed exists for a plain dedication: the item's own statement is the evidence.
    return {
      id,
      name: licenceName(id),
      deed_url: item?.licence_evidence?.url ?? null,
      legalcode_url: null,
      terms: "The author has released the work into the public domain by an explicit statement, quoted in the licence evidence.",
    };
  }
  if (id === "eu-reuse-credit") {
    return {
      id,
      name: licenceName(id),
      deed_url: "https://commission.europa.eu/legal-notice_en",
      legalcode_url: "https://eur-lex.europa.eu/eli/dec/2011/833/oj",
      terms: "European Commission material may be reused, including commercially, provided the source is acknowledged with the credit the item states (© European Union, year) and the meaning is not distorted.",
    };
  }
  if (id === OWN_PROPERTY) {
    // No licence was granted: the page is our own publication, and its capture record is the evidence.
    return {
      id,
      name: licenceName(id),
      deed_url: item?.licence_evidence?.url ?? null,
      legalcode_url: null,
      terms: "void news is published by the same owner as void omnibus. Its printed pages are our own work, shown as they were served, cropped to regions holding no other publisher's picture.",
    };
  }
  if (id === EDITORIAL_USE) {
    // The publisher's own terms page is the deed; its text and restrictions are quoted in the item's terms record.
    return {
      id,
      name: licenceName(id),
      deed_url: item?.terms?.url ?? item?.licence_evidence?.url ?? null,
      legalcode_url: null,
      terms: `Published free for news or editorial use under the publisher's terms, quoted in the licence evidence; the required credit is carried${item?.terms?.restrictions?.length ? `; restrictions: ${item.terms.restrictions.join("; ")}` : ""}. Not relicensed under the episode's CC BY-SA 4.0.`,
    };
  }
  if (id === FAIR_USE) {
    return {
      id,
      name: licenceName(id),
      deed_url: "https://www.copyright.gov/fair-use/",
      legalcode_url: "https://www.law.cornell.edu/uscode/text/17/107",
      terms: "A short excerpt shown as evidence of how an outlet covered the story (17 U.S.C. 107), with the outlet named on screen and its own sound; the item's rationale states the four factors. Not relicensed under the episode's CC BY-SA 4.0, and the episode carrying it is not uploaded to YouTube.",
    };
  }
  return { id, name: String(id), deed_url: null, legalcode_url: null, terms: null };
}

// ---------------------------------------------------------------------------
// The denylist: sources and marks that fail whatever licence they claim.
// ---------------------------------------------------------------------------

/** Hosts whose material is never used (agencies, stock, networks and outlets, UN Web TV). Subdomains included. */
export const DENIED_HOSTS = [
  // agencies and stock
  "apnews.com", "ap.org", "apimages.com", "reuters.com", "reutersconnect.com", "afp.com", "gettyimages.com",
  "gettyimages.co.uk", "istockphoto.com", "shutterstock.com", "alamy.com", "pexels.com", "pixabay.com", "unsplash.com",
  // networks and outlets: outlet photographs are never used (bible section f)
  "aljazeera.com", "aljazeera.net", "bbc.co.uk", "bbc.com", "bbci.co.uk", "cnn.com", "nbcnews.com", "nbc.com",
  "cbsnews.com", "cbs.com", "abcnews.go.com", "abc.net.au", "foxnews.com", "fox.com", "news.sky.com", "sky.com",
  "dw.com", "france24.com", "rferl.org", "euronews.com", "rt.com", "cgtn.com", "nytimes.com",
  "washingtonpost.com", "theguardian.com", "msnbc.com", "npr.org", "pbs.org",
  // UN Web TV
  "webtv.un.org", "media.un.org",
  // agency video, pool and syndication feeds (S4 review, 2026-11-13): C-SPAN, AP Archive, EPA, Bloomberg, Ruptly, Storyful, Xinhua, CCTV
  "c-span.org", "aparchive.com", "epa.eu", "epaimages.com", "bloomberg.com", "ruptly.tv", "storyful.com", "xinhuanet.com", "news.cn", "cctv.com", "cntv.cn",
];

/** The networks and outlets among DENIED_HOSTS: the only hosts a fair-use excerpt may come from. */
export const OUTLET_HOSTS = [
  "aljazeera.com", "aljazeera.net", "bbc.co.uk", "bbc.com", "bbci.co.uk", "cnn.com", "nbcnews.com", "nbc.com",
  "cbsnews.com", "cbs.com", "abcnews.go.com", "abc.net.au", "foxnews.com", "fox.com", "news.sky.com", "sky.com",
  "dw.com", "france24.com", "rferl.org", "euronews.com", "rt.com", "cgtn.com", "nytimes.com",
  "washingtonpost.com", "theguardian.com", "msnbc.com", "npr.org", "pbs.org",
];
const OUTLET_NAME = "a news network or outlet";

/** Names in a credit, author, title or description that mark agency, stock or outlet material. */
export const DENIED_NAMES = [
  { name: "AP", re: /\bAssociated Press\b|\bAP (Photo|Images|Video|Archive|Newsroom)\b|\bAPTN\b|\(AP\)|©\s*AP\b|\b(photo|credit|source|image|video)[:\s]+AP\b/i },
  { name: "AP", creditOnly: true, re: /^\s*AP\s*$/ },
  { name: "Reuters", re: /\bReuters\b/i },
  { name: "Getty Images", re: /\bGetty\b|\biStock(photo)?\b/i },
  { name: "AFP", re: /\bAFP\b|Agence France[- ]Presse/i },
  { name: "stock library", re: /\b(Shutterstock|Alamy|Unsplash|Pexels|Pixabay)\b/i },
  { name: "UN Web TV", re: /\bUN Web TV\b|\bwebtv\.un\.org\b/i },
  // S4 review (2026-11-13): a broadcaster's or agency's feed carried inside a federal or Commons item.
  { name: "C-SPAN", re: /\bC-?SPAN\b|\bc-span\.org\b/i },
  { name: "Ruptly", re: /\bRuptly\b/i },
  { name: "Storyful", re: /\bStoryful\b/i },
  { name: "Xinhua", re: /\bXinhua\b/i },
  // EPA the photo agency (EPA-EFE, "EPA/", "© EPA", "Photo: EPA", a bare "EPA" credit), never the US Environmental Protection Agency spelt out.
  { name: "EPA (European Pressphoto Agency)", re: /\bEPA[-‐ ]?EFE\b|\bEPA\s*\/|\/\s*EPA\b|©\s*EPA\b|\b(photo|credit|source|image|video)[:\s]+EPA\b|European Pressphoto Agency/i },
  { name: "EPA (European Pressphoto Agency)", creditOnly: true, re: /^\s*EPA\s*$/i },
  // Named as a subject (Michael Bloomberg, a CCTV camera, a swimming pool) these are not a source: credits only.
  { name: "Bloomberg", creditOnly: true, re: /\bBloomberg\b/i },
  { name: "CCTV", creditOnly: true, re: /\bCCTV\b|China Central Television/ },
  { name: "a pool feed", creditOnly: true, re: /\bpool\b/i },
  {
    name: OUTLET_NAME,
    creditOnly: true,
    re: /\b(Al Jazeera|BBC|CNN|NBC( News)?|CBS( News)?|ABC News|Fox News|FOX|Sky News|Deutsche Welle|DW News|France ?24|Radio Free Europe|RFE\/RL|Euronews|RT|CGTN|MSNBC|NPR|PBS|New York Times|Washington Post|The Guardian)\b/,
  },
];

/** A logo (network logos and any other trademark artwork) is never a picture. */
export const LOGO = /\blogo(s|type|types)?\b|\bwordmark\b/i;

/** Signals that a picture was made or altered by a generative model. */
// Names that mean a generator wherever they appear.
const AI_TOOLS_ALONE =
  "Stable Diffusion|SDXL|DALL[·.\\- ]?E|Midjourney|ChatGPT|Ideogram|Leonardo\\.?Ai|Craiyon|NovelAI|Bing Image Creator|Copilot Designer|Adobe Firefly|Google Imagen|OpenAI Sora|Runway Gen-?\\d|Topaz (Gigapixel|Photo AI|Video AI)|Remini|DeepAI|NightCafe|Dream ?Studio|Playground ?AI|Recraft|Meta AI|Grok Imagine|Gemini Nano Banana|Nano Banana";
// Names that are also ordinary words or programmes (Project Gemini, a flux tube): only after "generated by/with/using".
const AI_TOOLS = `${AI_TOOLS_ALONE}|Firefly|Imagen|Flux|Sora|Runway|GPT-4o?|OpenAI|Gemini|Grok|Kling|Pika|Luma|Krea|Topaz|neural network|diffusion model|GAN|machine learning`;
// "AI" is matched case-sensitively and as a whole word, so "Aiken", "aid" and "Aix" are not it.
// The rest of a pattern is case-insensitive; the flag cannot be split, so each word's cases are spelled out.
const anyCase = (alts) =>
  alts
    .split("|")
    .map((w) => `(?:${w}|${w[0].toUpperCase()}${w.slice(1)}|${w.toUpperCase()})`)
    .join("|");
const VERBS_MADE = anyCase("generated|created|made|rendered|produced|imagined");
const VERBS_FIXED = anyCase("upscal|colori[sz]|colouri[sz]|enhanc|restor|interpolat");
const PREPS = anyCase("by|with|using|via");
const BARE_AI = "AI(?![A-Za-z0-9])";
export const AI_MARKS = [
  /\bAI[- ]generated\b/i,
  /\bAI[- ]assisted\b/i,
  /\bAI[- ](created|made|art|image|enhanced|upscaled|colori[sz]ed|restored|edited)\b/i,
  new RegExp(`\\b(?:${VERBS_MADE}) (?:${PREPS}) (?:(?:${anyCase("an?|the")}) )?${BARE_AI}`),
  new RegExp(`\\b(generated|created|made|rendered|produced|imagined) (by|with|using|via) (an? |the )?(artificial intelligence|${AI_TOOLS})\\b`, "i"),
  new RegExp(`\\b(${AI_TOOLS_ALONE})\\b`, "i"),
  new RegExp(`\\b(?:${VERBS_FIXED})\\w* (?:${PREPS}) (?:(?:${anyCase("an?")}) )?${BARE_AI}`),
  /\b(upscal|colou?ri[sz]|enhanc|restor|interpolat)\w* (by|with|using) (an? )?(artificial intelligence|machine learning|neural)/i,
  /\bdeep ?fakes?\b/i,
  /\btext[- ]to[- ](image|video)\b/i,
  /\bPD[- ]algorithm\b/i,
  /\bsynthetic (image|media|video|photo)/i,
  // IPTC digital source types, matched anywhere (they arrive glued to namespaces: ".../trainedAlgorithmicMedia")
  /trainedAlgorithmicMedia|compositeSynthetic|algorithmicMedia|compositeWithTrainedAlgorithmicMedia/i,
];
/**
 * In a category or tag, a bare "AI" is enough ("AI images", "Art by AI"): a
 * standalone uppercase token, not a flight number ("Air India Flight AI171").
 */
const AI_WORD = /(?<![A-Za-z0-9])AI(?![A-Za-z0-9])/;
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function hostMatches(host, list) {
  if (!host) return false;
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Every reason a candidate's text fields put it on the denylist. */
export function deniedBy({ urls = [], texts = [], tags = [], credits = [], allowOutlets = false }) {
  const reasons = [];
  for (const u of urls) {
    const host = hostOf(u);
    // A fair-use excerpt is an outlet's own clip: its host is the outlet's; agencies and stock stay refused.
    if (host && hostMatches(host, DENIED_HOSTS) && !(allowOutlets && hostMatches(host, OUTLET_HOSTS))) reasons.push(`denied source host ${host}`);
  }
  const creditTexts = credits.filter(Boolean).map(String);
  const joined = [...texts.filter(Boolean).map(String), ...creditTexts];
  for (const { name, re, creditOnly } of DENIED_NAMES) {
    if (allowOutlets && name === OUTLET_NAME) continue;
    // An outlet named in a title or description is a subject; named in a credit, it is the source.
    if ((creditOnly ? creditTexts : joined).some((t) => re.test(t))) reasons.push(`denied source: ${name} material`);
  }
  for (const t of [...joined, ...tags.map(String)]) {
    if (LOGO.test(t)) {
      reasons.push("a logo is never used");
      break;
    }
  }
  return [...new Set(reasons)];
}

/**
 * On-screen marks (S4 review, 2026-11-13; second round). A picture's frames can carry another
 * party's bug (a C-SPAN or network logo, an agency's lower third) or a call to action (a QR
 * code, "TEXT POTUS TO 45470") that no metadata states. The record of a frame check is
 * marks_checked: { marks: [the marks seen, [] for none], reviewed: { by, at, frames, contact_sheet,
 * duration_s? }, mask? }:
 * - reviewed.by names the checking role: verifier, cos or founder (MARKS_REVIEWERS), never the
 *   builder or the sourcer who chose the item (CoS ruling (b), 2026-11-13);
 * - reviewed.frames lists the timestamps looked at (seconds into the file), at least one in every
 *   30 s of the aired span: the item's fit in_s..out_s, else the whole file (reviewed.duration_s);
 * - reviewed.contact_sheet { path, sha256 } names the sheet of those frames;
 * - for a video, reviewed.cuts { times, threshold, method } lists every cut in the file (seconds; [] for
 *   a single shot), the scene threshold and the method that found them (ffmpeg select=gt(scene,0.3)); every shot
 *   inside the aired span (between consecutive cuts) holds at least one of the frames (S4 review
 *   round 3: a montage is reviewed shot by shot, not one frame per 30 s).
 * Until a frame reader exists, a VOA item and a YouTube copy on Commons ({{From YouTube}},
 * video2commons) need a reviewed record; any item whose marks name a denied party (C-SPAN
 * included) is refused, and so is one whose marks carry a call to action (CTA_MARK) unless
 * mask { covers: [those marks], region: {x, y, w, h} } records the mask (the shot is then
 * alteration-marked, RECONSTRUCTED).
 */
export const MARKS_REVIEWERS = ["verifier", "cos", "founder"];
export const MARKS_FRAME_EVERY_S = 30;
const REVIEWER = /^\s*(verifier|cos|founder)\b/i;
const NOT_REVIEWER = /\b(builder|sourcer|sourcing)\b/i;
/** A call to action on screen: an engagement mechanic void never airs (values: no engagement mechanics). */
export const CTA_MARK = /QR code|TEXT .* TO \d{4,6}|scan (the|this)|text .* to \d{4,6}/i;

/**
 * A YouTube origin named in a credit or source text ("YouTube: <title>", "<title> (on Youtube)",
 * a youtube.com or youtu.be address): the matched words, or null.
 */
export function youtubeInText(texts = []) {
  for (const t of (Array.isArray(texts) ? texts : [texts]).filter(Boolean).map(String)) {
    const m = t.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S*|^\s*YouTube\s*:|\(\s*on\s+YouTube\s*\)/im);
    if (m) return m[0].trim().slice(0, 120);
  }
  return null;
}

/** The YouTube origin a ledger item shows: its youtube_source, else one its captured Credit, Artist or Source line or its credit names. */
export function youtubeOrigin(item) {
  if (item?.youtube_source) return String(item.youtube_source);
  const lines = String(item?.licence_evidence?.captured_text ?? "").split("\n").filter((l) => /^(?:Credit|Artist|Source):/i.test(l)).map((l) => l.replace(/^[A-Za-z]+:\s*/, ""));
  const hit = youtubeInText([...lines, item?.credit]);
  return hit ? `credit ${hit}` : null;
}

export function needsMarksCheck(item) {
  return item?.adapter === "voa" || (item?.kind === "footage" && Boolean(youtubeOrigin(item)));
}

/** The span the frames must cover: [in_s, out_s] from the item's fit, else [0, duration_s]; null when neither is known. */
export function airedSpan(item, reviewed = item?.marks_checked?.reviewed) {
  const f = item?.fit ?? {};
  if (Number.isFinite(f.in_s) && Number.isFinite(f.out_s) && f.out_s > f.in_s) return [f.in_s, f.out_s];
  const d = reviewed?.duration_s;
  return Number.isFinite(d) && d > 0 ? [0, d] : null;
}

/** Whether the item is a moving picture (its marks review must name its cuts). */
export function isVideo(item) {
  return item?.kind === "footage" || /^video\//i.test(String(item?.mime ?? ""));
}

/**
 * The shots of the aired span [a, b] that no frame falls in: the span cut at every cut inside it, each shot
 * [from, to) holding a frame from its first frame up to the next cut (the last shot up to b, inclusive).
 */
export function unseenShots(frames, cuts, [a, b]) {
  const inner = [...new Set(cuts.filter((c) => c > a + 1e-6 && c < b - 1e-6))].sort((x, y) => x - y);
  const edges = [a, ...inner, b];
  const out = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const lo = edges[k];
    const hi = edges[k + 1];
    const last = k === edges.length - 2;
    if (!frames.some((t) => t >= lo - 1e-6 && (last ? t <= hi + 1e-6 : t < hi - 1e-6))) out.push([+lo.toFixed(2), +hi.toFixed(2)]);
  }
  return out;
}

/** The 30 s windows of a span that no frame falls in (each window [from, to], inclusive). */
export function uncoveredWindows(frames, [a, b], every = MARKS_FRAME_EVERY_S) {
  const n = Math.max(1, Math.ceil((b - a) / every - 1e-9));
  const w = (b - a) / n;
  const out = [];
  for (let k = 0; k < n; k++) {
    const lo = a + k * w;
    const hi = a + (k + 1) * w;
    if (!frames.some((t) => t >= lo - 1e-6 && t <= hi + 1e-6)) out.push([+lo.toFixed(2), +hi.toFixed(2)]);
  }
  return out;
}

/** Why a marks review cannot stand: the role, the time, the frames over the aired span, the contact sheet. */
export function reviewProblems(r, item, where = "marks_checked.reviewed") {
  const out = [];
  if (!r || typeof r !== "object") return [`${where} must be { by, at, frames, contact_sheet }`];
  const by = String(r.by ?? "");
  if (!REVIEWER.test(by) || NOT_REVIEWER.test(by)) out.push(`${where}.by must name the checking role (${MARKS_REVIEWERS.join(", ")}), never the builder or the sourcer: "${by.slice(0, 80)}"`);
  if (!Number.isFinite(Date.parse(String(r.at ?? "")))) out.push(`${where}.at must be an ISO date-time`);
  const frames = r.frames;
  if (!(Array.isArray(frames) && frames.length >= 1 && frames.every((t) => typeof t === "number" && Number.isFinite(t) && t >= 0))) {
    out.push(`${where}.frames must list the timestamps looked at (seconds into the file, at least one)`);
  } else {
    const span = airedSpan(item, r);
    if (!span) out.push(`${where}.duration_s must state the file's length: the item's fit names no in_s..out_s, so the frames cover the whole file`);
    else {
      const gaps = uncoveredWindows(frames, span);
      if (gaps.length) out.push(`${where}.frames must hold one frame in every ${MARKS_FRAME_EVERY_S} s of the aired span ${span[0]}..${span[1]} s; none in ${gaps.map(([lo, hi]) => `${lo}..${hi} s`).join(", ")}`);
    }
    if (isVideo(item)) {
      const cuts = r.cuts?.times;
      if (!(Array.isArray(cuts) && cuts.every((t) => typeof t === "number" && Number.isFinite(t) && t >= 0) && typeof r.cuts.threshold === "number" && r.cuts.threshold > 0 && r.cuts.threshold <= 1 && String(r.cuts.method ?? "").trim())) {
        out.push(`${where}.cuts must be { times, threshold, method }: every cut in the video (seconds; [] for a single shot), the scene threshold and the method that found them (ffmpeg select=gt(scene,0.3)), so every shot of the aired span is looked at`);
      } else if (!String(r.cuts.ffmpeg ?? "").trim()) {
        out.push(`${where}.cuts.ffmpeg must name the ffmpeg that found the cuts in the file: the fetch step finds them itself (scripts/lib/rights/scenes.mjs), a reported cut list is never trusted (rights fix round 4)`);
      } else if (span) {
        const unseen = unseenShots(frames, cuts, span);
        if (unseen.length) out.push(`${where}.frames must hold a frame in every shot of the aired span ${span[0]}..${span[1]} s (${cuts.length} cuts at threshold ${r.cuts.threshold}); ${unseen.length} shot(s) unseen: ${unseen.slice(0, 12).map(([lo, hi]) => `${lo}..${hi} s`).join(", ")}${unseen.length > 12 ? ", ..." : ""}`);
      }
    }
  }
  const cs = r.contact_sheet;
  if (!(cs && typeof cs.path === "string" && cs.path.trim() && /^[0-9a-f]{64}$/.test(String(cs.sha256 ?? "")))) out.push(`${where}.contact_sheet must be { path, sha256 } naming the sheet of those frames`);
  return out;
}

/**
 * Why an item's bodies record cannot stand (GRAMMAR 1.6; CoS ruling, rights fix round 4): a file that
 * shows bodies airs only with bodies_excluded { from_s, to_s, note } naming those seconds and a fit
 * in_s..out_s clear of them; bodies_excluded beside anything but shows_bodies: true is refused.
 */
export function bodiesProblems(item) {
  const b = item?.bodies_excluded;
  if (item?.shows_bodies !== true) return b ? ["bodies_excluded is stated, and shows_bodies is not true"] : [];
  if (!(b && Number.isFinite(b.from_s) && Number.isFinite(b.to_s) && b.to_s > b.from_s && String(b.note ?? "").trim())) return ["the file shows bodies and names no bodies_excluded { from_s, to_s, note }: it never airs"];
  const f = item.fit ?? {};
  if (!(Number.isFinite(f.in_s) && Number.isFinite(f.out_s) && f.out_s > f.in_s)) return [`the file shows bodies at ${b.from_s}..${b.to_s} s and its fit names no in_s..out_s that leaves them out`];
  if (!(f.out_s <= b.from_s || f.in_s >= b.to_s)) return [`its fit ${f.in_s}..${f.out_s} s overlaps the bodies at ${b.from_s}..${b.to_s} s`];
  return [];
}

/** The CTA marks a mask does not cover. */
export function unmaskedCtas(marks, mask) {
  const covers = Array.isArray(mask?.covers) ? mask.covers.map(String) : [];
  const r = mask?.region;
  const located = r && ["x", "y", "w", "h"].every((k) => Number.isFinite(r[k])) && r.w > 0 && r.h > 0;
  return (marks ?? []).filter((m) => typeof m === "string" && CTA_MARK.test(m) && !(located && covers.includes(m)));
}

/** Why an item's marks_checked record is missing, malformed, or names a denied party or an unmasked call to action. */
export function marksProblems(item) {
  const out = [];
  const m = item?.marks_checked;
  if (m === undefined || m === null) {
    if (needsMarksCheck(item)) out.push(`${item.adapter === "voa" ? "a VOA item" : `a YouTube copy (${String(youtubeOrigin(item)).slice(0, 120)})`} needs a reviewed marks_checked record (the on-screen marks in its frames) until a frame reader exists`);
    return out;
  }
  const marks = Array.isArray(m.marks) ? m.marks : null;
  if (!marks || marks.some((x) => typeof x !== "string" || !x.trim())) out.push("marks_checked.marks must list the marks seen (strings; [] for none)");
  out.push(...reviewProblems(m.reviewed, item));
  // A mark is described in words ("White House logo, lower left"): only the parties it names count, not the word logo.
  for (const reason of deniedBy({ credits: marks ?? [] }).filter((x) => x !== "a logo is never used")) out.push(`an on-screen mark names a denied party: ${reason}`);
  for (const cta of unmaskedCtas(marks, m.mask)) out.push(`an on-screen mark is a call to action (an engagement mechanic): "${cta.slice(0, 120)}"; refused unless marks_checked.mask { covers, region } records its mask and the shot is alteration-marked`);
  return out;
}

/** Every AI signal found in the given text fields and tags (empty when none). */
export function aiSignals(fields, { categories = [] } = {}) {
  const found = [];
  for (const c of categories.filter(Boolean).map(String)) {
    if (AI_WORD.test(c)) found.push(c.length > 160 ? `${c.slice(0, 157)}...` : c);
  }
  for (const f of [...fields, ...categories].filter(Boolean).map(String)) {
    for (const re of AI_MARKS) {
      if (re.test(f)) {
        found.push(f.length > 160 ? `${f.slice(0, 157)}...` : f);
        break;
      }
    }
  }
  return [...new Set(found)];
}

/**
 * Whether a ledger item's licence passes: the id is on the allowlist, public
 * domain names a basis, CC BY and BY-SA carry a credit, and EU reuse carries
 * the mandatory "© European Union, <year>" credit. Returns the problems.
 */
export function licenceProblems(item) {
  const out = [];
  const id = item?.licence;
  if (id === EDITORIAL_USE) {
    out.push(`licence "${id}" is closed: no adapter fetches the terms page yet, and only a terms page on the reviewed list (REVIEWED_TERMS_PAGES) may admit it`);
    out.push(...editorialTermsProblems(item.terms, String(item.credit ?? "").trim()));
    return [...new Set(out)];
  }
  if (!ALLOWED_IDS.has(id)) {
    const read = readLicence(id);
    out.push(
      read.family === "pd"
        ? `licence "${id}": public domain needs its basis (US federal, by age, or by explicit dedication)`
        : `licence "${id}" is not on the allowlist (PD, CC0, CC BY 1 to 4, CC BY-SA 1 to 4, EU reuse with credit)`,
    );
    return out;
  }
  const credit = String(item.credit ?? "").trim();
  if (PD_BASES.includes(id) && !String(item.basis ?? "").trim()) out.push(`licence "${id}" has no basis`);
  if (id === OWN_PROPERTY) {
    if (!String(item.basis ?? "").trim()) out.push(`licence "${id}" has no basis`);
    // Only a capture of void news's own page may claim it; the adapter is always known by the ledger and the fetcher.
    if (item.adapter !== OWN_ADAPTER) out.push(`licence "${id}" is claimed only by void news's own pages (adapter ${OWN_ADAPTER}), not by ${item.adapter ?? "an unnamed adapter"}`);
  }
  if (id === FAIR_USE && !item.fair_use) out.push(`licence "${id}" needs its fair_use record (rationale, excerpt bounds, outlet, rung)`);
  if (/^cc-by/.test(id) && !credit) out.push(`licence "${id}" requires a credit, and the item has none`);
  if (id === "eu-reuse-credit" && !EU_CREDIT.test(credit)) {
    out.push(`EU reuse requires the credit "© European Union, <year>"; the item's credit is "${credit}"`);
  }
  return out;
}

/**
 * The reviewed allowlist of institutional terms pages (S4 review, 2026-11-13): an
 * editorial-use item's terms page must be on it, with the exact text that was
 * reviewed (its sha256, whitespace-normalised). A keyword reading of terms is
 * never enough ("Editorial use is prohibited" names editorial use). Each entry:
 * { url, text_sha256, institution, reviewed: { by, at } }. Empty: none reviewed yet.
 */
export const REVIEWED_TERMS_PAGES = Object.freeze([]);

/** The sha256 of a terms page's text, whitespace-normalised, as the reviewed list records it. */
export function termsTextSha(text) {
  return createHash("sha256").update(String(text ?? "").replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

/**
 * Why an editorial-use item's terms record does not let it in: the terms page
 * must be captured (https url, quoted text), must be a reviewed institutional
 * terms page with exactly the reviewed text, must name the credit the item
 * carries, and must list its restrictions (an empty list states there are none).
 */
export function editorialTermsProblems(terms, credit = "", { reviewed = REVIEWED_TERMS_PAGES } = {}) {
  const out = [];
  if (!terms || typeof terms !== "object") return ["editorial-use needs its terms record (the terms page, its text, the required credit, the restrictions)"];
  if (!/^https:\/\//.test(String(terms.url ?? ""))) out.push("the terms page address must be https");
  const text = String(terms.captured_text ?? "");
  if (!text.trim()) out.push("the terms page text is not captured");
  const page = reviewed.find((r) => r.url === terms.url);
  if (!page) out.push(`the terms page ${String(terms.url ?? "(none)").slice(0, 200)} is not on the reviewed list of institutional terms pages`);
  else if (!page.reviewed?.by || !page.reviewed?.at) out.push(`the reviewed terms page ${page.url} names no review (by, at)`);
  else if (text.trim() && termsTextSha(text) !== page.text_sha256) out.push(`the captured terms text differs from the reviewed text of ${page.url} (sha256 ${termsTextSha(text).slice(0, 12)}, reviewed ${String(page.text_sha256).slice(0, 12)})`);
  const req = String(terms.credit_required ?? "").trim();
  if (!req) out.push("the terms record names no required credit");
  else if (!String(credit).includes(req)) out.push(`the item's credit "${credit}" does not carry the required credit "${req}"`);
  if (!Array.isArray(terms.restrictions)) out.push("the terms record lists no restrictions (an empty list states there are none)");
  return out;
}
