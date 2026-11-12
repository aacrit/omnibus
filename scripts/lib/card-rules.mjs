// The Weight's consensus and divergence cards (show bible section e), by a
// written rule so the same record always yields the same cards. Pure: the
// rundown build passes a week record's lead and gets the cards back. The rule
// texts below are printed on the sources page verbatim.
//
// Pool: the claim's titled headlines (lead.ledger rows whose cluster_id is in
// lead.claim.clusters), each read as headline_shown when a Google News suffix
// is provably stripped.

export const RUNGS = ["far-left", "left", "center-left", "center", "center-right", "right", "far-right"];

// Words a headline attributes to someone other than its subject ("Establishment
// Will Blame Migration Curbs") are not the headline's answer: the span after a
// modal plus "blame", up to "for" or punctuation, is set aside before matching.
const ATTRIBUTED = /\b(?:will|would|could|may|might|to)\s+blame\s+(.+?)(?=\s+for\b|[,;:]|$)/gi;

export function withoutAttributed(text) {
  return text.replace(ATTRIBUTED, (m, span) => m.slice(0, m.length - span.length).trimEnd());
}

/** The fixed questions. dw-2's answers are relations between the two men ("breaks with Trump"), never a verb
 * alone: "President Trump Defends Strikes" says nothing about the Vice President. requires: patterns a headline must match to be asked the question at all. */
export const QUESTIONS = [
  { id: "dw-1", question: "what the Vice President named as the reason", requires: [/\bVance\b/i], answers: { war: /\b(Iran|war|conflict)\b/i, israel: /\bIsrael\b/i, migration: /\bmigration\b/i, inflation: /\binflation\b/i } },
  { id: "dw-2", question: "the Vice President and the President", requires: [/\bVance\b/i, /\bTrump\b/i], answers: { apart: /\b(?:(?:breaks?|breaking)(?: \w+)? with|distanc\w* (?:himself )?from|rebukes|lances) Trump\b/i, together: /\b(?:defends|backs|stands (?:with|by)|sides with) Trump\b/i } },
  { id: "dw-3", question: "the President's reply", requires: [/\bTrump\b/i], answers: { admits: /\badmits?\b/i, defends: /\bdefends?\b/i } },
];

export const DIVERGENCE_RULE =
  "Pool: the claim's titled headlines from placed outlets. For each fixed question, a headline is asked only if it names the people the question is about; words the headline attributes to someone else (a modal plus 'blame' and what follows, up to 'for' or punctuation) are set aside; its answers are the patterns the rest matches (case-insensitive, whole words; synonyms of one answer count as one). A pair qualifies when its two answer sets share nothing. Of the qualifying pairs, take the one whose rungs are farthest apart; then the pair whose earlier headline was published first; then the later; then ledger order. Show the pair left rung first. A question with no qualifying pair has no card.";

export const CONSENSUS_RULE =
  "Pool as above, unplaced outlets included in counts and shown beside the bars. (1) The claim term: lead.claim.terms (the normaliser's whole-word count of the claim's titled headlines), a count card with the rung bars and the unplaced beside them. (2) Quoted phrases: every span inside quotation marks in a pool headline, three words or more, compared lowercased with curly quotes straightened; a span carried by placed outlets on three or more rungs is a consensus card showing, per rung, the earliest headline that carries it. Nothing else becomes a consensus card.";

const wc = (s) => s.split(/\s+/).filter(Boolean).length;
const APOS = "\u0000"; // stands in for an in-word apostrophe while quotes are matched
const cmp = (a, b) => { for (let k = 0; k < a.length; k++) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; };

export function claimPool(lead) {
  const ids = new Set(lead.claim?.clusters ?? []);
  return lead.ledger.map((a, i) => ({ ...a, i, text: a.headline_shown ?? a.headline })).filter((a) => a.headline && ids.has(a.cluster_id));
}

export function cardRow(a) {
  return { outlet: a.outlet, rung: a.rung ?? "unplaced", headline: a.text, ...(a.headline_shown ? { headline_raw: a.headline } : {}), published_at: a.published_at, field: `lead.ledger[${a.i}]` };
}

export function answersOf(q, text) {
  if (!q.requires.every((re) => re.test(text))) return [];
  const own = withoutAttributed(text);
  return Object.entries(q.answers).filter(([, re]) => re.test(own)).map(([k]) => k);
}

export function divergencePairs(pool, questions = QUESTIONS) {
  const out = [];
  for (const q of questions) {
    const cands = pool.filter((a) => a.rung).map((a) => ({ a, set: answersOf(q, a.text) })).filter((c) => c.set.length > 0);
    let best = null;
    for (let x = 0; x < cands.length; x++) for (let y = x + 1; y < cands.length; y++) {
      const A = cands[x], B = cands[y];
      if (A.set.some((k) => B.set.includes(k))) continue;
      const dist = Math.abs(RUNGS.indexOf(A.a.rung) - RUNGS.indexOf(B.a.rung));
      const [e1, e2] = [A.a.published_at, B.a.published_at].sort();
      const key = [-dist, e1, e2, Math.min(A.a.i, B.a.i), Math.max(A.a.i, B.a.i)];
      if (!best || cmp(key, best.key) < 0) best = { key, A, B, dist };
    }
    if (!best) continue;
    const [l, r] = RUNGS.indexOf(best.A.a.rung) <= RUNGS.indexOf(best.B.a.rung) ? [best.A, best.B] : [best.B, best.A];
    out.push({ id: q.id, question: q.question, rung_distance: best.dist, a: { ...cardRow(l.a), answers: l.set }, b: { ...cardRow(r.a), answers: r.set } });
  }
  return out;
}

export function quotedPhraseCards(pool) {
  const spans = new Map();
  for (const a of pool) {
    // An apostrophe between two letters (Trump's, GOP’s) is not a quote mark: hold it aside, then restore it.
    const txt = a.text
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/(?<=\p{L})'(?=\p{L})/gu, APOS);
    for (const m of txt.matchAll(/'([^']{3,}?)'|"([^"]{3,}?)"/g)) {
      const span = (m[1] ?? m[2]).replaceAll(APOS, "'").toLowerCase().trim();
      if (wc(span) < 3) continue;
      const list = spans.get(span) ?? [];
      list.push(a);
      spans.set(span, list);
    }
  }
  const cards = [];
  for (const [span, list] of [...spans.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const rungs = [...new Set(list.filter((a) => a.rung).map((a) => a.rung))];
    if (rungs.length < 3) continue;
    const rows = RUNGS.filter((r) => rungs.includes(r)).map((r) => cardRow(list.filter((a) => a.rung === r).sort((x, y) => x.published_at.localeCompare(y.published_at) || x.i - y.i)[0]));
    cards.push({ kind: "quoted-phrase", phrase: span, rungs: rungs.length, rows });
  }
  return cards;
}
