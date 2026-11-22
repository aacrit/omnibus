// The reviewed terms pages of the state channels (T5, show bible v2 section n):
// kremlin.ru's "Using Website Content" and the Prime Minister's Office of
// Japan's copyright policy with the Digital Agency's Public Data License 1.0,
// whose clause 1.7 grants use under CC BY 4.0. Every lookup reads the terms
// page again, cuts out the block that states the terms, and hashes its text
// (whitespace-normalised, licences.mjs termsTextSha). The item passes only
// when that hash is the one reviewed here and the review names a checking
// role (verifier, cos or founder, never the builder): a changed page, or one
// nobody has signed, refuses every item that rests on it. Net-new. Pure.

import { MARKS_REVIEWERS, termsTextSha } from "./licences.mjs";
import { visibleText } from "./adapters/gov.mjs";
import { clip } from "./text.mjs";

/**
 * Each entry: the page, how its terms block is cut out (a start marker and an end marker in the HTML, both
 * included), the institution, the sha256 of the block's text, and the review. reviewed.by must be one of
 * MARKS_REVIEWERS for the entry to admit anything.
 */
export const STATE_TERMS = Object.freeze([
  Object.freeze({
    id: "kremlin-en",
    url: "http://en.kremlin.ru/about/copyrights",
    institution: "the Presidential Executive Office of Russia (kremlin.ru)",
    from: '<div class="lead">',
    to: "</div>",
    text_sha256: "77eee66a9826923de33cb8f818a3194582a4a7ccc065f417b57345100d6a1fde",
    // The v2 analyst brief (reports/briefs/omnibus-v2-analyst-brief.md) verified these terms on 2026-11-21: CC BY 4.0,
    // excluding RIA Novosti and TASS photographs; show bible v2 section n carries the ruling.
    reviewed: Object.freeze({ by: "cos", at: "2026-11-21", note: "CC BY 4.0 except RIA Novosti and TASS photographs, verified in the v2 analyst brief; bible v2 section n" }),
  }),
  Object.freeze({
    id: "kantei-en",
    url: "https://japan.kantei.go.jp/policies/terms_e.html",
    institution: "the Cabinet Secretariat (Prime Minister's Office of Japan)",
    from: "<article",
    to: "</article>",
    text_sha256: "19c0ce6b37cadc3fd53e30d4ed74a9110f9717230f7864bcbfaeeda0988c8cac",
    // Read by the T5 builder on 2026-11-21: the policy applies PDL1.0, not CC BY 4.0 by name. A builder's reading is
    // not a review (MARKS_REVIEWERS): kantei items stay refused until the CoS signs this entry and the next two.
    reviewed: Object.freeze({ by: "builder", at: "2026-11-21", note: "pending: the CoS confirms that PDL1.0 clause 1.7's CC BY grant is the kantei.go.jp licence bible v2 section n names" }),
  }),
  Object.freeze({
    id: "kantei-jp",
    url: "https://www.kantei.go.jp/jp/terms.html",
    institution: "the Cabinet Secretariat (Prime Minister's Office of Japan), the original Japanese policy",
    from: "<article",
    to: "</article>",
    text_sha256: "5688be39b99e2576d6bb1c8cdbb490d0915a49552f65471f9959fc012fd84695",
    reviewed: Object.freeze({ by: "builder", at: "2026-11-21", note: "pending CoS sign-off (see kantei-en)" }),
  }),
  Object.freeze({
    id: "pdl-1.0",
    url: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
    institution: "the Digital Agency of Japan (Public Data License 1.0)",
    from: "<article",
    to: "</article>",
    text_sha256: "af8f882e84b2f56e03c045f0e36eacf607c9a5e123c679e7b15ba547d8efe47e",
    reviewed: Object.freeze({ by: "builder", at: "2026-11-21", note: "pending CoS sign-off (see kantei-en); clause 1.7 grants use under CC BY 4.0" }),
  }),
]);

/** The terms block an entry names, cut from the page's HTML, as visible text; null when the markers are not found. */
export function termsBlock(html, entry) {
  const s = String(html ?? "");
  const a = s.indexOf(entry.from);
  if (a < 0) return null;
  const b = s.indexOf(entry.to, a + entry.from.length);
  if (b < 0) return null;
  const text = visibleText(s.slice(a, b + entry.to.length));
  return text.trim() ? text : null;
}

/**
 * Reads one terms page against its reviewed entry. Returns { text, sha256, problems }: problems is empty only
 * when the block is found, its hash is the reviewed one and the review names a checking role.
 */
export function readTerms(id, html, { terms = STATE_TERMS } = {}) {
  const entry = terms.find((t) => t.id === id);
  if (!entry) return { text: null, sha256: null, problems: [`no reviewed terms entry ${id}`] };
  const text = html == null ? null : termsBlock(html, entry);
  if (!text) return { text: null, sha256: null, entry, problems: [`the terms page ${entry.url} could not be read for its terms block`] };
  const sha256 = termsTextSha(text);
  const problems = [];
  if (sha256 !== entry.text_sha256) problems.push(`the terms at ${entry.url} differ from the reviewed text (sha256 ${sha256.slice(0, 12)}, reviewed ${String(entry.text_sha256).slice(0, 12)}): refused until they are reviewed again`);
  const by = String(entry.reviewed?.by ?? "");
  if (!MARKS_REVIEWERS.includes(by)) problems.push(`the terms at ${entry.url} are not signed by a checking role (${MARKS_REVIEWERS.join(", ")}): reviewed by ${by || "nobody"}${entry.reviewed?.note ? ` (${clip(entry.reviewed.note, 200)})` : ""}`);
  if (!entry.reviewed?.at) problems.push(`the terms review of ${entry.url} names no date`);
  return { text, sha256, entry, problems };
}
