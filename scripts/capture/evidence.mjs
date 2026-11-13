// C4: what the capture keeps beside each item, at fetch time. Per item: the
// item's own page (HTML, or the source's own record where its page host is
// not fetchable) and the governing terms page, each stored gzipped by the
// sha256 of its bytes (identical terms pages dedupe to one blob); captured_at;
// published_at from the source's own field; source_time (the event's own
// date) where the source states one; and the rights adapter's verdict and
// basis. The verdict is never decided here: every candidate runs its
// adapter's lookup() and then checkCandidate (scripts/lib/rights), so a
// tightened rights rule reaches the capture without a change here.
//
// Secrets never reach evidence: every stored text and the record are scrubbed
// of DVIDS_API_KEY and CLOUDFLARE_API_TOKEN, the DVIDS page is its public
// page (no key), and a record that still holds a secret throws.

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import * as commons from "../lib/rights/adapters/commons.mjs";
import * as dvids from "../lib/rights/adapters/dvids.mjs";
import * as gov from "../lib/rights/adapters/gov.mjs";
import * as nasa from "../lib/rights/adapters/nasa.mjs";
import * as voa from "../lib/rights/adapters/voa.mjs";
import { isAllowedUrl } from "../lib/rights/http.mjs";
import { checkCandidate } from "../lib/rights/provenance.mjs";
import { isoSecond } from "../lib/rights/text.mjs";

export const EVIDENCE_SCHEMA = "omnibus.capture-evidence/1";
export const SECRET_ENV = ["DVIDS_API_KEY", "CLOUDFLARE_API_TOKEN"];
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Per source: the adapter that judges it, the ref it takes, the page kept as
 * evidence, and the governing terms page. A null terms page is stated with
 * its reason; such an item's media is refused by lintMedia.
 */
