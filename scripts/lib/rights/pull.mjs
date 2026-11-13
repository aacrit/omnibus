// `node scripts/rights.mjs fetch <issue> --media <dir> --from-ledger`: puts
// every item the rights ledger already holds back on a machine that has none
// of the media (the GitHub Actions runner of episode-draft.yml, C8), each from
// its own origin (the ledger's media_url) through the same polite fetcher
// (http.mjs: the honest User-Agent, the host allowlist on every hop, no retry
// on a 403). Nothing is resolved, chosen or re-judged: the ledger is the
// record, and each file must hash to the sha256 it records.
//
// - A third-party file whose sha256 differs is never used: it is kept as
//   <file>.mismatch for a person to look at, and reported.
// - A host that refuses the request (403, a bot challenge) is reported with
//   its answer; it is never retried from elsewhere or worked around.
// - void news's own pages are captures, not downloads (scripts/rights.mjs
//   capture renders them first); here they are only hashed. A recapture whose
//   bytes differ (another machine's Chromium) is own property and is kept for
//   a draft, reported as such.
//
// Writes no ledger. Net-new.

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Refused, RefusedHost, hashLocal } from "./http.mjs";

export const OWN_ADAPTER = "voidnews";

/** The outcomes a draft can render from (a recapture of our own page included). */
export const USABLE = new Set(["ok", "present", "recaptured-differs"]);

export async function pullLedger({ ledger, mediaDir, http, hash = hashLocal, log = console.log }) {
  mkdirSync(mediaDir, { recursive: true });
  const report = [];
  for (const item of ledger.items ?? []) {
    const row = { id: item.id, adapter: item.adapter, licence: item.licence, file: item.file ?? null, media_url: item.media_url ?? null };
    const push = (outcome, detail = null) => {
      report.push({ ...row, outcome, detail });
      log(`${item.id}: ${outcome}${detail ? ` (${detail})` : ""}`);
    };
    if (!item.file || !item.sha256) {
      push("unusable", "the ledger item names no file or sha256");
      continue;
    }
    if (path.basename(item.file) !== item.file) {
      push("unusable", "the ledger's file is not a bare file name");
      continue;
    }
    const dest = path.join(mediaDir, item.file);
    if (existsSync(dest)) {
      const { sha256 } = await hash(dest);
      if (sha256 === item.sha256) {
        push("present");
        continue;
      }
      if (item.adapter === OWN_ADAPTER) {
        push("recaptured-differs", `sha256 ${sha256.slice(0, 12)} is not the ledger's ${item.sha256.slice(0, 12)}: our own page, recaptured on this machine; kept for a draft`);
        continue;
      }
      rmSync(dest, { force: true });
    }
    if (item.adapter === OWN_ADAPTER) {
      push("missing", "void news's own page is captured, not downloaded: run scripts/rights.mjs capture first");
      continue;
    }
    if (!item.media_url) {
      push("unusable", "the ledger item names no media_url");
      continue;
    }
    let got;
    try {
      got = await http.getMedia(item.media_url, dest);
    } catch (err) {
      if (err instanceof Refused || err instanceof RefusedHost) push("refused", err.message);
      else push("failed", err.message);
      continue;
    }
    if (got.status === "not_found") {
      push("not-found", `${item.media_url} answered 404`);
      continue;
    }
    if (got.sha256 !== item.sha256) {
      const kept = `${dest}.mismatch`;
      rmSync(kept, { force: true });
      renameSync(dest, kept);
      push("sha-mismatch", `downloaded ${got.bytes} bytes hash to ${got.sha256.slice(0, 12)}, not the ledger's ${item.sha256.slice(0, 12)}; kept as ${path.basename(kept)}, never used`);
      continue;
    }
    push("ok", `${got.bytes} bytes`);
  }
  return report;
}

/** Counts by outcome, and the items a draft cannot use. Pure. */
export function summarise(report) {
  const counts = {};
  for (const r of report) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return { counts, unusable: report.filter((r) => !USABLE.has(r.outcome)).map((r) => r.id) };
}
