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

/** CC licence versions that exist (1.0 to 4.0; 2.1 only as Japanese ports). */
export const CC_VERSIONS = ["1.0", "2.0", "2.1", "2.5", "3.0", "4.0"];

/** The three public-domain bases the bible allows. */
export const PD_BASES = ["pd-us-federal", "pd-age", "pd-dedication"];

/** Every canonical licence id that passes. Anything else fails the gate. */
export const ALLOWED_IDS = new Set([
  ...PD_BASES,
  "cc0-1.0",
  ...CC_VERSIONS.map((v) => `cc-by-${v}`),
  ...CC_VERSIONS.map((v) => `cc-by-sa-${v}`),
  "eu-reuse-credit",
]);

/** The credit the EU's reuse decision makes mandatory: "© European Union, 2026". */
export const EU_CREDIT = /^© European Union, (19|20)\d\d\b/;

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
  const vm = url ? [null, url[2]] : low.match(/(?:^|[^\d.])(\d\.\d)(?![\d.])/);
  const version = vm ? vm[1] : null;
  const port = url?.[3] ?? low.match(/\d\.\d[- ]([a-z]{2,3})\b/)?.[1] ?? null;
  const allowedKind = kind === "by" || kind === "by-sa";
  const id = allowedKind && version && CC_VERSIONS.includes(version) ? `cc-${kind}-${version}` : null;
  return { family: "cc", kind, version, port, id, raw: s };
}

function fromCanonical(id) {
  if (PD_BASES.includes(id)) return { family: "pd", kind: null, version: null, port: null, id, raw: id };
  if (id === "cc0-1.0") return { family: "cc0", kind: null, version: "1.0", port: null, id, raw: id };
  if (id === "eu-reuse-credit") return { family: "eu", kind: null, version: null, port: null, id, raw: id };
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
  const m = String(id).match(/^cc-(by|by-sa)-(\d\.\d)$/);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  return String(id);
}

/** The licence's deed and legal text addresses, and what it lets us do, for the dispute packet. */
export function licenceTerms(id) {
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
    return {
      id,
      name: licenceName(id),
      deed_url: "https://creativecommons.org/publicdomain/zero/1.0/",
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
  return { id, name: String(id), deed_url: null, legalcode_url: null, terms: null };
}

// ---------------------------------------------------------------------------
// The denylist: sources and marks that fail whatever licence they claim.
// ---------------------------------------------------------------------------

/** Hosts whose material is never used (agency, stock, UN Web TV). Subdomains included. */
export const DENIED_HOSTS = [
  "apnews.com",
  "ap.org",
  "apimages.com",
  "reuters.com",
  "reutersconnect.com",
  "gettyimages.com",
  "gettyimages.co.uk",
  "istockphoto.com",
  "pexels.com",
  "pixabay.com",
  "webtv.un.org",
  "media.un.org",
];

/** Names in a credit, author, title or description that mark agency or stock material. */
export const DENIED_NAMES = [
  { name: "AP", re: /\bAssociated Press\b|\bAP (Photo|Images|Video)\b|\(AP\)|©\s*AP\b/i },
  { name: "Reuters", re: /\bReuters\b/i },
  { name: "Getty Images", re: /\bGetty\b|\biStock(photo)?\b/i },
  { name: "AFP", re: /\bAFP\b|Agence France[- ]Presse/i },
  { name: "Pexels", re: /\bPexels\b/i },
  { name: "Pixabay", re: /\bPixabay\b/i },
  { name: "UN Web TV", re: /\bUN Web TV\b|\bwebtv\.un\.org\b/i },
];

/** A logo (network logos and any other trademark artwork) is never a picture. */
export const LOGO = /\blogo(s|type|types)?\b|\bwordmark\b/i;

/** Signals that a picture was made by a generative model. */
export const AI_MARKS = [
  /\bAI[- ]generated\b/i,
  /\bAI[- ]assisted\b/i,
  /\bgenerated (by|with|using) (an? )?(AI|artificial intelligence|Stable Diffusion|DALL[·.\- ]?E|Midjourney|Firefly|Imagen|Flux|Sora|Runway)\b/i,
  /\b(Stable Diffusion|DALL[·.\- ]?E|Midjourney|Adobe Firefly|Bing Image Creator|Leonardo\.Ai|Craiyon|NovelAI)\b/i,
  /\btext[- ]to[- ](image|video)\b/i,
  /\bPD[- ]algorithm\b/i,
  /\bsynthetic (image|media|video)\b/i,
  /\btrainedAlgorithmicMedia\b|\bcompositeSynthetic\b|\balgorithmicMedia\b/i,
];

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
export function deniedBy({ urls = [], texts = [], tags = [] }) {
  const reasons = [];
  for (const u of urls) {
    const host = hostOf(u);
    if (host && hostMatches(host, DENIED_HOSTS)) reasons.push(`denied source host ${host}`);
  }
  const joined = texts.filter(Boolean).map(String);
  for (const { name, re } of DENIED_NAMES) {
    if (joined.some((t) => re.test(t))) reasons.push(`denied source: ${name} material`);
  }
  for (const t of [...joined, ...tags.map(String)]) {
    if (LOGO.test(t)) {
      reasons.push("a logo is never used");
      break;
    }
  }
  return [...new Set(reasons)];
}

/** Every AI signal found in the given text fields and tags (empty when none). */
export function aiSignals(fields) {
  const found = [];
  for (const f of fields.filter(Boolean).map(String)) {
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
  if (/^cc-by/.test(id) && !credit) out.push(`licence "${id}" requires a credit, and the item has none`);
  if (id === "eu-reuse-credit" && !EU_CREDIT.test(credit)) {
    out.push(`EU reuse requires the credit "© European Union, <year>"; the item's credit is "${credit}"`);
  }
  return out;
}
