// Metadata-level checks on a fetched candidate before it may enter the
// ledger: the licence allowlist, the source denylist, AI provenance (zero AI
// pixels, bible section f) and the laundering heuristics for uploader-claimed
// work. The vision pass (stage 9, local GPU) is a later, separate check; this
// file never claims it ran. Pure: no I/O.
//
// The item-level bar (sourced, evidenced, sha256-pinned, AI stated) is adapted
// from void document (aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193:
// studio/engine/titles.py _provenance_problems()); the laundering checks are net-new.

import { FAIR_USE, aiSignals, deniedBy, licenceProblems } from "./licences.mjs";

/** An uploader account younger than this at upload time, with few edits, makes an own-work claim suspect. */
export const NEW_ACCOUNT_DAYS = 30;
export const NEW_ACCOUNT_MAX_EDITS = 50;

const DAY_MS = 86_400_000;

function toTime(d) {
  if (!d) return null;
  const s = String(d);
  const iso = /^\d{4}$/.test(s) ? `${s}-01-01` : /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Laundering heuristics for a picture whose licence rests on an uploader's
 * claim (Commons "own work", a Flickr transfer). A suspicion fails the item.
 * Institution records (NASA, LoC, DVIDS) are not uploader claims.
 */
export function launderingCheck(c) {
  if (c.adapter !== "commons") return { status: "not_applicable", findings: [] };
  const findings = [];
  const upload = toTime(c.published_at);
  const capture = toTime(c.date);
  if (capture !== null && upload !== null && capture > upload + DAY_MS) {
    findings.push(`capture date ${c.date} is after the upload ${c.published_at}`);
  }
  if (c.own_work) {
    if (!c.date) findings.push("claimed as own work with no capture date");
    const u = c.uploader;
    if (!u || !u.name || (u.registration == null && u.editcount == null)) {
      findings.push("claimed as own work, and the uploader's account could not be read");
    } else {
      const reg = toTime(u.registration);
      // Accounts from before 2006 carry no registration date; their edit count decides.
      const young = reg === null || (upload !== null && upload - reg < NEW_ACCOUNT_DAYS * DAY_MS);
      if (young && Number(u.editcount ?? 0) < NEW_ACCOUNT_MAX_EDITS) {
        findings.push(
          reg === null
            ? `claimed as own work by an account with no registration date and ${u.editcount ?? 0} edits`
            : `claimed as own work by an account ${Math.max(0, Math.floor((upload - reg) / DAY_MS))} days old at upload with ${u.editcount ?? 0} edits`,
        );
      }
    }
  }
  return { status: findings.length ? "suspect" : "clear", findings };
}

/** The AI-provenance record for the ledger, from every text signal the adapter read. */
export function aiProvenanceCheck(c) {
  const fields = [
    ...(c.keywords ?? []),
    ...(c.generator_tags ?? []),
    c.title,
    c.description,
    c.credit,
    c.licence_raw,
  ];
  const findings = aiSignals(fields, { categories: c.categories ?? [] });
  if (c.kind === "generated") findings.push("the request is for a generated picture");
  return {
    status: findings.length ? "flagged" : "clear",
    method: "metadata",
    checked: [...(c.ai_fields_checked?.length ? c.ai_fields_checked : ["title", "description", "credit"]), ...(c.file_scanned ? ["xmp-digital-source-type", "c2pa-label"] : [])],
    findings,
    vision: "pending",
  };
}

/**
 * Every reason a candidate cannot enter the ledger, plus the two check
 * records the ledger keeps. ok is true only when reasons is empty.
 */
export function checkCandidate(c) {
  const reasons = [];
  if (!c.licence) {
    reasons.push(c.licence_raw ? `licence "${c.licence_raw}" is not on the allowlist${c.licence_note ? ` (${c.licence_note})` : ""}` : "no licence stated");
  } else {
    reasons.push(...licenceProblems({ licence: c.licence, basis: c.basis, credit: c.credit, adapter: c.adapter, terms: c.terms, fair_use: c.fair_use }));
  }
  if (!c.evidence?.url || !String(c.evidence?.captured_text ?? "").trim()) reasons.push("no licence evidence captured");
  reasons.push(
    ...deniedBy({
      urls: [c.item_url, c.media_url, ...(c.related_urls ?? [])],
      texts: [c.title, c.description, c.basis],
      credits: [c.credit, ...(c.credit_fields ?? [])],
      tags: [...(c.categories ?? []), ...(c.keywords ?? [])],
      // Only a fair-use excerpt may be an outlet's clip; agencies and stock stay refused for every class.
      allowOutlets: c.licence === FAIR_USE,
    }),
  );
  const ai = aiProvenanceCheck(c);
  if (ai.status !== "clear") reasons.push(...ai.findings.map((f) => `AI-generated: ${f}`));
  const laundering = launderingCheck(c);
  if (laundering.status === "suspect") reasons.push(...laundering.findings.map((f) => `laundering suspicion: ${f}`));
  reasons.push(...(c.restriction_reasons ?? []));
  if (!c.media_url) reasons.push("no media address");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], ai_provenance_check: ai, laundering_check: laundering };
}
