// T5 (show bible v2 sections e and n): what kind of record a picture is, who
// released it, and the transcripts a sound bite's words must match. Net-new. Pure.
//
// record_kind. A sound bite comes only from an unedited event record. The
// ledger states each footage item's kind; only the first seven feed SOT, and
// an item of any other kind airs muted (mute B-roll, with the reason), so the
// screenplay's sound-role check (studio/news/schema.py) can never play it as
// sot or nat. An adapter states the kind only where its source's own record
// says it unmistakably (a Kremlin page titled "Press conference ..."); anything
// else is "unknown" until a checking role (verifier, cos or founder) signs a
// review of it on the pin. A sourcer's or builder's word is never enough.
//
// released_by and party_label. Footage a party to the story released carries
// RELEASED BY <party> on its first frame. The state-channel adapters (kremlin,
// uastate, kantei) always record it; a federal page records its body.
//
// transcripts. A ledger class beside the items: an official transcript (the
// state organ's own published text, on its own host) or ours, admissible only
// when two different ASR engines agree on the span at 98% or better by word.
// The agreement is never trusted as stored: it is computed again from the
// two engines' texts.

import { createHash } from "node:crypto";
import { MARKS_REVIEWERS } from "./licences.mjs";
import { isAllowedUrl, isFederalHost } from "./http.mjs";
import { hostOf } from "./licences.mjs";
import { clip } from "./text.mjs";

export const RECORD_KINDS = ["remarks", "briefing", "news_conference", "floor", "hearing_own_feed", "address", "interview_own_crew", "produced", "promo", "unknown"];
/** The seven kinds a sound bite may come from (bible v2 section n). */
export const SOT_KINDS = RECORD_KINDS.slice(0, 7);
/** The adapters whose footage is a party's own release, and so always carries its party label. */
export const STATE_CHANNEL_ADAPTERS = ["kremlin", "uastate", "kantei"];
/** The ledger issues written before v2 (frozen), which state no record_kind (V1 ONLY, like studio/news/schema.py V1_ISSUES). */
export const V1_LEDGER_ISSUES = [33];

/**
 * The kind a state organ's own page title states unmistakably, or null: "Press conference following visit to
 * China" is a news conference, "Remarks by President Trump ..." remarks, "Press Briefing by ..." a briefing,
 * "Address to the Nation" an address. A meeting, a visit, an interview or anything else is not read from its
 * title (an interview may be another crew's film): it stays unknown until a checking role reviews it.
 */
export function recordKindFromTitle(title) {
  const t = String(title ?? "").trim();
  const rules = [
    ["news_conference", /^(?:joint )?(?:press|news) conference\b|^press conference (?:following|after|on)\b/i],
    ["briefing", /^(?:press )?briefing\b|^press gaggle\b/i],
    ["address", /^(?:televised )?address (?:to|by|on)\b|^address$/i],
    ["remarks", /^(?:remarks|statements? (?:to|for) the press|(?:joint )?press statements?|opening remarks)\b/i],
  ];
  for (const [kind, re] of rules) if (re.test(t)) return { kind, evidence: `the source's own title "${clip(t, 160)}" names ${kind.replace("_", " ")}` };
  return null;
}

/** Whether a record kind may feed a sound bite. */
export function sotEligible(kind) {
  return SOT_KINDS.includes(kind);
}

/** The on-screen party label for a releasing body: "RELEASED BY THE KREMLIN". */
export function partyLabel(releasedBy) {
  const b = String(releasedBy ?? "").trim();
  return b ? `RELEASED BY ${b.toUpperCase()}` : null;
}

/** The mute reason the fetcher records for footage whose kind may not feed SOT. */
export function muteReasonFor(kind) {
  return `record_kind ${kind}: not shown to be an unedited event record, so its own sound never airs (bible v2 section e, sot-raw-source); mute B-roll only`;
}

/**
 * Why a pin's record_kind review does not stand, or []: { kind, by, at, why }, by a checking role,
 * kind one of RECORD_KINDS, why a sentence saying what the reviewer saw (the whole event, no cutaway,
 * no music bed, the source's own crew).
 */
export function recordKindReviewProblems(r) {
  const out = [];
  if (!r || typeof r !== "object") return ["record_kind must be { kind, by, at, why }, signed by a checking role"];
  if (!RECORD_KINDS.includes(r.kind)) out.push(`record_kind.kind must be one of ${RECORD_KINDS.join(", ")}, not ${clip(String(r.kind), 40)}`);
  const by = String(r.by ?? "").trim().toLowerCase();
  if (!MARKS_REVIEWERS.includes(by)) out.push(`record_kind is signed by ${clip(String(r.by ?? "nobody"), 40)}: only a checking role (${MARKS_REVIEWERS.join(", ")}) may state a record's kind, never the builder or the sourcer`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.at ?? ""))) out.push("record_kind.at must be the review's date");
  if (String(r.why ?? "").trim().split(/\s+/).filter(Boolean).length < 6) out.push("record_kind.why must say, in a sentence, what the reviewer saw");
  return out;
}

