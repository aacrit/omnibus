// The fetcher (bible section h, stage 8): walks each asset request's
// candidates in ladder order, takes the first one whose licence, evidence,
// AI provenance and uploader checks all pass, downloads it to the media
// directory (outside the repo) with its sha256, and records it in the
// ledger. Every refused candidate is kept in `rejected` with its reasons, so
// a story with no free picture is a line in the ledger, not a silent gap.
// Net-new. I/O only through the injected http and adapters.

import path from "node:path";
import { renameSync, rmSync } from "node:fs";
import { hashLocal, isAllowedUrl, isOwnUrl } from "./http.mjs";
import { OWN_ADAPTER } from "./licences.mjs";
import { emptyLedger, validateLedger } from "./ledger.mjs";
import { checkCandidate } from "./provenance.mjs";
import { clip, isoSecond } from "./text.mjs";

/** A marks review as the ledger keeps it: who (a role), when, the frames, the contact sheet, the file's length, a video's cuts. */
function marksReviewed(r = {}) {
  return {
    by: clip(r.by, 200),
    at: String(r.at ?? ""),
    frames: Array.isArray(r.frames) ? r.frames.slice(0, 400) : r.frames,
    contact_sheet: r.contact_sheet ? { path: clip(r.contact_sheet.path, 300), sha256: String(r.contact_sheet.sha256 ?? "") } : r.contact_sheet,
    ...(r.duration_s !== undefined ? { duration_s: r.duration_s } : {}),
    // The cuts in a video, the scene threshold and the method that found them (S4 review round 3).
    ...(r.cuts !== undefined ? { cuts: r.cuts && typeof r.cuts === "object" ? { times: Array.isArray(r.cuts.times) ? r.cuts.times.slice(0, 2000) : r.cuts.times, threshold: r.cuts.threshold, method: clip(r.cuts.method, 200) } : r.cuts } : {}),
  };
}

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
export function windowProblem(date, window, { pinned = false, publishedAt = null, requirePublished = false, editionCutoff = null, event = {} } = {}) {
  if (!window) return null;
  // A news part's picture must be public by the part's horizon: a later upload or post was not there to show.
  if (requirePublished) {
    const pub = Date.parse(String(publishedAt ?? ""));
    const end = Date.parse(/T/.test(String(window.to)) ? String(window.to) : `${window.to}T23:59:59Z`);
    if (!Number.isFinite(pub)) return `no publication time on the item, so it cannot be shown public by ${window.to}`;
    if (Number.isFinite(end) && pub > end) {
      // Ruling A (founder, 2026-11-13): in The Week a picture of the day's own event may be published by the edition cutoff.
      const by = editionCutoff ? publishedByEdition({ date, publishedAt, window, editionCutoff, event }) : null;
      if (!by) return `published ${isoSecond(new Date(pub).toISOString())}, after its window ends ${window.to}`;
      if (by.problem) return by.problem;
    }
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

/** The rule a Week picture published after its day's horizon is admitted under (ruling A, founder 2026-11-13). */
export const PUBLISHED_BY_EDITION = "picture_published_by_edition";
/** The Week's day beats, whose pictures ruling A covers (never the cold open, The Weight or The Margins). */
export const WEEK_DAY = /^week-day-\d+$/;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2 NOV 2026" for an ISO day, or an instant's UTC day. */
export function dotDay(d) {
  const s = String(d ?? "");
  const t = /T/.test(s) ? Date.parse(s) : NaN;
  if (Number.isFinite(t)) {
    const x = new Date(t);
    return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** The dot label such a shot carries on screen: "FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026". */
export function editionDotLabel(eventDate, publishedAt) {
  return `FILMED ${dotDay(eventDate)} \u00b7 PUBLISHED ${dotDay(publishedAt)}`;
}

/**
 * Ruling A (founder, 2026-11-13): a picture of a Week day's own event, published after that
 * day's horizon, is admitted when the event's own day lies inside the day's window (on or
 * before the horizon's day) and it was published by the edition cutoff. Facts and narration
 * stay at the day's horizon; the shot carries a dot label saying when it was filmed and
 * published. Pure. Returns null (published by the horizon: the ordinary rule applies),
 * { problem }, or { record } for the ledger.
 */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Whether a text names an ISO day: "2026-11-02", "Nov. 2, 2026", "November 2, 2026", "2 November 2026", "2 Nov 2026", "11/2/2026". */
export function namesDay(text, day) {
  const m = String(day ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mm, dd] = m;
  const d = Number(dd);
  const full = MONTH_NAMES[Number(mm) - 1];
  const mon = `(?:${full}|${full.slice(0, 3)}\\.?${full.length > 4 ? `|${full.slice(0, 4)}\\.?` : ""})`;
  const forms = [
    `${y}-${mm}-${dd}`,
    `${mon}\\s+0?${d}(?:st|nd|rd|th)?,?\\s+${y}`,
    `0?${d}(?:st|nd|rd|th)?\\s+${mon},?\\s+${y}`,
    `0?${Number(mm)}/0?${d}/${y}`,
  ];
  const re = new RegExp(`(?<![0-9])(?:${forms.join("|")})(?![0-9])`, "i");
  return String(text ?? "").match(re)?.[0] ?? null;
}

/**
 * Ruling A's event-date evidence (S4 review, 2026-11-13): the sourcing pass's fit must state
 * shows_days_event: true, and the event's day must be shown independently of the item's
 * publication or upload: its title or description names the day, or the event's own record
 * (a date record) dates it. The date field of a YouTube copy ({{From YouTube}}, video2commons)
 * is its upload day, never evidence. Returns { evidence } or { problem }.
 */
export function eventDateEvidence(day, event = {}) {
  const why = [];
  if (event?.shows_days_event !== true) why.push("its fit does not state shows_days_event: true (the sourcing pass's finding that it shows the day's own event)");
  let evidence = null;
  if (event?.record_date === day) evidence = `the event's own record dates it ${day}${event.record_url ? ` (${clip(event.record_url, 200)})` : ""}`;
  for (const t of event?.texts ?? []) {
    if (evidence) break;
    const hit = namesDay(t, day);
    if (hit) evidence = `its own title or description names the day: "${clip(hit, 60)}"`;
  }
  if (!evidence) {
    why.push(
      event?.youtube_source
        ? `its date ${day} is the upload day of a YouTube copy (${clip(event.youtube_source, 120)}), and no title, description or record names the event's day`
        : `nothing independent of its publication dates the event to ${day} (no title, description or record names the day)`,
    );
  }
  return why.length ? { problem: why.join("; ") } : { evidence };
}

export function publishedByEdition({ date, publishedAt, window, editionCutoff, event = {} }) {
  const pub = Date.parse(String(publishedAt ?? ""));
  const end = Date.parse(/T/.test(String(window?.to)) ? String(window.to) : `${window?.to}T23:59:59Z`);
  if (!Number.isFinite(pub) || !Number.isFinite(end) || pub <= end) return null;
  const cutoff = Date.parse(/T/.test(String(editionCutoff)) ? String(editionCutoff) : `${editionCutoff}T23:59:59Z`);
  const at = isoSecond(new Date(pub).toISOString());
  if (!Number.isFinite(cutoff)) return { problem: `published ${at}, after its window ends ${window.to}, and the edition cutoff does not read` };
  if (pub > cutoff) return { problem: `published ${at}, after its window ends ${window.to} and after the edition cutoff ${editionCutoff}` };
  const span = dateSpan(date);
  if (!span || span[0] !== span[1]) return { problem: `published ${at}, after its window ends ${window.to}; ${PUBLISHED_BY_EDITION} needs the event's own day, and the item is dated ${date ?? "nowhere"}` };
  const dayTo = new Date(end).toISOString().slice(0, 10);
  const dayFrom = dateSpan(window.from)?.[0];
  if (span[0] > dayTo || (dayFrom && span[0] < dayFrom)) return { problem: `published ${at}, after its window ends ${window.to}, and its event date ${span[0]} is not the day's (${window.from} to ${window.to})` };
  const ev = eventDateEvidence(span[0], event);
  if (ev.problem) return { problem: `published ${at}, after its window ends ${window.to}; ${PUBLISHED_BY_EDITION} needs the day's own event: ${ev.problem}` };
  return {
    record: {
      rule: PUBLISHED_BY_EDITION,
      event_date: span[0],
      published_at: at,
      day_horizon: String(window.to),
      edition_cutoff: String(editionCutoff),
      dot_label: editionDotLabel(span[0], at),
      ...(dayFrom ? { day_from: dayFrom } : {}),
      event_evidence: clip(ev.evidence, 400),
    },
  };
}

/** The event evidence a fetched candidate offers ruling A: its fit's flag, its own title and description, its date record, its YouTube source. */
export function eventOf(c) {
  return {
    shows_days_event: c?.fit?.shows_days_event === true,
    texts: [c?.title, c?.description].filter(Boolean),
    record_date: c?.event_record?.date ?? null,
    record_url: c?.event_record?.url ?? null,
    youtube_source: c?.youtube_source ?? null,
  };
}

/** A pattern for one record identifier: its letter and digit groups in order, any short separator between ("73-3881" finds "NLT-AVC-PHT-(73)3881"). */
export function idPattern(id) {
  const groups = String(id ?? "").match(/[A-Za-z0-9]+/g) ?? [];
  // An identifier of fewer than 4 letters and digits would be found anywhere: it proves nothing.
  if (groups.join("").length < 4) return null;
  return new RegExp(`(?<![A-Za-z0-9])${groups.join("[^A-Za-z0-9]{0,3}")}(?![A-Za-z0-9])`, "i");
}

/** Every text a source states about itself: its ref, title, description, addresses, credit fields, page text and licence evidence. */
export function sourceMetadata(c) {
  return [c?.ref, c?.ref_requested, c?.title, c?.description, c?.item_url, c?.media_url, ...(c?.credit_fields ?? []), c?.source_text, c?.evidence?.captured_text]
    .filter(Boolean)
    .map(String)
    .join("\n");
}

/**
 * A pin's date record (a sourcing pass's finding): another catalogue record of the
 * same item that states its day. Pure. The source must state a date of its own (a
 * record refines it, never sets it); the record's date must be a full day inside
 * it (it refines, never moves, the date); and one of the record's own identifiers
 * (NAID, local id) must appear in the source's own metadata, so the record is
 * shown to be of this item (S4 review, 2026-11-13). Returns { date, evidence } or
 * { problem }.
 */
export function refineDate(sourceDate, record, { capturedAt, source = null }) {
  const d = String(record?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { problem: `the date record ${clip(record?.item_url ?? "", 200)} states no full day (${d || "none"})` };
  const own = dateSpan(sourceDate);
  if (!own) return { problem: `the source states no date of its own (${sourceDate ?? "null"}), so the date record ${clip(record?.item_url ?? "", 200)} would set its date, not refine it` };
  const ids = (record?.record_ids ?? [record?.ref]).filter((x) => x != null && String(x).trim());
  const meta = sourceMetadata(source);
  if (!ids.some((id) => idPattern(id)?.test(meta))) {
    return { problem: `none of the date record's identifiers (${ids.map((x) => clip(String(x), 40)).join(", ") || "none"}) appears in the source's own metadata, so it is not shown to be a record of this item` };
  }
  if (d < own[0] || d > own[1]) return { problem: `the date record's ${d} lies outside the source's own date ${sourceDate}` };
  return {
    date: d,
    evidence: {
      url: record.evidence?.url ?? record.item_url,
      captured_text: clip(`Date of the item read from a second catalogue record of it: "${record.title}" (${record.item_url}), production date ${d}.\n${record.evidence?.captured_text ?? ""}`, 4000),
      captured_at: capturedAt,
    },
  };
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

/** A title as the dignity list compares it: no "File:", no extension, lower case, one space between words. */
export function titleKey(t) {
  return String(t ?? "")
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The episode's dignity list (S4 review, 2026-11-13): a picture refused on dignity (a death on
 * camera) is refused for every request of the episode, matched by its normalised title or its
 * file's sha1/sha256, so a renamed or re-requested copy cannot slip in. Returns the entry or null.
 */
export function dignityHit(c, list = []) {
  const keys = new Set([titleKey(c?.ref), titleKey(c?.ref_requested), titleKey(c?.title)].filter(Boolean));
  return list.find((d) => (d.title_key && keys.has(d.title_key)) || (d.sha1 && c?.sha1 === d.sha1) || (d.sha256 && c?.sha256 === d.sha256)) ?? null;
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
    ...(c.own_property ? { own_property: c.own_property } : {}),
    // Further sources read for the licence (DVIDS: the API record beside its public page).
    ...(c.evidence_also?.length ? { evidence_also: c.evidence_also.map((e) => ({ url: e.url, captured_text: clip(e.captured_text, 4000), captured_at: e.captured_at })) } : {}),
    // A line the episode's credits must carry wherever the item airs.
    ...(c.disclosure ? { disclosure: clip(c.disclosure, 400) } : {}),
    // How the item's own sound is used, from the pin: E6 and E11 honour it.
    ...(c.audio ? { audio: { mode: c.audio.mode, reason: clip(c.audio.reason, 600) } } : {}),
    // Why the item shows its beat and the seconds that do, from the sourcing pass's candidate pin.
    ...(c.fit ? { fit: fitRecord(c.fit, request) } : {}),
    // An editorial-use item's captured terms; a fair-use excerpt's bounds and rationale (founder ruling, 2026-11-13).
    ...(c.terms ? { terms: { url: c.terms.url, captured_text: clip(c.terms.captured_text, 4000), captured_at: c.terms.captured_at, credit_required: clip(c.terms.credit_required, 400), restrictions: (c.terms.restrictions ?? []).map((r) => clip(r, 400)) } } : {}),
    ...(c.fair_use ? { fair_use: { ...c.fair_use, rationale: clip(c.fair_use.rationale, 2000) } } : {}),
    // A YouTube copy on Commons, and the record of the frame check its on-screen marks had (S4 review).
    ...(c.youtube_source ? { youtube_source: clip(c.youtube_source, 200) } : {}),
    ...(c.marks_checked ? { marks_checked: { marks: (c.marks_checked.marks ?? []).map((x) => clip(x, 200)), reviewed: marksReviewed(c.marks_checked.reviewed), ...(c.marks_checked.mask ? { mask: { covers: (c.marks_checked.mask.covers ?? []).map((x) => clip(x, 200)), region: { ...c.marks_checked.mask.region } } } : {}) } } : {}),
    // Ruling A: a Week picture published after its day's horizon, by the edition cutoff.
    ...(c.published_by_edition ? { published_by_edition: { ...c.published_by_edition } } : {}),
    // A dot label the shot must carry wherever the item airs (ruling A's, or a sourcing pass's: an Echo film of another place and day).
    ...(c.dot_label ? { dot_label: { text: clip(c.dot_label.text, 120), why: clip(c.dot_label.why, 600) } } : {}),
  };
}

/** The fit record a pin states, held to its fields and lengths. */
export function fitRecord(fit, request) {
  const out = { beat: clip(fit.beat ?? request.for ?? request.id, 80), why: clip(fit.why, 600) };
  for (const k of ["in_s", "out_s"]) if (Number.isFinite(fit[k]) && fit[k] >= 0) out[k] = fit[k];
  if (fit.horizon) out.horizon = clip(fit.horizon, 64);
  // The sourcing pass's finding that the item shows the day's own event (ruling A needs it, S4 review).
  if (fit.shows_days_event === true) out.shows_days_event = true;
  return out;
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
  const { adapters, http, mediaDir, checkedBy, now = () => new Date(), env = process.env, dryRun = false, redo = [], log = () => {} } = opts;
  const ledger = structuredClone(ledgerIn ?? emptyLedger(requestsDoc.issue));
  // --redo: a held request is filled again from its whole ladder (a better tier became reachable, e.g. DVIDS with a key).
  const unknown = redo.filter((id) => !requestsDoc.requests.some((r) => r.id === id));
  if (unknown.length) throw new Error(`--redo names no request in assets.json: ${unknown.map((id) => clip(id, 80)).join(", ")}`);
  const today = now().toISOString().slice(0, 10);
  const filled = new Set(ledger.items.map((i) => i.request_id));
  const report = [];
  for (const request of requestsDoc.requests) {
    // A redo whose refill fills nothing keeps the held item, and the ledger's record of it, as they were.
    const held = redo.includes(request.id) ? ledger.items.find((i) => i.request_id === request.id) ?? null : null;
    if (filled.has(request.id) && !held) {
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
        found = await adapter.lookup(cand.ref, { http, env, now, kind: request.kind, candidate: cand, mediaDir });
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
      // A pin's fit and fair-use record travel with the candidate; the source's own record never sets them.
      const c = { ...found.candidate, kind: request.kind, ...(cand.audio ? { audio: cand.audio } : {}), ...(cand.fit ? { fit: cand.fit } : {}), ...(cand.fair_use ? { fair_use: cand.fair_use } : {}), ...(cand.marks_checked ? { marks_checked: cand.marks_checked } : {}) };
      const reasons = [];
      // A pin's date record states the item's day where the source gives only its year (a NARA record of a Commons file).
      if (cand.date_record) {
        let rec;
        try {
          rec = await adapters[cand.date_record.adapter]?.lookup(cand.date_record.ref, { http, env, now, kind: request.kind, candidate: cand, mediaDir });
        } catch (err) {
          rec = { status: "error", reason: clip(err.message, 300) };
        }
        const refined = rec?.status === "ok" ? refineDate(c.date, rec.candidate, { capturedAt: isoSecond(now().toISOString()), source: c }) : { problem: `the date record ${cand.date_record.adapter} ${clip(cand.date_record.ref, 80)} could not be read${rec?.reason ? `: ${rec.reason}` : ""}` };
        if (refined.problem) reasons.push(refined.problem);
        else {
          c.date = refined.date;
          c.event_record = { date: refined.date, url: refined.evidence.url };
          c.evidence_also = [...(c.evidence_also ?? []), refined.evidence];
        }
      }
      const dignity = dignityHit(c, requestsDoc.dignity ?? []);
      if (dignity) reasons.push(`on the episode's dignity list (${clip(dignity.ref ?? dignity.title_key, 200)}): ${clip(dignity.why, 300)}`);
      const mismatch = kindMismatch(request.kind, c.kind_hint);
      if (mismatch) reasons.push(mismatch);
      const own = c.adapter === OWN_ADAPTER;
      if (own) {
        // void news's own page: captured from its own hosts, and held to the capture rules (own-pages.mjs) in place of the publication-time rule.
        if (!isOwnUrl(c.media_url)) reasons.push(`own page ${clip(c.media_url, 200)} is not on void news's own hosts`);
        reasons.push(...(c.own_problems ?? ["no capture record"]));
      } else if (c.media_url && !isAllowedUrl(c.media_url)) reasons.push(`media host of ${clip(c.media_url, 200)} is not on the fetcher's domain allowlist`);
      const requirePublished = !own && NEWS_PART.test(String(request.for ?? "")) && (request.kind === "still" || request.kind === "footage");
      // Ruling A covers The Week's day beats only, against the edition cutoff assets.json carries.
      const editionCutoff = WEEK_DAY.test(String(request.for ?? "")) ? requestsDoc.edition_cutoff ?? null : null;
      // A sourcing pass's pin (it states a fit) keeps no undated exemption: its date must be on the record and inside the window.
      const outside = windowProblem(c.date, cand.window, { pinned: cand.pinned === true && !cand.fit, publishedAt: c.published_at, requirePublished, editionCutoff, event: eventOf(c) });
      if (outside) reasons.push(outside);
      else if (requirePublished && editionCutoff && cand.window) {
        const by = publishedByEdition({ date: c.date, publishedAt: c.published_at, window: cand.window, editionCutoff, event: eventOf(c) });
        if (by?.record) {
          c.published_by_edition = by.record;
          c.dot_label = { text: by.record.dot_label, why: `${PUBLISHED_BY_EDITION} (founder ruling, 2026-11-13): published after the day's horizon ${cand.window.to}, by the edition cutoff ${editionCutoff}` };
        }
      }
      // A pin's own dot label (a sourcing pass's requirement), when ruling A has not set one.
      if (cand.dot_label && !c.dot_label) c.dot_label = cand.dot_label;
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
      const file = own ? `${request.id}${c.ext ?? ".png"}` : mediaFileName(request.id, c.media_url, c.ext);
      const final = path.join(mediaDir, file);
      // A redo downloads beside the held file and replaces it only once the new one passes, so a refusal never deletes it.
      const dest = held && !own ? `${final}.redo` : final;
      let media;
      try {
        if (own) {
          // The capture step wrote the still under the request's own name; it is hashed where it lies, never downloaded.
          if (c.local_file !== file) throw new Error(`the capture is stored as ${c.local_file}, not ${file}`);
          media = await (http.hashLocal ?? hashLocal)(dest, { mime: c.mime, url: c.media_url });
        } else media = await http.getMedia(c.media_url, dest);
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
      if (c.sha256_expected && media.sha256 !== c.sha256_expected) fileProblems.push(`the still's sha256 ${media.sha256} differs from the ${c.sha256_expected} its capture recorded`);
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
      if (dest !== final) renameSync(dest, final);
      if (c.witness) await recordWitness(ledger, { request, c, http, mediaDir, used: true, reasons: [] });
      taken = { candidate: cand, entry };
      break;
    }
    if (held && !taken) {
      report.push({ request: request.id, outcome: "held", detail: `the refill filled nothing (${rejections.length} candidate(s) refused), so the held item is kept` });
      log(`${request.id}: redo filled nothing; the held ${held.adapter} item is kept`);
      continue;
    }
    ledger.rejected = ledger.rejected.filter((r) => r.request_id !== request.id).concat(rejections);
    const drops = (ledger.dropped ?? []).filter((d) => d.request_id !== request.id);
    if (!taken && !dryRun) drops.push(dropOf(request, rejections));
    if (drops.length || ledger.dropped) ledger.dropped = drops;
    if (taken?.entry) {
      // A redo's new item takes the held one's place in the ledger.
      if (held) ledger.items.splice(ledger.items.indexOf(held), 1, taken.entry);
      else ledger.items.push(taken.entry);
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
