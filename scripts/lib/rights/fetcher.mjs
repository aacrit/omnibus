// The fetcher (bible section h, stage 8): walks each asset request's
// candidates in ladder order, takes the first one whose licence, evidence,
// AI provenance and uploader checks all pass, downloads it to the media
// directory (outside the repo) with its sha256, and records it in the
// ledger. Every refused candidate is kept in `rejected` with its reasons, so
// a story with no free picture is a line in the ledger, not a silent gap.
// Net-new. I/O only through the injected http and adapters.

import path from "node:path";
import { rmSync } from "node:fs";
import { isAllowedUrl } from "./http.mjs";
import { emptyLedger, validateLedger } from "./ledger.mjs";
import { checkCandidate } from "./provenance.mjs";
import { clip, isoSecond } from "./text.mjs";

const MEDIA_EXT = /\.(jpe?g|png|tiff?|webp|gif|svg|pdf|html|xml|mp4|m4v|mov|webm|ogv|mp3|wav|flac|ogg|oga|m4a)$/i;

/** The file name an item is stored under: the request id plus the source's own extension. */
export function mediaFileName(requestId, mediaUrl, extHint = null) {
  let ext = "";
  try {
    ext = path.posix.extname(new URL(mediaUrl).pathname).toLowerCase();
  } catch {
    ext = "";
  }
  if (!MEDIA_EXT.test(ext) && extHint) ext = String(extHint).toLowerCase();
  if (!MEDIA_EXT.test(ext)) ext = ".bin";
  if (ext === ".jpeg") ext = ".jpg";
  return `${requestId}${ext}`;
}

function kindMismatch(requested, hint) {
  if (!hint || hint === requested) return null;
  if (requested === "document" && hint === "still") return null; // a scanned page is a still
  return `the source holds ${hint === "still" ? "a still" : hint}, and the request is for ${requested}`;
}

/** The first and last day a date of any precision (YYYY, YYYY-MM, YYYY-MM-DD, a timestamp) can mean. */
export function dateSpan(d) {
  const s = String(d ?? "");
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return [`${m[1]}-${m[2]}-${m[3]}`, `${m[1]}-${m[2]}-${m[3]}`];
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) {
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return [`${m[1]}-${m[2]}-01`, `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`];
  }
  if ((m = s.match(/^(\d{4})$/))) return [`${m[1]}-01-01`, `${m[1]}-12-31`];
  return null;
}

/**
 * Why an item's date falls outside its step's window, or null. A date that
 * cannot be read refuses an item found by search (it could be from any year);
 * an item the rundown pinned by name keeps its own dated record.
 */
export function windowProblem(date, window, { pinned = false, publishedAt = null, requirePublished = false } = {}) {
  if (!window) return null;
  // A news part's picture must be public by the part's horizon: a later upload or post was not there to show.
  if (requirePublished) {
    const pub = Date.parse(String(publishedAt ?? ""));
    const end = Date.parse(/T/.test(String(window.to)) ? String(window.to) : `${window.to}T23:59:59Z`);
    if (!Number.isFinite(pub)) return `no publication time on the item, so it cannot be shown public by ${window.to}`;
    if (Number.isFinite(end) && pub > end) return `published ${isoSecond(new Date(pub).toISOString())}, after its window ends ${window.to}`;
  }
  const span = dateSpan(date);
  if (!span) return pinned ? null : `no date on the item, so it cannot be placed inside ${window.from} to ${window.to}`;
  const from = dateSpan(window.from)?.[0];
  const to = dateSpan(window.to)?.[1];
  if ((to && span[0] > to) || (from && span[1] < from)) return `dated ${date}, outside its window ${window.from} to ${window.to}`;
  // A year or month that only overlaps a narrower window ("2026" for 1 to 8 Nov) does not place the item inside it.
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
  if (!pinned && from && to && days(span[0], span[1]) > days(from, to)) return `dated only ${date}, too coarse to place inside its window ${window.from} to ${window.to}`;
  return null;
}

/**
 * The record of a request no candidate filled: the ladder's fallback, and
 * why each step failed (refused candidates, then steps the fetcher cannot
 * reach: drawn by E6, or on a host outside the allowlist).
 */
export function dropOf(request, rejections) {
  const tierOf = (ref) => request.candidates.find((c) => c.ref === ref)?.tier ?? "?";
  const reasons = [
    ...rejections.map((r) => clip(`tier ${tierOf(r.ref)} ${r.adapter} ${r.ref}: ${r.reasons.join("; ")}`, 1200)),
    ...(request.not_fetched ?? []).map((s) => clip(`tier ${s.tier} ${s.host ?? "-"}: ${s.reason}`, 1200)),
  ];
  return {
    request_id: request.id,
    kind: request.kind,
    fallback_tier: request.fallback?.tier ?? null,
    fallback: clip(request.fallback?.text ?? "none stated", 1000),
    reasons: reasons.length ? reasons : ["no candidate was requested"],
  };
}

