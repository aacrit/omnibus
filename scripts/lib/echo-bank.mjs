// The Echo bank (bible v2, section g): entries tagged by mechanism before any
// week's news is known, and the checks that hold them to it.
//
//   bankProblems(bank)          the bank file's own rules: every entry has a
//                               horizon, tags from the vocabulary, two period
//                               perspectives, one period document, six public
//                               domain items, a source for every claim and the
//                               no-bridge pre-check lists.
//   weekOpens(date)             Monday 00:00 UTC of the week that holds date.
//   firstUsableWeek(committed)  the first week an entry committed at that
//                               instant may serve (the advance-pick rule: an
//                               entry added during a week is quarantined until
//                               the next week opens).
//   advancePickProblems(...)    echo-advance-pick: the picked id exists, with
//                               tags, in the bank at bank_commit, and that
//                               commit is dated before the week opened.
//   noBridgeTerms(entry)        the entry's people, organisations, events and
//                               named documents, for the no-bridge lint.
//
// Pure: no I/O. The caller reads the bank at a commit (git show) and passes
// the commit's committer time.
import { createHash } from "node:crypto";

export const BANK_SCHEMA = "omnibus.echo-bank/1";
export const MIN_PERSPECTIVES = 2;
export const MIN_PD_ITEMS = 6;
const PD_LICENCES = new Set(["pd-us-federal", "pd-age", "pd-dedication"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AS_OF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const EM_DASH = /—/;
const NO_BRIDGE_CLASSES = ["people", "organisations", "events", "named_documents"];

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const text = (v) => typeof v === "string" && v.trim().length > 0;

/** Every string anywhere inside v, with its JSON path. */
function* strings(v, at = "") {
  if (typeof v === "string") yield [at, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${at}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, at ? `${at}.${k}` : k);
}

/** The bank's problems, one string each; an empty list passes. */
export function bankProblems(bank) {
  const out = [];
  if (!bank || typeof bank !== "object") return ["the bank is not an object"];
  if (bank.schema !== BANK_SCHEMA) out.push(`schema must be ${BANK_SCHEMA}, not ${JSON.stringify(bank.schema)}`);
  const vocab = bank.vocabulary ?? {};
  if (typeof vocab !== "object" || Object.keys(vocab).length === 0) out.push("the bank has no mechanism vocabulary");
  for (const [tag, sentence] of Object.entries(vocab)) {
    if (!SLUG.test(tag)) out.push(`vocabulary tag ${JSON.stringify(tag)} is not a slug`);
    if (!text(sentence)) out.push(`vocabulary tag ${tag} has no sentence`);
  }
  if (!Array.isArray(bank.entries) || bank.entries.length === 0) return [...out, "the bank has no entries"];
  const ids = new Set();
  for (const [i, e] of bank.entries.entries()) {
    const at = `entries[${i}]${e?.id ? ` (${e.id})` : ""}`;
    if (!e || typeof e !== "object") {
      out.push(`${at} is not an object`);
      continue;
    }
    if (!SLUG.test(e.id ?? "")) out.push(`${at}: id must be a slug`);
    if (ids.has(e.id)) out.push(`${at}: id is repeated`);
    ids.add(e.id);
    if (!text(e.title)) out.push(`${at}: no title`);
    if (!text(e.slate?.place) || !text(e.slate?.date)) out.push(`${at}: the slate needs the period's place and date`);
    if (!DAY.test(e.span?.from ?? "") || !DAY.test(e.span?.to ?? "") || e.span.from > e.span.to) out.push(`${at}: span must be two ordered YYYY-MM-DD dates`);

    // The horizon: its own century, at or after the span opens, before 2000.
    if (!AS_OF.test(e.as_of ?? "") || Number.isNaN(Date.parse(e.as_of))) out.push(`${at}: as_of must be an ISO 8601 instant with its offset`);
    else {
      if (e.span?.from && e.as_of.slice(0, 10) < e.span.from) out.push(`${at}: as_of is before the span opens`);
      if (Number(e.as_of.slice(0, 4)) >= 2000) out.push(`${at}: an Echo's horizon is in its own century, not this one`);
    }
    if (!text(e.as_of_basis)) out.push(`${at}: as_of_basis says why the horizon is where it is`);

    // Sources: every id resolves, every source was fetched and hashed.
    const src = new Map();
    for (const s of e.sources ?? []) {
      if (!text(s.id) || !/^https:\/\//.test(s.url ?? "") || !/^[0-9a-f]{64}$/.test(s.sha256 ?? "")) {
        out.push(`${at}: source ${JSON.stringify(s.id)} needs an id, an https url and the sha256 of what was read`);
      }
      if (src.has(s.id)) out.push(`${at}: source ${s.id} is repeated`);
      src.set(s.id, s);
    }
    if (src.size === 0) out.push(`${at}: no sources`);
    const cites = (where, id) => {
      for (const one of String(id ?? "").split(/[\s,;]+/).filter(Boolean)) {
        if (!src.has(one)) out.push(`${at}: ${where} cites ${JSON.stringify(one)}, which is not in sources`);
      }
      if (!text(id)) out.push(`${at}: ${where} has no source`);
    };

    // Mechanisms: from the vocabulary, each with a sourced note.
    const tags = Array.isArray(e.mechanisms) ? e.mechanisms : [];
    if (tags.length === 0) out.push(`${at}: no mechanism tags`);
    for (const t of tags) {
      if (!(t in vocab)) out.push(`${at}: mechanism ${JSON.stringify(t)} is not in the vocabulary`);
      if (!text(e.mechanism_notes?.[t])) out.push(`${at}: mechanism ${t} has no note`);
      else if (!/\(src-[^)]+\)/.test(e.mechanism_notes[t])) out.push(`${at}: mechanism ${t}'s note names no source`);
    }
    if (!text(e.mechanism_sentence)) out.push(`${at}: no mechanism sentence`);

    for (const [j, f] of (e.facts ?? []).entries()) cites(`facts[${j}]`, f.source);
    if (!Array.isArray(e.facts) || e.facts.length === 0) out.push(`${at}: no facts`);

    // Period perspectives, in their own words, hashed.
    const pp = Array.isArray(e.period_perspectives) ? e.period_perspectives : [];
    if (pp.length < MIN_PERSPECTIVES) out.push(`${at}: ${pp.length} period perspectives, needs at least ${MIN_PERSPECTIVES}`);
    for (const [j, p] of pp.entries()) {
      const w = `period_perspectives[${j}]`;
      if (!text(p.who) || !text(p.quote)) out.push(`${at}: ${w} needs who and quote`);
      else if (p.quote_sha256 !== sha256(p.quote)) out.push(`${at}: ${w}'s quote_sha256 does not match its quote`);
      if (!DAY.test(p.date ?? "")) out.push(`${at}: ${w} needs a YYYY-MM-DD date`);
      else if (e.as_of && p.date > e.as_of.slice(0, 10)) out.push(`${at}: ${w} is dated after the horizon`);
      cites(w, p.source);
    }
    // "In their own words" (section g): a minute or a note-taker's record is kept, marked
    // own_words: false, and never counts toward the two.
    const own = new Set(pp.filter((p) => p.own_words !== false).map((p) => String(p.who ?? "").split(",")[0].trim()));
    if (pp.length >= MIN_PERSPECTIVES && own.size < MIN_PERSPECTIVES) out.push(`${at}: needs period perspectives from at least two different speakers in their own words (own_words is not false)`);
    for (const [j, p] of pp.entries()) {
      if (p.own_words === false && !text(p.record_kind)) out.push(`${at}: period_perspectives[${j}] is not in its speaker's own words and must say what record it is (record_kind)`);
    }

    // One period document.
    const doc = e.period_document;
    if (!doc) out.push(`${at}: no period document`);
    else {
      cites("period_document", doc.source);
      if (!DAY.test(doc.date ?? "")) out.push(`${at}: period_document needs a YYYY-MM-DD date`);
      else if (e.as_of && doc.date > e.as_of.slice(0, 10)) out.push(`${at}: period_document is dated after the horizon`);
    }

    // Six public domain items, each with its record.
    const items = Array.isArray(e.pd_items) ? e.pd_items : [];
    if (items.length < MIN_PD_ITEMS) out.push(`${at}: ${items.length} public domain items, needs at least ${MIN_PD_ITEMS}`);
    const itemIds = new Set();
    for (const [j, it] of items.entries()) {
      const w = `pd_items[${j}]${it.id ? ` (${it.id})` : ""}`;
      if (!text(it.id) || itemIds.has(it.id)) out.push(`${at}: ${w} needs a unique id`);
      itemIds.add(it.id);
      if (!PD_LICENCES.has(it.licence)) out.push(`${at}: ${w} licence must be a public domain basis, not ${JSON.stringify(it.licence)}`);
      if (!text(it.basis)) out.push(`${at}: ${w} needs its public domain basis`);
      if (!text(it.ref) || !/^https:\/\//.test(it.item_url ?? "")) out.push(`${at}: ${w} needs a catalogue ref and an https item_url`);
      if (!/^[0-9a-f]{64}$/.test(it.metadata_sha256 ?? "")) out.push(`${at}: ${w} needs the sha256 of its metadata record`);
      if (typeof it.inside_horizon !== "boolean") out.push(`${at}: ${w} must say whether it was made inside the horizon`);
      if (it.inside_horizon === false && !text(it.dot_label)) out.push(`${at}: ${w} was made after the horizon and needs a dot label that says so`);
    }

    // No-bridge pre-check lists.
    const nb = e.no_bridge ?? {};
    for (const k of NO_BRIDGE_CLASSES) if (!Array.isArray(nb[k])) out.push(`${at}: no_bridge.${k} must be a list`);
    if (!Array.isArray(nb.exempt_states_places)) out.push(`${at}: no_bridge.exempt_states_places must be a list`);
    for (const p of pp) {
      const name = String(p.who ?? "").split(",")[0].trim();
      const listed = [...(Array.isArray(nb.people) ? nb.people : []), ...(Array.isArray(nb.organisations) ? nb.organisations : [])];
      if (name && !listed.includes(name.replace(/^(the|dr\.?|mr\.?|mrs\.?|sir) /i, "")) && !listed.includes(name)) out.push(`${at}: no_bridge lacks the speaker ${name} (people or organisations)`);
    }

    if (typeof e.bed_constraints?.account_of_violence !== "boolean") out.push(`${at}: bed_constraints.account_of_violence must be true or false`);

    for (const [p, s] of strings(e)) if (EM_DASH.test(s)) out.push(`${at}: an em dash in ${p}`);
  }
  return out;
}

/** Monday 00:00 UTC of the week that holds the instant (a Date or a parsable string). */
export function weekOpens(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`not a date: ${JSON.stringify(date)}`);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

/** The first week an entry committed at that instant may serve: the next Monday 00:00 UTC strictly after it. */
export function firstUsableWeek(committed) {
  const opens = weekOpens(committed);
  return new Date(opens.getTime() + 7 * 86400e3);
}

/**
 * echo-advance-pick. bankAtCommit: the bank file as it stood at echo.bank_commit;
 * committedAt: that commit's committer time; weekStart: the covered week's Monday
 * (any instant in it is read as its Monday 00:00 UTC).
 */
export function advancePickProblems({ id, bankAtCommit, committedAt, weekStart }) {
  const out = [];
  const entry = bankAtCommit?.entries?.find((e) => e.id === id);
  if (!entry) out.push(`echo ${JSON.stringify(id)} is not in the bank at bank_commit`);
  else if (!Array.isArray(entry.mechanisms) || entry.mechanisms.length === 0) out.push(`echo ${id} has no mechanism tags at bank_commit`);
  const committed = new Date(committedAt);
  if (Number.isNaN(committed.getTime())) out.push("bank_commit has no committer time");
  else {
    const opens = weekOpens(weekStart);
    if (!(committed < opens)) {
      out.push(`bank_commit is dated ${committed.toISOString()}, not before the week opened (${opens.toISOString()}); first usable week: ${firstUsableWeek(committed).toISOString()}`);
    }
  }
  return out;
}

/** The entry's names in the four no-bridge classes, deduplicated (states and places are exempt). */
export function noBridgeTerms(entry) {
  const nb = entry?.no_bridge ?? {};
  return [...new Set(NO_BRIDGE_CLASSES.flatMap((k) => (Array.isArray(nb[k]) ? nb[k] : [])))];
}
