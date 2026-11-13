// void news's own printed pages as rostrum stills (founder ruling, chat
// 2026-11-12: ledger class own_property, same owner). The rules that decide
// whether a capture of one of its pages may enter the ledger, and the region
// of the page the still holds. Pure: the browser (scripts/capture_page.py),
// git and the disk are the caller's (scripts/rights.mjs capture). Net-new.
//
// A page is the edition only when it was served as it: a Cloudflare Pages
// deployment built from a commit whose printed-edition record holds the
// edition, deployed after the edition was printed and before the next one
// was, and whose headlines are that edition's rows in the edition's order.
// Every raster picture on the page (an outlet's mark, a Commons photograph,
// even one served from our own host) is treated as someone else's: the still
// is the full-width band of the page that holds the tour target and no
// picture at all. Nothing is blurred; what is left out is recorded.

import { isOwnUrl } from "./http.mjs";

export const PAGE_WIDTH = 1920;
/** Space kept between the still's edge and any picture left out of it. */
export const PICTURE_MARGIN = 8;
export const MAX_PICTURES_RECORDED = 200;

/** A headline as compared: lower case, letters and digits only. */
export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);

export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** The headings a page prints its stories under: the Paper's article heads, or a story page's one h1. */
export function pageHeadlines(kind, heads) {
  const list = Array.isArray(heads) ? heads : [];
  if (kind === "paper") return list.filter((h) => h.tag === "h2" && /\bnp-article__headline\b/.test(String(h.cls ?? "")));
  if (kind === "story") return list.filter((h) => h.tag === "h1").slice(0, 1);
  return [];
}

/**
 * Whether the page's headlines are the edition's: each matched to a row of
 * the edition by its text, in the edition's order. rows are the edition's
 * archive rows ({ id, pos, title }) sorted by position. For a story page the
 * one h1 must be the target row's title.
 */
export function editionCheck({ kind, heads, rows, targetId }) {
  const shown = pageHeadlines(kind, heads);
  const byTitle = new Map(rows.map((r) => [norm(r.title), r]));
  const positions = [];
  const unmatched = [];
  for (const h of shown) {
    const r = byTitle.get(norm(h.text));
    if (r) positions.push(r.pos);
    else unmatched.push(h.text);
  }
  const inOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
  const problems = [];
  if (!shown.length) problems.push(`the page prints no ${kind === "story" ? "story headline" : "article headlines"}`);
  if (unmatched.length) problems.push(`${unmatched.length} headline(s) on the page are not rows of the edition, first "${unmatched[0].slice(0, 120)}"`);
  if (!inOrder) problems.push("the page's headlines are not in the edition's order");
  if (kind === "story") {
    const target = rows.find((r) => r.id === targetId);
    if (!target || norm(shown[0]?.text) !== norm(target.title)) problems.push("the story page's headline is not the target row's title");
  }
  return { kind, headlines: shown.length, matched: positions.length, in_order: inOrder, first_position: positions[0] ?? null, problems };
}

/** The tour target's heading box on the page: the heading whose text is the target row's title. */
export function targetBox({ kind, heads, title }) {
  const h = pageHeadlines(kind, heads).find((x) => norm(x.text) === norm(title));
  return h ? { ...h.box } : null;
}

/** Every picture element with an area, treated as not ours whatever its host. */
export function picturesOnPage(pics) {
  return (Array.isArray(pics) ? pics : []).filter((p) => p?.box && area(p.box) > 0).map((p) => ({ tag: String(p.tag ?? ""), src: String(p.src ?? "").slice(0, 300), box: { ...p.box } }));
}

/**
 * The full-width band of the page that holds the target and no picture, or
 * null when no such band exists. A page with no pictures is held whole.
 */