/** The rundown parts about the week's news, whose pictures must be public by the part's horizon. */
export const NEWS_PART = /^(cold-open|week-|weight-|margins-)/;

/** The ledger entry for a checked, downloaded candidate. */
export function ledgerEntry({ request, candidate: c, tier, check, media, file, checkedBy, today }) {
  return {
    id: request.id,
    request_id: request.id,
    kind: request.kind,
    adapter: c.adapter,
    title: clip(c.title, 400),
    licence: c.licence,
    licence_evidence: { url: c.evidence.url, captured_text: clip(c.evidence.captured_text, 4000), captured_at: c.evidence.captured_at },
    basis: clip(c.basis, 1000),
    rights_checked: { date: today, by: checkedBy },
    item_url: c.item_url,
    media_url: c.media_url,
    file,
    mime: media.mime ?? c.mime ?? null,
    sha256: media.sha256,
    bytes: media.bytes,
    credit: clip(c.credit, 600),
    date: c.date ?? null,
    published_at: c.published_at ?? null,
    content_date: null,
    source_tier: tier,
    ai_provenance_check: check.ai_provenance_check,
    laundering_check: check.laundering_check,
    ...(c.witness ? { witness: c.witness } : {}),
  };
}

/** The file a witnessed capture is kept under: the request id, the capture's timestamp, .witness.html. */
export function witnessFileName(requestId, capturedAt) {
  return `${requestId}.${String(capturedAt).replace(/[^0-9]/g, "").slice(0, 14)}.witness.html`;
}

/**
 * Downloads a Wayback capture as a date witness and records it in
 * ledger.witnesses: what was captured, when, its sha256, and why it is not
 * an episode asset. A capture that cannot be downloaded is recorded without
 * a file, with the reason.
 */
export async function recordWitness(ledger, { request, c, http, mediaDir, used, reasons }) {
  const w = c.witness;
  ledger.witnesses = ledger.witnesses ?? [];
  if (ledger.witnesses.some((x) => x.request_id === request.id && x.capture_url === w.capture_url)) return;
  const file = witnessFileName(request.id, w.captured_at);
  const rec = {
    request_id: request.id,
    capture_url: w.capture_url,
    captured_at: w.captured_at,
    original_url: w.original_url,
    text: clip(c.description || "(no text in the capture's metadata)", 1000),
    file: null,
    sha256: null,
    bytes: null,
    used,
    note: used ? "the capture witnesses the item's text by its capture time; the licence is the original's" : clip(`kept as a date witness only, not an episode asset: ${reasons.join("; ")}`, 1200),
  };
  try {
    const media = await http.getMedia(w.raw_url, path.join(mediaDir, file));
    if (media.status === "ok") Object.assign(rec, { file, sha256: media.sha256, bytes: media.bytes });
    else rec.note = clip(`${rec.note}; the capture could not be downloaded`, 1200);
  } catch (err) {
    rec.note = clip(`${rec.note}; download failed: ${err.message}`, 1200);
  }
  ledger.witnesses.push(rec);
}

/**
 * Fills every unfilled request. Options: adapters ({ commons, nasa, loc,
 * dvids }, each with lookup(ref, ctx)), http ({ getJson, getMedia }),
 * mediaDir (absolute, outside the repo), checkedBy, now(), env, dryRun, log.
 * Returns { ledger, report }: report lists what was taken, refused or skipped.
 */
