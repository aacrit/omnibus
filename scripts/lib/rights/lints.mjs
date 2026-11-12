// The blocking rights lints (bible section j): licence-allowlist,
// licence-evidence and ai-generated-share-zero (metadata level), plus the
// ledger's schema and the dispute packet's freshness. Each finding names
// its rule id. Pure; scripts/lint-rights.mjs runs them in the gate.
//
// licence-allowlist and ai-generated-share-zero are adapted from void
// document (aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193:
// studio/engine/render.py, the "licence-allowlist" lint in build_plan and
// "ai-generated-share-zero" over the marks); tweaked to run on the ledger
// alone, before any render exists, and to count a metadata flag as generated.

import { isAllowedUrl } from "./http.mjs";
import { deniedBy, licenceProblems } from "./licences.mjs";
import { validateLedger } from "./ledger.mjs";
import { buildDisputePacket, serialisePacket } from "./disputes.mjs";

export const RULES = ["rights-ledger-schema", "licence-allowlist", "licence-evidence", "ai-generated-share-zero", "disputes-generated"];

const f = (rule, item, message) => ({ rule, item, message });

export function lintLicenceAllowlist(ledger) {
  const out = [];
  for (const it of ledger.items) {
    for (const p of licenceProblems(it)) out.push(f("licence-allowlist", it.id, p));
    for (const p of deniedBy({ urls: [it.item_url, it.media_url], texts: [it.credit, it.title, it.basis], tags: [] })) {
      out.push(f("licence-allowlist", it.id, p));
    }
    if (!isAllowedUrl(it.media_url)) out.push(f("licence-allowlist", it.id, `media_url ${it.media_url} is not on the fetcher's domain allowlist`));
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What the captured licence text must mention for the ledger's licence id to be believed. */
export function evidenceMarker(id) {
  let m = String(id).match(/^cc-by-sa-(\d\.\d)$/);
  if (m) {
    const v = escapeRe(m[1]);
    return new RegExp(`by-sa[/-]${v}|BY-SA ${v}|Share ?Alike ${v}`, "i");
  }
  m = String(id).match(/^cc-by-(\d\.\d)$/);
  if (m) {
    const v = escapeRe(m[1]);
    return new RegExp(`\\bby[/-]${v}|\\bBY ${v}|Attribution ${v}`, "i");
  }
  if (id === "cc0-1.0") return /\bcc0\b|cc-zero|publicdomain\/zero/i;
  if (id === "eu-reuse-credit") return /European Union/i;
  if (String(id).startsWith("pd-")) return /public domain|\bPD\b|17 U\.S\.C\. 105|no field credits anyone outside/i;
  return /$^/;
}

export function lintLicenceEvidence(ledger, { now = new Date() } = {}) {
  const out = [];
  for (const it of ledger.items) {
    const ev = it.licence_evidence ?? {};
    if (!/^https:\/\//.test(String(ev.url ?? ""))) out.push(f("licence-evidence", it.id, "licence_evidence.url must be an https address"));
    const text = String(ev.captured_text ?? "");
    if (!text.trim()) out.push(f("licence-evidence", it.id, "licence_evidence.captured_text is empty"));
    else if (!evidenceMarker(it.licence).test(text)) {
      out.push(f("licence-evidence", it.id, `the captured licence text does not state ${it.licence}`));
    }
    const at = Date.parse(String(ev.captured_at ?? ""));
    if (!Number.isFinite(at)) out.push(f("licence-evidence", it.id, "licence_evidence.captured_at is not a timestamp"));
    else if (at > now.getTime() + 60_000) out.push(f("licence-evidence", it.id, `licence_evidence.captured_at ${ev.captured_at} is in the future`));
    if (!String(it.rights_checked?.by ?? "").trim()) out.push(f("licence-evidence", it.id, "rights_checked.by is empty"));
    if (!String(it.basis ?? "").trim()) out.push(f("licence-evidence", it.id, "basis is empty"));
    if (!/^[0-9a-f]{64}$/.test(String(it.sha256 ?? ""))) out.push(f("licence-evidence", it.id, "sha256 of the file used is missing"));
    if (it.laundering_check?.status === "suspect") {
      out.push(f("licence-evidence", it.id, `laundering suspicion: ${(it.laundering_check.findings ?? []).join("; ")}`));
    }
  }
  return out;
}

/**
 * Zero AI pixels at the metadata level: any item whose AI-provenance check
 * is not clear (or whose vision pass flagged it) counts as generated, as
 * does any screenplay shot of kind "generated" when shots are given. The
 * share must be exactly zero.
 */
export function lintAiGeneratedShareZero(ledger, { shots = [] } = {}) {
  const out = [];
  for (const it of ledger.items) {
    const ai = it.ai_provenance_check;
    if (!ai || ai.status !== "clear") {
      out.push(f("ai-generated-share-zero", it.id, `AI provenance not clear: ${(ai?.findings ?? ["no check recorded"]).join("; ")}`));
    } else if (ai.vision === "flagged") {
      out.push(f("ai-generated-share-zero", it.id, "the vision pass flagged the item as synthetic"));
    }
  }
  for (const s of shots) {
    if (s?.kind === "generated") out.push(f("ai-generated-share-zero", s.id ?? "?", "a shot of kind generated"));
  }
  return out;
}

/** Every finding for one episode: schema first (the other lints need a valid ledger), then the three rights lints and the packet. */
export function lintEpisode({ ledger, ledgerText, disputesText, now, shots }) {
  const schema = validateLedger(ledger).map((p) => f("rights-ledger-schema", "-", p));
  if (schema.length) return schema;
  const out = [...lintLicenceAllowlist(ledger), ...lintLicenceEvidence(ledger, { now }), ...lintAiGeneratedShareZero(ledger, { shots })];
  const expected = serialisePacket(buildDisputePacket(ledger, ledgerText));
  if (disputesText == null) out.push(f("disputes-generated", "-", "disputes.json is missing; run node scripts/rights.mjs packet <issue>"));
  else if (disputesText.replace(/\r\n/g, "\n") !== expected) {
    out.push(f("disputes-generated", "-", "disputes.json differs from what the ledger generates; it is never edited by hand: run node scripts/rights.mjs packet <issue>"));
  }
  return out;
}