export const SOURCES = {
  commons: { adapter: commons, ref: (it) => it.id, page: (it) => it.url, terms: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia" },
  dvids: { adapter: dvids, ref: (it) => it.id, page: (it) => dvids.publicPageUrl(it.id), terms: dvids.RESTRICTIONS_PAGE },
  voa: { adapter: voa, ref: (it) => it.url, page: (it) => it.url, terms: voa.TERMS_URL },
  // images.nasa.gov and www.nasa.gov are not on the fetcher's allowlist: the page kept is the
  // images-api record the adapter reads, and NASA's media-usage page cannot be fetched until a
  // DECISIONS entry widens the allowlist, so NASA media is kept as metadata only.
  nasa: { adapter: nasa, ref: (it) => it.id, page: (it) => nasa.searchUrl(it.id), terms: null, terms_missing: "NASA's media usage guidelines (www.nasa.gov) are not on the fetcher's allowlist; widening it needs a DECISIONS entry" },
  cdc: { adapter: gov, ref: (it) => it.url, page: (it) => it.url, terms: "https://www.cdc.gov/other/agencymaterials.html", kind: "still" },
  noaa: { adapter: gov, ref: (it) => it.url, page: (it) => it.url, terms: "https://www.noaa.gov/disclaimer", kind: "still" },
  // The White House is a locator: its videos are YouTube embeds, never downloaded; the matching Commons upload is the media.
  whitehouse: { adapter: null, ref: (it) => it.url, page: (it) => it.url, terms: "https://www.whitehouse.gov/copyright/" },
};

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The secret values present in an environment (never their names' absence). */
export function secretsOf(env = process.env) {
  return SECRET_ENV.map((k) => env?.[k]).filter((v) => typeof v === "string" && v.length >= 4);
}

export function scrub(text, secrets) {
  let t = String(text);
  for (const s of secrets) t = t.split(s).join("[REDACTED]");
  for (const s of secrets) t = t.split(encodeURIComponent(s)).join("[REDACTED]");
  return t;
}

function blobOf(text, { kind, url }) {
  const bytes = Buffer.from(text, "utf8");
  return { sha256: sha256(bytes), bytes: bytes.length, gz: gzipSync(bytes), kind, url };
}

/** The text a stored evidence blob holds (for tests and `rights.mjs` readers). */
export function readBlob(gz) {
  return gunzipSync(gz).toString("utf8");
}

async function readPage(http, url) {
  if (!url) return { missing: "no page address" };
  if (!isAllowedUrl(url)) return { missing: `${url} is not on the fetcher's allowlist` };
  try {
    const r = await http.getText(url);
    if (r.status !== "ok") return { missing: `${url} answered ${r.status}` };
    return { text: r.text, contentType: r.contentType ?? null, url: r.url ?? url };
  } catch (err) {
    return { missing: String(err?.message ?? err) };
  }
}

/** Pure: the verdict a lookup answer and checkCandidate give. */
export function verdictOf(found, adapterName) {
  if (!found || found.status !== "ok") {
    return { adapter: adapterName, status: found?.status ?? "not_found", licence: null, basis: null, reasons: [found?.reason ?? "the adapter found no record"].filter(Boolean) };
  }
  const c = found.candidate;
  const check = checkCandidate(c);
  return {
    adapter: adapterName,
    status: check.ok ? "ok" : "refused",
    licence: c.licence ?? null,
    basis: c.basis ?? null,
    credit: c.credit ?? null,
    reasons: check.reasons,
    ai_provenance: check.ai_provenance_check?.status ?? null,
    laundering: check.laundering_check?.status ?? null,
  };
}

/**
 * Fetch-time evidence for one listed item. `http` is the fetcher's
 * { getText, getJson } (or a fake); `termsCache` (url -> blob) is shared by a
 * run so a terms page is fetched once. Returns { record, blobs, candidate }:
 * blobs are { sha256, bytes, gz, kind, url } to store at evidenceKey(sha256).
 */
export async function captureEvidence(item, { http, env = process.env, now = () => new Date(), termsCache = new Map(), sources = SOURCES }) {
  const src = sources[item.source];
  if (!src) throw new Error(`no evidence rule for source ${item.source}`);
  const secrets = secretsOf(env);
  const capturedAt = isoSecond(now().toISOString());
  const blobs = [];

  let found = null;
  let verdict;
  if (!src.adapter) {
    verdict = { adapter: null, status: "locator", licence: null, basis: null, reasons: ["a locator only: its media is the matching upload elsewhere"] };
  } else {
    try {
      found = await src.adapter.lookup(src.ref(item), { http, env, now, kind: src.kind });
      verdict = verdictOf(found, item.source === "cdc" || item.source === "noaa" ? "gov" : item.source);
    } catch (err) {
      verdict = { adapter: item.source, status: "error", licence: null, basis: null, reasons: [String(err?.message ?? err)] };
    }
  }

  const pageUrl = src.page(item);
  const page = await readPage(http, pageUrl);
  let pageRef;
  if (page.text != null) {
    const b = blobOf(scrub(page.text, secrets), { kind: "page", url: scrub(pageUrl, secrets) });
    blobs.push(b);
    pageRef = { url: b.url, sha256: b.sha256, bytes: b.bytes, content_type: page.contentType };
  } else pageRef = { url: pageUrl ? scrub(pageUrl, secrets) : null, sha256: null, missing: scrub(page.missing, secrets) };

  let termsRef;
  if (!src.terms) termsRef = { url: null, sha256: null, missing: src.terms_missing ?? "no governing terms page declared" };
  else {
    let b = termsCache.get(src.terms);
    if (!b) {
      const t = await readPage(http, src.terms);
      b = t.text != null ? blobOf(scrub(t.text, secrets), { kind: "terms", url: src.terms }) : { missing: t.missing };
      termsCache.set(src.terms, b);
    }
    if (b.sha256) {
      blobs.push(b);
      termsRef = { url: src.terms, sha256: b.sha256, bytes: b.bytes };
    } else termsRef = { url: src.terms, sha256: null, missing: scrub(b.missing, secrets) };
  }

  const c = found?.status === "ok" ? found.candidate : null;
  const record = JSON.parse(
    scrub(
      JSON.stringify({
        schema: EVIDENCE_SCHEMA,
        source: item.source,
        id: item.id,
        url: item.url,
        title: item.title ?? null,
        captured_at: capturedAt,
        listed_at: item.captured_at ?? null,
        // The source's own field, never a guess.
        published_at: item.published_at ?? c?.published_at ?? null,
        source_time: item.event_date ?? c?.date ?? null,
        page: pageRef,
        terms: termsRef,
        verdict: { ...verdict, reasons: verdict.reasons.map((r) => scrub(r, secrets)) },
        media_url: c?.media_url ?? null,
      }),
      secrets,
    ),
  );
  assertNoSecrets(record, blobs, secrets);
  return { record, blobs: dedupeBlobs(blobs), candidate: c };
}

function dedupeBlobs(blobs) {
  const seen = new Map();
  for (const b of blobs) if (!seen.has(b.sha256)) seen.set(b.sha256, b);
  return [...seen.values()];
}

/** Throws when a secret survived into a record or a blob. */
export function assertNoSecrets(record, blobs, secrets) {
  const texts = [JSON.stringify(record), ...blobs.map((b) => readBlob(b.gz))];
  for (const s of secrets) if (texts.some((t) => t.includes(s))) throw new Error("a secret reached capture evidence; nothing was stored");
}

/**
 * The lint: why a captured media entry may not be stored, or []. Media needs
 * the page evidence's sha256, the terms page's sha256, captured_at and the
 * source's published_at, and an adapter verdict of ok.
 */
export function lintMedia(entry) {
  const out = [];
  if (!entry?.media) return out;
  const e = entry.evidence ?? {};
  const who = `${entry.source}:${entry.id}`;
  if (!HEX64.test(e.page?.sha256 ?? "")) out.push(`${who}: media without page evidence (sha256)${e.page?.missing ? `: ${e.page.missing}` : ""}`);
  if (!HEX64.test(e.terms?.sha256 ?? "")) out.push(`${who}: media without the governing terms page (sha256)${e.terms?.missing ? `: ${e.terms.missing}` : ""}`);
  if (!isIso(e.captured_at)) out.push(`${who}: media without captured_at`);
  if (!isIso(e.published_at)) out.push(`${who}: media without the source's published_at`);
  if (e.verdict?.status !== "ok") out.push(`${who}: media without an ok adapter verdict (${e.verdict?.status ?? "none"})`);
  if (!HEX64.test(entry.media.sha256 ?? "")) out.push(`${who}: media without its own sha256`);
  return out;
}

/** Every lint problem in a capture index (scripts/lib/capture-store.mjs). */
export function lintIndex(index) {
  return Object.values(index?.items ?? {}).flatMap(lintMedia);
}

function isIso(s) {
  return typeof s === "string" && Number.isFinite(Date.parse(s)) && /^\d{4}-\d\d-\d\dT/.test(s);
}