export async function fetchRequests(requestsDoc, ledgerIn, opts) {
  const { adapters, http, mediaDir, checkedBy, now = () => new Date(), env = process.env, dryRun = false, log = () => {} } = opts;
  const ledger = structuredClone(ledgerIn ?? emptyLedger(requestsDoc.issue));
  const today = now().toISOString().slice(0, 10);
  const filled = new Set(ledger.items.map((i) => i.request_id));
  const report = [];
  for (const request of requestsDoc.requests) {
    if (filled.has(request.id)) {
      report.push({ request: request.id, outcome: "held", detail: "already in the ledger" });
      continue;
    }
    const rejections = [];
    let taken = null;
    for (const cand of request.candidates) {
      const adapter = adapters[cand.adapter];
      const refuse = (reasons) => rejections.push({ request_id: request.id, adapter: cand.adapter, ref: clip(cand.ref, 400), reasons });
      let found;
      try {
        found = await adapter.lookup(cand.ref, { http, env, now, kind: request.kind, candidate: cand });
      } catch (err) {
        refuse([`lookup failed: ${clip(err.message, 300)}`]);
        continue;
      }
      if (found.status === "skipped") {
        refuse([found.reason]);
        continue;
      }
      if (found.status !== "ok") {
        refuse([found.reason ?? "not found at the source"]);
        continue;
      }
      const c = { ...found.candidate, kind: request.kind };
      const reasons = [];
      const mismatch = kindMismatch(request.kind, c.kind_hint);
      if (mismatch) reasons.push(mismatch);
      if (c.media_url && !isAllowedUrl(c.media_url)) reasons.push(`media host of ${clip(c.media_url, 200)} is not on the fetcher's domain allowlist`);
      const requirePublished = NEWS_PART.test(String(request.for ?? "")) && (request.kind === "still" || request.kind === "footage");
      const outside = windowProblem(c.date, cand.window, { pinned: cand.pinned === true, publishedAt: c.published_at, requirePublished });
      if (outside) reasons.push(outside);
      const check = checkCandidate(c);
      reasons.push(...check.reasons);
      if (reasons.length) {
        // A refused Wayback capture is still kept as a date witness (hashed, never a licence, never on screen).
        if (c.witness && !dryRun) await recordWitness(ledger, { request, c, http, mediaDir, used: false, reasons });
        refuse([...new Set(reasons)]);
        continue;
      }
      if (dryRun) {
        taken = { candidate: cand, entry: null };
        break;
      }
      const file = mediaFileName(request.id, c.media_url, c.ext);
      const dest = path.join(mediaDir, file);
      let media;
      try {
        media = await http.getMedia(c.media_url, dest);
      } catch (err) {
        refuse([`download failed: ${clip(err.message, 300)}`]);
        continue;
      }
      if (media.status !== "ok") {
        refuse(["media not found at the source"]);
        continue;
      }
      const fileProblems = [];
      if (c.sha1 && media.sha1 !== c.sha1) fileProblems.push(`downloaded file's sha1 ${media.sha1} differs from the source's ${c.sha1}`);
      if (cand.sha256 && media.sha256 !== cand.sha256) fileProblems.push(`downloaded file's sha256 ${media.sha256} differs from the ${cand.sha256} the request pins`);
      if (c.bytes_expected && media.bytes !== c.bytes_expected) fileProblems.push(`downloaded ${media.bytes} bytes, the source states ${c.bytes_expected}`);
      // The file's own provenance marks (XMP DigitalSourceType, a C2PA label) join the AI check.
      const scanned = { ...c, generator_tags: [...(c.generator_tags ?? []), ...(media.generator_tags ?? [])], file_scanned: true };
      const fileCheck = checkCandidate(scanned);
      const entry = ledgerEntry({ request, candidate: scanned, tier: cand.tier, check: fileCheck, media, file, checkedBy, today });
      const schemaProblems = validateLedger({ ...emptyLedger(ledger.issue), items: [entry] });
      if (fileProblems.length || schemaProblems.length || !fileCheck.ok) {
        rmSync(dest, { force: true });
        refuse([...fileProblems, ...fileCheck.reasons, ...schemaProblems.map((p) => `ledger entry invalid: ${p}`)]);
        continue;
      }
      if (c.witness) await recordWitness(ledger, { request, c, http, mediaDir, used: true, reasons: [] });
      taken = { candidate: cand, entry };
      break;
    }
    ledger.rejected = ledger.rejected.filter((r) => r.request_id !== request.id).concat(rejections);
    const drops = (ledger.dropped ?? []).filter((d) => d.request_id !== request.id);
    if (!taken && !dryRun) drops.push(dropOf(request, rejections));
    if (drops.length || ledger.dropped) ledger.dropped = drops;
    if (taken?.entry) {
      ledger.items.push(taken.entry);
      report.push({ request: request.id, outcome: "taken", detail: `${taken.candidate.adapter} ${taken.candidate.ref} (tier ${taken.candidate.tier})` });
      log(`${request.id}: taken from ${taken.candidate.adapter} ${taken.candidate.ref}`);
    } else if (taken) {
      report.push({ request: request.id, outcome: "would take", detail: `${taken.candidate.adapter} ${taken.candidate.ref} (tier ${taken.candidate.tier})` });
      log(`${request.id}: would take ${taken.candidate.adapter} ${taken.candidate.ref} (dry run, nothing written)`);
    } else {
      report.push({ request: request.id, outcome: "unfilled", detail: `${rejections.length} candidate(s) refused` });
      log(`${request.id}: no candidate passed; ${rejections.length} refused (see the ledger's rejected list)`);
    }
  }
  return { ledger, report };
}
