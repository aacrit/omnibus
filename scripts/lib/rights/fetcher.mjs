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
import { clip } from "./text.mjs";

const MEDIA_EXT = /\.(jpe?g|png|tiff?|webp|gif|svg|pdf|mp4|m4v|mov|webm|ogv|mp3|wav|flac|ogg|oga|m4a)$/i;

/** The file name an item is stored under: the request id plus the source's own extension. */
export function mediaFileName(requestId, mediaUrl) {
  let ext = "";
  try {
    ext = path.posix.extname(new URL(mediaUrl).pathname).toLowerCase();
  } catch {
    ext = "";
  }
  if (!MEDIA_EXT.test(ext)) ext = ".bin";
  if (ext === ".jpeg") ext = ".jpg";
  return `${requestId}${ext}`;
}

function kindMismatch(requested, hint) {
  if (!hint || hint === requested) return null;
  if (requested === "document" && hint === "still") return null; // a scanned page is a still
  return `the source holds ${hint === "still" ? "a still" : hint}, and the request is for ${requested}`;
}

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
  };
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
        found = await adapter.lookup(cand.ref, { http, env, now });
      } catch (err) {
        refuse([`lookup failed: ${clip(err.message, 300)}`]);
        continue;
      }
      if (found.status === "skipped") {
        refuse([found.reason]);
        continue;
      }
      if (found.status !== "ok") {
        refuse(["not found at the source"]);
        continue;
      }
      const c = { ...found.candidate, kind: request.kind };
      const reasons = [];
      const mismatch = kindMismatch(request.kind, c.kind_hint);
      if (mismatch) reasons.push(mismatch);
      if (c.media_url && !isAllowedUrl(c.media_url)) reasons.push(`media host of ${clip(c.media_url, 200)} is not on the fetcher's domain allowlist`);
      const check = checkCandidate(c);
      reasons.push(...check.reasons);
      if (reasons.length) {
        refuse([...new Set(reasons)]);
        continue;
      }
      if (dryRun) {
        taken = { candidate: cand, entry: null };
        break;
      }
      const file = mediaFileName(request.id, c.media_url);
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
      taken = { candidate: cand, entry };
      break;
    }
    ledger.rejected = ledger.rejected.filter((r) => r.request_id !== request.id).concat(rejections);
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
