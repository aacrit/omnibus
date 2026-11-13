// The Wayback Machine as a date witness (founder ruling, chat 2026-11-12):
// a dated capture proves that a page held its text by the capture's time, so
// a primary text can be placed before a part's horizon. It is never a
// licence. The rights still come from the original: a capture of a federal
// page is read as that page (adapters/gov.mjs), with the capture recorded as
// its witness; a capture of anything else (x.com, a campaign site) has no
// licence on the allowlist and is refused, its capture time still recorded in
// the reason. Net-new. Pure apart from lookup() and findCaptures().

import { hostOf } from "../licences.mjs";
import { isFederalHost } from "../http.mjs";
import { clip, isoSecond } from "../text.mjs";
import { parseFederalPage, visibleText } from "./gov.mjs";

const CAPTURE = /^https:\/\/web\.archive\.org\/web\/(\d{14})(?:id_)?\/(https?:\/\/\S+)$/;

/** { timestamp, original } of a capture address, or null. */
export function parseCapture(url) {
  const m = String(url ?? "").match(CAPTURE);
  return m ? { timestamp: m[1], original: m[2] } : null;
}

/** A Wayback 14-digit timestamp as an ISO UTC second. */
export function tsToIso(ts) {
  const s = String(ts);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
}

/** An ISO time (or a bare date) as a Wayback 14-digit timestamp; a bare date's end is its last second when `end`. */
export function isoToTs(iso, { end = false } = {}) {
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.replace(/-/g, "")}${end ? "235959" : "000000"}`;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`not a time: ${iso}`);
  return new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export function cdxUrl(pattern, { from, to }) {
  const q = new URLSearchParams({ url: pattern, from: isoToTs(from), to: isoToTs(to, { end: true }), output: "json", filter: "statuscode:200", limit: "200" });
  return `https://web.archive.org/cdx/search/cdx?${q}`;
}

/** Pure: the captures a CDX JSON answer lists, inside the window, latest last. */
export function parseCdx(rows, { from, to }) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const [head, ...rest] = rows;
  const ti = head.indexOf("timestamp");
  const oi = head.indexOf("original");
  const lo = isoToTs(from);
  const hi = isoToTs(to, { end: true });
  return rest
    .map((r) => ({ timestamp: String(r[ti]), original: String(r[oi]).replace(/^http:/, "https:") }))
    .filter((c) => /^\d{14}$/.test(c.timestamp) && c.timestamp >= lo && c.timestamp <= hi)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((c) => ({ ...c, capture_url: `https://web.archive.org/web/${c.timestamp}/${c.original}` }));
}

/** Network: every capture of a URL pattern inside a window (the resolver's search). */
export async function findCaptures(pattern, window, { http }) {
  const r = await http.getJson(cdxUrl(pattern, window));
  if (r.status !== "ok") return [];
  return parseCdx(r.json, window);
}

export function witnessOf(captureUrl) {
  const c = parseCapture(captureUrl);
  if (!c) return null;
  return {
    service: "Internet Archive Wayback Machine",
    capture_url: `https://web.archive.org/web/${c.timestamp}/${c.original}`,
    raw_url: `https://web.archive.org/web/${c.timestamp}id_/${c.original}`,
    captured_at: tsToIso(c.timestamp),
    original_url: c.original.replace(/^http:/, "https:"),
  };
}

/** Pure: the candidate a captured page describes. */
export function parseCapturePage(html, { ref, kind, capturedAt }) {
  const witness = witnessOf(ref);
  if (!witness) return { status: "not_found", reason: `"${clip(ref, 120)}" is not a dated Wayback capture address` };
  const host = hostOf(witness.original_url);
  if (isFederalHost(host)) {
    const r = parseFederalPage(html, { pageUrl: witness.original_url, kind, capturedAt, witness });
    if (r.status === "ok") r.candidate.ref = ref;
    return r;
  }
  const said = clip(visibleText(String(html).match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? ""), 600);
  const note = `the Wayback Machine is a date witness, never a licence; ${host} is not a federal publisher, so the original carries no licence on the allowlist (captured ${witness.captured_at}, ${witness.capture_url})`;
  return {
    status: "ok",
    candidate: {
      adapter: "wayback",
      ref,
      kind_hint: kind,
      title: clip(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? visibleText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]) : witness.original_url, 400) || witness.original_url,
      description: said,
      item_url: witness.original_url,
      media_url: witness.raw_url,
      ext: ".html",
      licence_raw: `${host} page seen through a Wayback capture`,
      licence: null,
      licence_note: note,
      basis: null,
      credit: null,
      credit_fields: [],
      evidence: {
        url: witness.capture_url,
        captured_text: [`Wayback capture ${witness.capture_url} of ${witness.original_url}, captured ${witness.captured_at}.`, said ? `og:description: ${said}` : "No text in the capture's metadata.", `Refused: ${note}.`].join("\n"),
        captured_at: capturedAt,
      },
      date: witness.captured_at.slice(0, 10),
      published_at: null,
      categories: [],
      keywords: [],
      own_work: false,
      uploader: null,
      witness,
      ai_fields_checked: ["title", "description"],
    },
  };
}

export async function lookup(ref, { http, now = () => new Date(), kind = "document" }) {
  const witness = witnessOf(ref);
  if (!witness) return { status: "not_found", reason: `"${clip(ref, 120)}" is not a dated Wayback capture address` };
  const page = await http.getText(witness.raw_url);
  if (page.status !== "ok") return { status: "not_found", reason: `not captured: the Wayback Machine holds no capture at ${witness.capture_url}` };
  return parseCapturePage(page.text, { ref, kind, capturedAt: isoSecond(now().toISOString()) });
}
