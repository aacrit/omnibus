// Text helpers for metadata read from source APIs. Pure.
//
// plain() is transplanted from void document
// (aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193:studio/engine/titles.py plain()),
// ported to JavaScript: a file page's attribution as words, its HTML taken out
// and an author printed twice by that markup said once. Tweaked: hidden
// elements (Commons wraps machine dates in display:none divs) are dropped
// with their content, and HTML entities are decoded without a DOM.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©" };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const DOUBLED = /^(.{4,}?)\1$/s;
const ANON_UNKNOWN = /^(Anonymous)\s*Unknown author$/i;

/** HTML to plain words: hidden elements dropped, tags removed, entities decoded, space collapsed. */
export function plain(text) {
  let t = String(text ?? "");
  t = t.replace(/<(div|span)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, "");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t).replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(");
  const m = t.match(DOUBLED) ?? t.match(ANON_UNKNOWN);
  return m ? m[1] : t;
}

/** The first date in free text as YYYY, YYYY-MM or YYYY-MM-DD, or null. */
export function firstDate(text) {
  const t = plain(text);
  const full = t.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (full && full[2] !== "00") return full[3] === "00" ? `${full[1]}-${full[2]}` : `${full[1]}-${full[2]}-${full[3]}`;
  const ym = t.match(/(?<!\d)(\d{4})-(\d{2})(?![\d-])/);
  if (ym && ym[2] !== "00") return `${ym[1]}-${ym[2]}`;
  const y = t.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return y ? y[1] : null;
}

/** A timestamp as an ISO second-precision UTC string, or null. */
export function isoSecond(ts) {
  const t = Date.parse(String(ts ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

export function clip(s, n) {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}
