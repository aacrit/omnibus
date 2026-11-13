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

import { isAllowedUrl, isOwnUrl } from "./http.mjs";
import { OWN_ADAPTER, OWN_PROPERTY, aiSignals, deniedBy, licenceProblems } from "./licences.mjs";
import { validateLedger } from "./ledger.mjs";
import { captureProblems } from "./own-pages.mjs";
import { buildDisputePacket, serialisePacket } from "./disputes.mjs";
import { DOW_DISCLOSURE, RESTRICTIONS_PAGE } from "./adapters/dvids.mjs";

export const RULES = ["rights-ledger-schema", "licence-allowlist", "licence-evidence", "ai-generated-share-zero", "disputes-generated"];

const f = (rule, item, message) => ({ rule, item, message });

export function lintLicenceAllowlist(ledger) {
  const out = [];
  for (const it of ledger.items) {
    for (const p of licenceProblems(it)) out.push(f("licence-allowlist", it.id, p));
    for (const p of deniedBy({ urls: [it.item_url, it.media_url, it.licence_evidence?.url], texts: [it.title, it.basis], credits: [it.credit, it.licence_evidence?.captured_text], tags: [] })) {
      out.push(f("licence-allowlist", it.id, p));
    }
    // void news's own pages come from its own hosts, never from a fetcher host; anything else must be on the fetcher's allowlist.
    const own = it.adapter === OWN_ADAPTER;
    if (own ? !isOwnUrl(it.media_url) || !isOwnUrl(it.item_url) : !isAllowedUrl(it.media_url)) {
      out.push(f("licence-allowlist", it.id, own ? `own page ${it.media_url} is not on void news's own hosts` : `media_url ${it.media_url} is not on the fetcher's domain allowlist`));
    }
    // The capture record is re-checked, never trusted: deployed in the edition's own window, its headlines, no picture in the region.
    if (own) for (const p of it.own_property ? captureProblems(it.own_property) : ["no capture record"]) out.push(f("licence-allowlist", it.id, p));
    if (it.licence === OWN_PROPERTY && !own) out.push(f("licence-allowlist", it.id, `own-property is claimed by adapter ${it.adapter}, not ${OWN_ADAPTER}`));
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
  if (id === OWN_PROPERTY) return /\bown property\b[\s\S]*\bsame owner\b|\bsame owner\b[\s\S]*\bown property\b/i;
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
    (it.evidence_also ?? []).forEach((e, i) => {
      if (!/^https:\/\//.test(String(e?.url ?? ""))) out.push(f("licence-evidence", it.id, `evidence_also[${i}].url must be an https address`));
      if (!String(e?.captured_text ?? "").trim()) out.push(f("licence-evidence", it.id, `evidence_also[${i}].captured_text is empty`));
      if (!Number.isFinite(Date.parse(String(e?.captured_at ?? "")))) out.push(f("licence-evidence", it.id, `evidence_also[${i}].captured_at is not a timestamp`));
    });
    // A recorded address never carries an API key (DVIDS's would be ?api_key=).
    for (const u of [it.item_url, it.media_url, ev.url, ...(it.evidence_also ?? []).map((e) => e?.url)]) {
      if (/[?&](api_key|apikey|key|token)=/i.test(String(u ?? ""))) out.push(f("licence-evidence", it.id, `${String(u).replace(/([?&](?:api_key|apikey|key|token)=)[^&]*/gi, "$1[removed]")} carries a key`));
    }
    if (it.adapter === "dvids") out.push(...dvidsEvidenceProblems(it).map((m) => f("licence-evidence", it.id, m)));
  }
  return out;
}

/**
 * A DVIDS item's evidence names the source a claimant can read (E5c review):
 * its public page, quoted with the PUBLIC DOMAIN mark and DVIDS's
 * restrictions line; the API record is a second entry; the credits carry the
 * DoW non-endorsement line.
 */
export function dvidsEvidenceProblems(it) {
  const out = [];
  const ev = it.licence_evidence ?? {};
  if (!/^https:\/\/www\.dvidshub\.net\/(image|video|audio)\/\d+$/.test(String(ev.url ?? "")) || ev.url !== it.item_url) out.push("a DVIDS item's licence_evidence.url must be its public page on www.dvidshub.net, the item_url");
  const text = String(ev.captured_text ?? "");
  if (!/"PUBLIC DOMAIN"/.test(text)) out.push("the captured page text does not quote its PUBLIC DOMAIN mark");
  if (!text.includes(`must comply with the restrictions shown on ${RESTRICTIONS_PAGE}`)) out.push(`the captured page text does not quote the "must comply with the restrictions shown on ${RESTRICTIONS_PAGE}" line`);
  if (!(it.evidence_also ?? []).some((e) => /^https:\/\/api\.dvidshub\.net\/asset\?id=(image|video|audio):\d+$/.test(String(e?.url ?? "")))) out.push("the API asset record read is not kept as a second evidence entry");
  if (it.disclosure !== DOW_DISCLOSURE) out.push(`a DVIDS item must carry the credits disclosure "${DOW_DISCLOSURE}"`);
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
  // Re-read the stored text too: a recorded "clear" is not trusted on its own.
  for (const it of ledger.items) {
    const again = aiSignals([it.title, it.credit, it.basis, it.licence_evidence?.captured_text]);
    if (again.length && it.ai_provenance_check?.status === "clear") {
      out.push(f("ai-generated-share-zero", it.id, `stored text carries an AI signal: ${again.join("; ")}`));
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
