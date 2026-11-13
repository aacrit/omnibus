// Polite HTTP for the fetcher: a User-Agent naming void omnibus, a timeout
// per request, retries with backoff on network errors, 429 and 5xx (never on
// 4xx), Retry-After honoured up to a minute, one request at a time, and the
// domain allowlist enforced on every hop: redirects are followed by hand and
// a redirect off the allowlist is refused. Media streams to disk with a byte
// cap and a sha256 computed as it arrives; nothing is buffered whole.
//
// fetchImpl and sleep are injectable so tests never touch the network.

import { createHash } from "node:crypto";
import { createWriteStream, renameSync, rmSync } from "node:fs";
import { once } from "node:events";
import { retryAfterMs } from "../../snapshot.mjs";
import { hostOf } from "./licences.mjs";

export const USER_AGENT = "void-omnibus-rights/1 (+https://omnibus.voidvision.org; asset fetcher, one request at a time)";
/**
 * Every request carries the same honest identity (void omnibus and its
 * contact URL, above) with a browser's ordinary Accept and Accept-Language
 * (founder ruling, chat 2026-11-12). Never a browser's User-Agent, never a
 * rotated identity; a bot challenge is never answered.
 */
export const ACCEPT_TEXT = "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";
export const TIMEOUT_MS = 30_000;
export const MEDIA_TIMEOUT_MS = 600_000;
export const RETRIES = 3;
export const MAX_REDIRECTS = 5;
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
/** No single asset over 2 GiB is fetched (the machine's D: budget, bible section i). */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * The only hosts the fetcher may contact (bible section f: "the fetcher
 * accepts only allowlisted domains"). Exact hosts, no wildcards.
 */
export const FETCH_HOSTS = [
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "images-api.nasa.gov",
  "images-assets.nasa.gov",
  "www.loc.gov",
  "tile.loc.gov",
  "api.dvidshub.net",
  // DVIDS's public item pages, read without a key as the licence evidence a claimant can see (E5c review).
  "www.dvidshub.net",
  "cdn.dvidshub.net",
  // DVIDS's media CDN, the host its documented Asset API names for image and video files (api.dvidshub.net/docs/asset_api).
  "d34w7g4gy10iej.cloudfront.net",
  // Voice of America (founder ruling, 2026-11-13): its video pages and terms, and the host its pages name for their mp4 downloads.
  "www.voanews.com",
  "voa-video-ns.akamaized.net",
];

/**
 * void news's own pages (same owner: own property, ledger class own_property):
 * the public site and its Cloudflare Pages deployments, each at its own
 * immutable address. Reached only by the capture step (scripts/rights.mjs capture, through scripts/capture_page.py),
 * never by the fetcher's downloads; listed so a ledger item's address can be checked.
 */
export const OWN_HOSTS = ["news.voidvision.org", "void-news.pages.dev"];

/** Whether a URL is one of void news's own pages (https, exact host or a deployment subdomain). */
export function isOwnUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const h = u.hostname.toLowerCase();
  return u.protocol === "https:" && OWN_HOSTS.some((o) => h === o || h.endsWith(`.${o}`));
}

/**
 * Federal publishers (founder ruling, chat 2026-11-12): the host itself or any
 * subdomain of it (www.slotkin.senate.gov, wwwn.cdc.gov, catalog.archives.gov).
 * A host here is only reachable; every item still has to prove a federal
 * author from its own page (adapters/gov.mjs, adapters/nara.mjs).
 */
export const FEDERAL_HOSTS = [
  "whitehouse.gov",
  "senate.gov",
  "house.gov",
  "congress.gov",
  "govinfo.gov",
  "cdc.gov",
  "centcom.mil",
  "defense.gov",
  "archives.gov",
  "trumanlibrary.gov",
  "eisenhowerlibrary.gov",
];

/**
 * The Wayback Machine, as a date witness only: a dated capture
 * (/web/<14-digit timestamp>[id_]/<original URL>) or the CDX index. Never a
 * licence (adapters/wayback.mjs). Any other path on the host is refused.
 */
export const WAYBACK_HOST = "web.archive.org";
export const WAYBACK_PATH = /^\/(?:web\/\d{14}(?:id_)?\/https?:\/\/\S+|cdx\/search\/cdx)$/;

