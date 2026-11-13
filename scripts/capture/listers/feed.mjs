// Shared, pure helpers for the capture listers (C2): an RSS 2.0 / Atom reader
// without a DOM, the one item shape every lister yields, and the default
// look-back window. Every lister takes its HTTP as an argument (the
// fetcher's http.mjs getText/getJson, or a fake in tests) and never touches
// media: a lister writes locators and metadata only.

import { decodeEntities, isoSecond, plain } from "../../lib/rights/text.mjs";

/** How far back a run lists by default: the last 72 hours are re-scored every run (capture design). */
export const LOOKBACK_HOURS = 72;

export function defaultSince(now = new Date()) {
  return new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The one shape every lister yields: { source, id, url, title, description,
 * published_at, captured_at } plus the source's own extra fields. published_at
 * is the source's own field, never a guess; captured_at is when we listed it.
 */
export function makeItem({ source, id, url, title, description = "", published_at = null, captured_at, ...extra }) {
  if (!source || !id || !url) throw new Error(`a listed item needs source, id and url (got ${source}, ${id}, ${url})`);
  return {
    source,
    id: String(id),
    url: String(url),
    title: clipText(title, 400),
    description: clipText(description, 2000),
    published_at: published_at ? isoSecond(published_at) : null,
    captured_at,
    ...extra,
  };
}

function clipText(s, n) {
  const t = plain(String(s ?? ""));
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

function unCdata(s) {
  return String(s ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unCdata(m[1]).trim() : null;
}

function tags(xml, name) {
  return [...String(xml).matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => unCdata(m[1]).trim());
}

function attr(xml, el, name) {
  const m = String(xml).match(new RegExp(`<${el}\\b[^>]*\\b${name}=["']([^"']*)["']`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

/**
 * Pure: the entries of an RSS 2.0 or Atom document, as raw fields
 * { title, link, guid, description, content, published, author, categories, enclosure }.
 * Text fields keep their HTML (decoded from CDATA); callers decide what to keep.
 */
export function parseFeed(xml) {
  const doc = String(xml ?? "");
  const rss = [...doc.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (rss.length) {
    return rss.map((it) => ({
      title: decodeEntities(tag(it, "title") ?? ""),
      link: decodeEntities(tag(it, "link") ?? ""),
      guid: decodeEntities(tag(it, "guid") ?? ""),
      description: tag(it, "description") ?? "",
      content: tag(it, "content:encoded") ?? "",
      published: tag(it, "pubDate") ?? tag(it, "dc:date") ?? null,
      author: decodeEntities(tag(it, "dc:creator") ?? tag(it, "author") ?? ""),
      categories: tags(it, "category").map((c) => decodeEntities(c)),
      enclosure: attr(it, "enclosure", "url"),
    }));
  }
  return [...doc.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => {
    const it = m[1];
    return {
      title: decodeEntities(tag(it, "title") ?? ""),
      link: attr(it, "link", "href") ?? "",
      guid: decodeEntities(tag(it, "id") ?? ""),
      description: tag(it, "summary") ?? "",
      content: tag(it, "content") ?? "",
      published: tag(it, "published") ?? tag(it, "updated") ?? null,
      author: decodeEntities(tag(tag(it, "author") ?? "", "name") ?? ""),
      categories: [...it.matchAll(/<category\b[^>]*\bterm=["']([^"']*)["']/gi)].map((c) => decodeEntities(c[1])),
      enclosure: null,
    };
  });
}

/** Whether an item's own time is at or after the window's start (an item with no time is kept: the scorer decides). */
export function inWindow(publishedAt, since) {
  if (!since || !publishedAt) return true;
  const t = Date.parse(publishedAt);
  return !Number.isFinite(t) || t >= Date.parse(since);
}

/** Every YouTube video id a text names (watch, embed, youtu.be, nocookie). */
export function youtubeIds(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^"'\s<>]*&(?:amp;)?)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g)) out.push(m[1]);
  return [...new Set(out)];
}

/** The capture time every lister stamps: an ISO UTC second. */
export function stamp(now = new Date()) {
  return isoSecond(now.toISOString());
}

/** An https URL, or null (a feed link that is not https is not a locator we keep). */
export function httpsUrl(u) {
  try {
    const x = new URL(String(u ?? "").trim());
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
}
