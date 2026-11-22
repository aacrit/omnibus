// `node scripts/rights.mjs fetch <issue> --media <dir> --from-ledger`: puts
// every item the rights ledger already holds back on a machine that has none
// of the media (the GitHub Actions runner of episode-draft.yml, C8), each from
// its own origin (the ledger's media_url) through the same polite fetcher
// (http.mjs: the honest User-Agent, the host allowlist on every hop, no retry
// on a 403). Nothing is resolved, chosen or re-judged: the ledger is the
// record, and each file must hash to the sha256 it records.
//
// - A third-party file whose sha256 differs is never used: it is kept as
//   <file>.mismatch for a person to look at (discarded on GitHub Actions),
//   and reported.
// - A host that refuses the request (403, a bot challenge) is reported with
//   its answer; it is never retried from elsewhere or worked around.
// - Our own property (licence own-property: void news's page captures) is
//   never fetched or recaptured here: rights fix 4's asset-sha airs only the
//   exact bytes the ledger checked, and another machine's Chromium cannot
//   reproduce them. The workflow places those files from the issue's
//   own-pages-<issue> release (the laptop's captures, unchanged); here they
//   are only hashed. A missing or mismatched one is refused, never replaced.
//
// Writes no ledger. Net-new.

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Refused, RefusedHost, hashLocal } from "./http.mjs";

export const OWN_PROPERTY = "own-property";

/** The outcomes a draft can render from: only the exact bytes the ledger names. */
export const USABLE = new Set(["ok", "present"]);

/** The release whose assets carry an issue's own-property files, byte for byte as the laptop captured them. */
export const ownRelease = (issue) => `own-pages-${issue}`;

/** The ledger items placed from the own-pages release, never fetched or recaptured: our own property. */
export const isOwn = (item) => item.licence === OWN_PROPERTY;

/** The bare file names of the ledger's own-property items (pure); a name that is not bare, or not [\w.-], is left out and so refused. */
export function ownFiles(ledger) {
  return (ledger?.items ?? []).filter(isOwn).map((i) => String(i.file ?? "")).filter((f) => /^[\w.-]+$/.test(f) && path.basename(f) === f);
}

/**
 * T9c (CoS decision 2026-11-22): a US federal work (licence pd-us-federal) whose origin serves the runner other bytes
 * than the ledger checked is placed, like our own pages, from the issue's pd-sources-<issue> release: the laptop's
 * ledger-verified bytes, unchanged. Only pd-us-federal items, by this code; anything else is never put in a release.
 * A placed file is only hashed here (pullLedger's "present"); one that does not hash to the ledger is discarded and
 * fetched from its origin as before, never used.
 */
export const PD_FEDERAL = "pd-us-federal";
export const pdRelease = (issue) => `pd-sources-${issue}`;
export const isPdFederal = (item) => item.licence === PD_FEDERAL;

/** The bare file names of the ledger's pd-us-federal items (pure), the only files a pd-sources release may carry. */
export function pdFiles(ledger) {
  return (ledger?.items ?? []).filter(isPdFederal).map((i) => String(i.file ?? "")).filter((f) => /^[\w.-]+$/.test(f) && path.basename(f) === f);
}

/**
 * The files of `mediaDir` a pd-sources release may carry (the laptop's side): each pd-us-federal item's file that
 * hashes to the ledger's sha256. Returns { ok: [paths], refused: [{id, why}] }; an item of any other licence is never
 * listed, and a missing or mismatched file is refused, never uploaded.
 */
export async function pdVerified({ ledger, mediaDir, hash = hashLocal }) {
  const ok = [];
  const refused = [];
  for (const item of ledger.items ?? []) {
    if (!isPdFederal(item)) continue;
    const f = String(item.file ?? "");
    if (!/^[\w.-]+$/.test(f) || path.basename(f) !== f) { refused.push({ id: item.id, why: "not a bare file name" }); continue; }
    const p = path.join(mediaDir, f);
    if (!existsSync(p)) { refused.push({ id: item.id, why: `${p} is not on this machine` }); continue; }
    const { sha256 } = await hash(p);
    if (sha256 !== item.sha256) { refused.push({ id: item.id, why: `sha256 ${sha256.slice(0, 12)} is not the ledger's ${String(item.sha256).slice(0, 12)}` }); continue; }
    ok.push(p);
  }
  return { ok, refused };
}

/** `discard`: delete a mismatched download instead of keeping it as <file>.mismatch (default on GitHub Actions, where no person looks at it and every artifact is public). */
export async function pullLedger({ ledger, mediaDir, http, hash = hashLocal, log = console.log, discard = process.env.GITHUB_ACTIONS === "true" }) {
  mkdirSync(mediaDir, { recursive: true });
  const report = [];
  for (const item of ledger.items ?? []) {
    const row = { id: item.id, adapter: item.adapter, licence: item.licence ?? null, credit: item.credit ?? null, file: item.file ?? null, media_url: item.media_url ?? null };
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
      rmSync(dest, { force: true });
      if (isOwn(item)) {
        push("sha-mismatch", `sha256 ${sha256.slice(0, 12)} is not the ledger's ${item.sha256.slice(0, 12)}: discarded, never used (an own-property file airs only as the bytes the ledger checked; it is never recaptured)`);
        continue;
      }
    }
    if (isOwn(item)) {
      push("missing", "an own-property file is placed from its own-pages release (gh release download), never fetched or recaptured, and it is not there");
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
      const why = `downloaded ${got.bytes} bytes hash to ${got.sha256.slice(0, 12)}, not the ledger's ${item.sha256.slice(0, 12)}`;
      if (discard) {
        rmSync(dest, { force: true });
        push("sha-mismatch", `${why}; discarded, never used`);
        continue;
      }
      const kept = `${dest}.mismatch`;
      rmSync(kept, { force: true });
      renameSync(dest, kept);
      push("sha-mismatch", `${why}; kept as ${path.basename(kept)}, never used`);
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