/** Why a URL may not be fetched, or null when it may. Exact hosts, the federal suffixes, and Wayback's two paths. */
export function hostRefusal(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `not a URL: ${url}`;
  }
  if (u.protocol !== "https:") return `refused ${u.protocol} URL ${url}: https only`;
  const host = u.hostname.toLowerCase();
  if (FETCH_HOSTS.includes(host)) return null;
  if (FEDERAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  if (host === WAYBACK_HOST) {
    return WAYBACK_PATH.test(u.pathname) ? null : `refused ${url}: on web.archive.org only dated captures and the CDX index are fetched`;
  }
  return `refused host ${u.hostname}: not on the fetcher's domain allowlist`;
}

/** Whether a host is one of the federal publishers. */
export function isFederalHost(host) {
  const h = String(host ?? "").toLowerCase();
  return FEDERAL_HOSTS.some((f) => h === f || h.endsWith(`.${f}`));
}

export class RefusedHost extends Error {}
/** A host answered 403 to the honest request: recorded with the kind of refusal, never retried or worked around. */
export class Refused extends Error {}

/**
 * The kind of 403 a host gave, read from its answer: a Cloudflare bot
 * challenge, an Akamai "Access Denied", or a plain refusal (""). Pure.
 */
export function refusalKind(server, body) {
  const s = String(server ?? "").toLowerCase();
  const text = String(body ?? "").slice(0, 20_000);
  if (/just a moment|cf-chl|challenge-platform/i.test(text)) return " (a Cloudflare bot challenge, which is not answered)";
  if (/akamai/.test(s) || /errors\.edgesuite\.net/.test(text)) return ' (Akamai "Access Denied")';
  return "";
}

/** How much of each file is scanned for embedded provenance (XMP sits near the start of JPEG, PNG and MP4 headers). */
export const SNIFF_BYTES = 256 * 1024;

/**
 * Provenance marks embedded in a file's first bytes: an XMP/IPTC
 * DigitalSourceType naming algorithmic media, and a C2PA manifest (its JUMBF
 * "c2pa" label). A C2PA manifest alone is recorded, not judged: cameras sign
 * too, and its claims are not verified here.
 */
export function sniffGeneratorTags(buf) {
  const s = Buffer.from(buf).toString("latin1");
  const tags = [];
  const dst = s.match(/DigitalSourceType[\s\S]{0,300}?(compositeWithTrainedAlgorithmicMedia|trainedAlgorithmicMedia|compositeSynthetic|algorithmicMedia)/i);
  if (dst) tags.push(`XMP DigitalSourceType: ${dst[1]}`);
  else {
    const bare = s.match(/(trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|compositeSynthetic)/);
    if (bare) tags.push(`embedded IPTC term: ${bare[1]}`);
  }
  if (/jumb[\s\S]{0,64}c2pa/.test(s)) tags.push("C2PA manifest present (claims not verified)");
  return tags;
}

/** Hashes a file already on the media drive (an own-page still), as getMedia would report a download. */
export async function hashLocal(file, { mime = null, url = null } = {}) {
  const { readFileSync } = await import("node:fs");
  const buf = readFileSync(file);
  if (!buf.byteLength) throw new Error(`${file}: empty file`);
  return {
    status: "ok",
    sha256: createHash("sha256").update(buf).digest("hex"),
    sha1: createHash("sha1").update(buf).digest("hex"),
    bytes: buf.byteLength,
    mime,
    url,
    generator_tags: sniffGeneratorTags(buf.subarray(0, SNIFF_BYTES)),
  };
}

export function assertAllowedUrl(url) {
  const refusal = hostRefusal(url);
  if (refusal) throw new RefusedHost(refusal);
  return new URL(url);
}

/** Whether a URL is one the fetcher may contact. */
export function isAllowedUrl(url) {
  return Boolean(hostOf(url)) && hostRefusal(url) === null;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    // already consumed
  }
}

/** One GET with manual redirects, each hop checked against the allowlist. */
async function getOnce(url, { fetchImpl, timeoutMs, accept }) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertAllowedUrl(current);
    const res = await fetchImpl(current, {
      headers: { "user-agent": USER_AGENT, accept, "accept-language": ACCEPT_LANGUAGE },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), current).toString();
      await discard(res);
      current = next;
      continue;
    }
    return { res, url: current };
  }
  throw new Error(`${url}: more than ${MAX_REDIRECTS} redirects`);
}