export function chooseRegion({ width = PAGE_WIDTH, height, pictures, target }) {
  const page = { x: 0, y: 0, w: width, h: height };
  const pics = pictures.map((p) => p.box).filter((b) => intersects(b, page)).sort((a, b) => a.y - b.y);
  if (!pics.length) return page;
  const bands = [];
  let top = 0;
  for (const b of pics) {
    const end = b.y - PICTURE_MARGIN;
    if (end > top) bands.push({ x: 0, y: top, w: width, h: end - top });
    top = Math.max(top, b.y + b.h + PICTURE_MARGIN);
  }
  if (height > top) bands.push({ x: 0, y: top, w: width, h: height - top });
  const clear = bands.filter((band) => !pics.some((b) => intersects(b, band)));
  if (target) return clear.find((band) => contains(band, target)) ?? null;
  return clear.sort((a, b) => b.h - a.h)[0] ?? null;
}

const HEX40 = /^[0-9a-f]{40}$/;
const t = (s) => Date.parse(String(s ?? ""));

/**
 * Every reason an own-page capture record cannot stand (the record kept in
 * a ledger item's own_property, re-checked by the lint). Empty when sound.
 */
export function captureProblems(rec) {
  const out = [];
  if (!rec || typeof rec !== "object") return ["no capture record"];
  const dep = rec.deployment ?? {};
  if (!isOwnUrl(dep.url)) out.push(`deployment ${dep.url} is not one of void news's own hosts`);
  if (!isOwnUrl(rec.page_url) || !String(rec.page_url).startsWith(String(dep.url))) out.push(`page ${rec.page_url} is not on the deployment ${dep.url}`);
  if (!HEX40.test(String(rec.data_commit ?? ""))) out.push("the commit the page was built from is not a full sha");
  const deployed = t(dep.created_at);
  const printed = t(rec.printed_at);
  if (!Number.isFinite(deployed) || !Number.isFinite(printed)) out.push("the deployment or print time cannot be read");
  else {
    if (deployed < printed) out.push(`deployed ${dep.created_at}, before the edition was printed ${rec.printed_at}`);
    if (rec.next_edition_at != null && !(deployed < t(rec.next_edition_at))) out.push(`deployed ${dep.created_at}, once the next edition (${rec.next_edition_at}) was printed, so the page was not this edition's`);
  }
  const ec = rec.edition_check ?? {};
  if (!(ec.matched >= 1) || ec.in_order !== true || ec.matched !== ec.headlines) out.push("the page's headlines are not the edition's rows in order");
  const page = { x: 0, y: 0, w: rec.page?.width, h: rec.page?.height };
  const reg = rec.region;
  if (!reg || !(reg.h > 0) || reg.x !== 0 || reg.w !== page.w || reg.y < 0 || reg.y + reg.h > page.h) out.push("the still's region is not a full-width band inside the page");
  else {
    const hit = (rec.pictures_excluded ?? []).find((p) => p?.box && area(p.box) > 0 && intersects(p.box, reg));
    if (hit) out.push(`the still's region holds a picture that is not ours (${String(hit.src).slice(0, 120)})`);
    if (rec.tour_target?.box && !contains(reg, rec.tour_target.box)) out.push("the tour target lies outside the still's region");
  }
  if (rec.page?.width !== PAGE_WIDTH) out.push(`the page was not captured ${PAGE_WIDTH} wide`);
  return out;
}

/**
 * The edition a printed-edition record (archive.json rows) holds for a date:
 * its rows in position order, when it was printed (its earliest row's
 * created_at) and when the next edition after it was printed (or null).
 */
export function editionOf(archiveRows, date) {
  const rows = archiveRows
    .filter((r) => r.printed_on === date)
    .sort((a, b) => a.edition_position - b.edition_position)
    .map((r) => ({ id: r.id, pos: r.edition_position, title: r.title, cluster: r.source_cluster_id, created_at: r.created_at }));
  if (!rows.length) return null;
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const printed = rows.map((r) => t(r.created_at)).filter(Number.isFinite);
  const later = [...new Set(archiveRows.filter((r) => r.printed_on > date).map((r) => r.printed_on))].sort()[0];
  const nextRows = later ? archiveRows.filter((r) => r.printed_on === later).map((r) => t(r.created_at)).filter(Number.isFinite) : [];
  return {
    date,
    rows,
    printed_at: printed.length ? iso(Math.min(...printed)) : null,
    next_edition_at: nextRows.length ? iso(Math.min(...nextRows)) : null,
  };
}