/**
 * The record kind a footage item gets: the adapter's own reading, else a signed review on its pin,
 * else unknown. A review that contradicts the adapter refuses the item. Returns { kind, evidence } or { problem }.
 */
export function resolveRecordKind({ adapterKind = null, adapterEvidence = null, review = null }) {
  if (review !== null && review !== undefined) {
    const p = recordKindReviewProblems(review);
    if (p.length) return { problem: p.join("; ") };
    if (adapterKind && adapterKind !== "unknown" && adapterKind !== review.kind) {
      return { problem: `the pin's reviewed record_kind ${review.kind} contradicts the source's own record (${adapterKind}: ${clip(adapterEvidence ?? "", 200)})` };
    }
    return { kind: review.kind, evidence: { source: "review", by: String(review.by).toLowerCase(), at: String(review.at), text: clip(String(review.why), 600) } };
  }
  if (adapterKind && RECORD_KINDS.includes(adapterKind)) return { kind: adapterKind, evidence: { source: "adapter", text: clip(adapterEvidence ?? `read by the adapter`, 600) } };
  return { kind: "unknown", evidence: { source: "adapter", text: "the source's own record does not state what kind of record this is, and no checking role has reviewed it" } };
}

/** Every reason a ledger item breaks the record-kind rule, or []. */
export function recordKindProblems(item, { issue = null } = {}) {
  if (V1_LEDGER_ISSUES.includes(issue)) return [];
  if (item?.kind !== "footage" && item?.record_kind === undefined) return [];
  const out = [];
  const k = item?.record_kind;
  if (!RECORD_KINDS.includes(k)) return [`a footage item states its record_kind (one of ${RECORD_KINDS.join(", ")})`];
  const ev = item.record_kind_evidence;
  if (!ev || !["adapter", "review"].includes(ev.source) || !String(ev.text ?? "").trim()) out.push("record_kind_evidence must say where the kind was read (adapter or review) and what showed it");
  else if (ev.source === "review" && !MARKS_REVIEWERS.includes(String(ev.by ?? ""))) out.push(`a reviewed record_kind is signed by a checking role (${MARKS_REVIEWERS.join(", ")}), not ${clip(String(ev.by ?? "nobody"), 40)}`);
  if (!sotEligible(k) && item.audio?.mode !== "muted") out.push(`record_kind ${k} may not feed SOT: the item airs muted, with the reason (audio.mode muted)`);
  return out;
}