async function withRetries(url, opts, onOk) {
  const { sleep = realSleep, retries = RETRIES } = opts;
  let lastError;
  let wait = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.max(1000 * 2 ** (attempt - 1), wait));
    wait = 0;
    let got;
    try {
      got = await getOnce(url, opts);
    } catch (err) {
      if (err instanceof RefusedHost || err instanceof Refused) throw err;
      lastError = err;
      continue;
    }
    const { res } = got;
    if (res.status === 429 || res.status >= 500) {
      wait = retryAfterMs(res.headers.get("retry-after")) ?? 0;
      await discard(res);
      lastError = new Error(`${url} answered ${res.status}`);
      continue;
    }
    if (res.status === 404) {
      await discard(res);
      return { status: "not_found", url: got.url };
    }
    if (res.status === 403) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 20_000);
      } catch {
        // no body to read
      }
      throw new Refused(`${url} answered 403${refusalKind(res.headers.get("server"), body)}: the host refused the fetcher's honest request (void omnibus, with its contact URL); not retried, and no bot protection is worked around`);
    }
    if (!res.ok) {
      await discard(res);
      throw new Error(`${url} answered ${res.status}`);
    }
    try {
      return await onOk(res, got.url);
    } catch (err) {
      if (err instanceof TooLarge) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error(`${url} failed`);
}

class TooLarge extends Error {}

async function readText(res, maxBytes) {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(res);
    throw new TooLarge(`response over ${maxBytes} bytes`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new TooLarge(`response over ${maxBytes} bytes`);
  return new TextDecoder().decode(buf);
}

/** GET a JSON document. Resolves { status: "ok", json, text, url } or { status: "not_found" }. */
export function getJson(url, { fetchImpl = fetch, sleep, retries, maxBytes = MAX_JSON_BYTES } = {}) {
  return withRetries(url, { fetchImpl, sleep, retries, timeoutMs: TIMEOUT_MS, accept: "application/json" }, async (res, finalUrl) => {
    const text = await readText(res, maxBytes);
    return { status: "ok", json: JSON.parse(text), text, url: finalUrl };
  });
}

/** GET an HTML or XML page as text. Resolves { status: "ok", text, url, contentType } or { status: "not_found" }. */
export function getText(url, { fetchImpl = fetch, sleep, retries, maxBytes = MAX_JSON_BYTES } = {}) {
  return withRetries(url, { fetchImpl, sleep, retries, timeoutMs: TIMEOUT_MS, accept: ACCEPT_TEXT }, async (res, finalUrl) => {
    const text = await readText(res, maxBytes);
    return { status: "ok", text, url: finalUrl, contentType: res.headers.get("content-type") };
  });
}

/**
 * Streams a media file to `dest` (written to dest + ".part", renamed on
 * success), hashing as it goes. Resolves { status: "ok", sha256, sha1, bytes,
 * mime, url } or { status: "not_found" }. Refuses past maxBytes.
 */
export function getMedia(url, dest, { fetchImpl = fetch, sleep, retries, maxBytes = MAX_MEDIA_BYTES } = {}) {
  return withRetries(url, { fetchImpl, sleep, retries, timeoutMs: MEDIA_TIMEOUT_MS, accept: "*/*" }, async (res, finalUrl) => {
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await discard(res);
      throw new TooLarge(`${url}: ${declared} bytes is over the ${maxBytes}-byte cap`);
    }
    const part = `${dest}.part`;
    const sha256 = createHash("sha256");
    const sha1 = createHash("sha1");
    let bytes = 0;
    const head = [];
    let headBytes = 0;
    const out = createWriteStream(part);
    let streamError = null;
    out.on("error", (err) => (streamError = err));
    try {
      await once(out, "open");
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new TooLarge(`${url}: over the ${maxBytes}-byte cap`);
        }
        sha256.update(value);
        sha1.update(value);
        if (headBytes < SNIFF_BYTES) {
          head.push(value.subarray(0, SNIFF_BYTES - headBytes));
          headBytes += Math.min(value.byteLength, SNIFF_BYTES - headBytes);
        }
        if (streamError) throw streamError;
        if (!out.write(value)) await once(out, "drain");
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (streamError) throw streamError;
    } catch (err) {
      if (!out.closed) {
        const closed = once(out, "close").catch(() => {});
        out.destroy();
        await closed;
      }
      rmSync(part, { force: true });
      throw err;
    }
    if (bytes === 0) {
      rmSync(part, { force: true });
      throw new Error(`${url}: empty body`);
    }
    renameSync(part, dest);
    return {
      status: "ok",
      sha256: sha256.digest("hex"),
      sha1: sha1.digest("hex"),
      bytes,
      mime: res.headers.get("content-type"),
      url: finalUrl,
      generator_tags: sniffGeneratorTags(Buffer.concat(head)),
    };
  });
}