/** Every reason a ledger item's party label is wrong, or []. */
export function partyLabelProblems(item) {
  const out = [];
  const state = STATE_CHANNEL_ADAPTERS.includes(item?.adapter);
  if (state && !String(item.released_by ?? "").trim()) out.push(`an item from the ${item.adapter} adapter names the body that released it (released_by)`);
  if (item?.released_by !== undefined || item?.party_label !== undefined) {
    const want = partyLabel(item.released_by);
    if (item.party_label !== want) out.push(`party_label must read "${want}", not "${clip(String(item.party_label ?? ""), 80)}"`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

/** Our own transcript is admissible only at this word agreement or better between two engines. */
export const AGREEMENT_MIN = 0.98;
export const TRANSCRIPT_SOURCES = ["official", "ours"];

/** The sha256 of a transcript's text, whitespace-normalised. */
export function textSha(text) {
  return createHash("sha256").update(String(text ?? "").replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

/** A text's words as compared: lower case, letters and digits only (apostrophes inside a word kept), in order. */
export function words(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

/**
 * Word agreement of two transcripts: 1 minus the word-level edit distance over the longer one's length.
 * Two empty texts do not agree (0): an empty transcript is no transcript.
 */
export function wordAgreement(a, b) {
  const x = words(a);
  const y = words(b);
  const n = Math.max(x.length, y.length);
  if (n === 0) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / n;
}

/** Whether a transcript's address is a state organ's own publication: a federal host, kremlin.ru or kantei.go.jp, and reachable by the fetcher. */
export function officialTranscriptHost(url) {
  const h = hostOf(url);
  if (!h || !isAllowedUrl(url)) return false;
  return isFederalHost(h) || /(^|\.)kremlin\.ru$/.test(h) || /(^|\.)kantei\.go\.jp$/.test(h);
}

/**
 * Every reason one transcript record does not stand, or []. items: the ledger's items, by id.
 * Record: { id, source, item_id, lang, text, text_sha256, captured_at, span?: { in_s, out_s },
 *   official: url, publisher, translated_from?; ours: engines [{ engine, model, text }] x2, agreement }.
 */
export function transcriptProblems(t, items = []) {
  const out = [];
  const at = `transcript ${clip(String(t?.id ?? "?"), 60)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(t?.id ?? ""))) out.push(`${at}: id must be a short id`);
  if (!TRANSCRIPT_SOURCES.includes(t?.source)) return [...out, `${at}: source must be official or ours`];
  if (!items.some((it) => it.id === t.item_id)) out.push(`${at}: item_id ${clip(String(t.item_id ?? ""), 80)} is no item of the ledger`);
  if (!/^[a-z]{2,3}$/.test(String(t.lang ?? ""))) out.push(`${at}: lang must be an ISO 639 code`);
  if (!words(t.text).length) out.push(`${at}: the text is empty`);
  else if (t.text_sha256 !== textSha(t.text)) out.push(`${at}: text_sha256 is not the sha256 of its text`);
  if (!Number.isFinite(Date.parse(String(t.captured_at ?? "")))) out.push(`${at}: captured_at is not a timestamp`);
  if (t.span !== undefined && !(Number.isFinite(t.span?.in_s) && Number.isFinite(t.span?.out_s) && t.span.out_s > t.span.in_s && t.span.in_s >= 0)) out.push(`${at}: span must be { in_s, out_s } with out after in`);
  if (t.source === "official") {
    if (!officialTranscriptHost(t.url)) out.push(`${at}: an official transcript is the state organ's own published text, on its own host (federal, kremlin.ru, kantei.go.jp), not ${clip(String(t.url ?? "(none)"), 120)}`);
    if (!String(t.publisher ?? "").trim()) out.push(`${at}: an official transcript names its publisher`);
    if (t.engines !== undefined || t.agreement !== undefined) out.push(`${at}: an official transcript carries no ASR engines`);
    if (t.translated_from !== undefined && !/^[a-z]{2,3}$/.test(String(t.translated_from))) out.push(`${at}: translated_from must be an ISO 639 code`);
  } else {
    const e = Array.isArray(t.engines) ? t.engines : [];
    if (e.length !== 2) out.push(`${at}: our transcript needs exactly two ASR engines' texts`);
    else {
      const names = e.map((x) => `${String(x?.engine ?? "").trim().toLowerCase()}`);
      if (names.some((n) => !n) || e.some((x) => !String(x?.model ?? "").trim())) out.push(`${at}: each engine names itself and its model`);
      else if (names[0] === names[1]) out.push(`${at}: the two transcripts come from one engine (${names[0]}); agreement needs two different engines`);
      const agree = wordAgreement(e[0]?.text, e[1]?.text);
      if (agree < AGREEMENT_MIN) out.push(`${at}: the two engines agree on ${(agree * 100).toFixed(1)}% of words, below the ${AGREEMENT_MIN * 100}% bar: not admissible as OUR TRANSCRIPT`);
      if (!Number.isFinite(t.agreement) || Math.abs(t.agreement - agree) > 1e-6) out.push(`${at}: the stored agreement ${t.agreement} is not the ${agree.toFixed(4)} its engines' texts give`);
      if (textSha(t.text) !== textSha(e[0]?.text)) out.push(`${at}: our transcript's text is the first engine's text, verbatim`);
    }
    if (t.url !== undefined) out.push(`${at}: our transcript has no publisher's url (it is OUR TRANSCRIPT)`);
    if (!items.some((it) => it.id === t.item_id && sotEligible(it.record_kind))) out.push(`${at}: our transcript transcribes a ledger item whose record_kind may feed SOT`);
  }
  return out;
}

/** Every transcript problem in a ledger, plus repeated ids. */
export function ledgerTranscriptProblems(ledger) {
  const list = ledger?.transcripts ?? [];
  const out = [];
  const seen = new Set();
  for (const t of list) {
    if (seen.has(t?.id)) out.push(`transcript ${clip(String(t?.id), 60)} is repeated`);
    seen.add(t?.id);
    out.push(...transcriptProblems(t, ledger?.items ?? []));
  }
  return out;
}

/** Builds our transcript record from two engines' outputs, the agreement computed here. */
export function ourTranscript({ id, item_id, lang, span, engines, capturedAt }) {
  const [a, b] = engines;
  const agreement = wordAgreement(a?.text, b?.text);
  return {
    id,
    source: "ours",
    item_id,
    lang,
    ...(span ? { span } : {}),
    text: String(a?.text ?? "").replace(/\s+/g, " ").trim(),
    text_sha256: textSha(a?.text),
    engines: engines.map((e) => ({ engine: String(e.engine), model: String(e.model), text: String(e.text ?? "").replace(/\s+/g, " ").trim() })),
    agreement,
    captured_at: capturedAt,
  };
}
