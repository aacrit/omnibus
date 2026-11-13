// C5: where captured footage and its evidence live in R2, and the pure plans
// for adding to it and sweeping it. Bucket `omnibus-capture` (private):
//   capture/media/<sha256>.<ext>      a <=480p proxy, named by its content
//   capture/evidence/<sha256>.gz      a page or terms page (C4), gzipped, named
//                                     by the sha256 of its uncompressed bytes
//   capture/index.json                every item by source id ("<source>:<id>"),
//                                     the media and evidence it names, and the
//                                     bytes added per UTC day
// R2 bills past its free tier, so every size is capped here, in code
// (budget.yaml r2_storage_gb's capture lines; tests/capture-store.test.ts
// reads them): 40 MiB a file, 100 MiB a day, 1.5 GiB for the bucket, and
// evidence 100 MiB inside it. An over-cap put is refused and the item keeps
// its metadata and the reason. Dedupe is by source id first, then by sha256.
// Retention: unpinned media 14 days; pinned media until its episode airs plus
// 30 days; evidence 365 days (and the 100 MiB cap, oldest first), never while
// media it backs is kept.

import { lintMedia } from "../capture/evidence.mjs";

export const BUCKET = "omnibus-capture";
export const PREFIX = "capture";
export const INDEX_KEY = `${PREFIX}/index.json`;
export const INDEX_SCHEMA = "omnibus.capture-index/1";

const MiB = 1024 ** 2;
export const CAPS = Object.freeze({
  maxFileBytes: 40 * MiB,
  maxDayBytes: 100 * MiB,
  bucketCapBytes: 1.5 * 1024 ** 3,
  evidenceCapBytes: 100 * MiB,
});
export const RETENTION = Object.freeze({
  unpinnedMediaDays: 14,
  pinnedAfterAirsDays: 30,
  evidenceDays: 365,
});

const HEX64 = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{2,5}$/;
const DAY_MS = 86_400_000;

export const mediaKey = (sha256, ext) => {
  if (!HEX64.test(sha256 ?? "") || !EXT.test(ext ?? "")) throw new Error(`not a capture media key: ${sha256}.${ext}`);
  return `${PREFIX}/media/${sha256}.${ext}`;
};

export const evidenceKey = (sha256) => {
  if (!HEX64.test(sha256 ?? "")) throw new Error(`not a capture evidence key: ${sha256}`);
  return `${PREFIX}/evidence/${sha256}.gz`;
};

export const sourceId = (item) => {
  if (!item?.source || item?.id == null) throw new Error("a captured item needs source and id");
  return `${item.source}:${item.id}`;
};

export function emptyIndex() {
  return { schema: INDEX_SCHEMA, items: {}, media: {}, evidence: {}, days: {} };
}

/** The stored index. Absent is empty; present but unreadable throws (rewriting it would forget every item). */
export function readIndex(text) {
  if (text == null) return emptyIndex();
  let idx;
  try {
    idx = JSON.parse(text);
  } catch {
    throw new Error(`${INDEX_KEY} is not JSON; fix or remove it by hand before capturing`);
  }
  if (idx?.schema !== INDEX_SCHEMA || [idx.items, idx.media, idx.evidence, idx.days].some((m) => !m || typeof m !== "object" || Array.isArray(m))) {
    throw new Error(`${INDEX_KEY} is not a ${INDEX_SCHEMA} index; fix or remove it by hand before capturing`);
  }
  return idx;
}

export function serialiseIndex(index) {
  return JSON.stringify(index, null, 1) + "\n";
}

const sum = (m) => Object.values(m).reduce((n, x) => n + (Number.isFinite(x?.bytes) ? x.bytes : 0), 0);
export const mediaBytes = (index) => sum(index.media);
export const evidenceBytes = (index) => sum(index.evidence);
export const storedBytes = (index) => mediaBytes(index) + evidenceBytes(index);
const dayOf = (iso) => String(iso).slice(0, 10);

/**
 * The puts that add one item: `evidence` is C4's { record, blobs }, `media`
 * is { sha256, bytes, ext } for a proxy already on disk, or null for
 * metadata only. Returns { action, puts, refused, index }: action is
 * "duplicate" (this source id already holds media), "put", "metadata" or
 * "refused"; each put is { key, body } (an evidence blob) or { key, media:
 * sha256 } (the caller sends the file); the index goes last, after the puts.
 */
export function planPut({ index: indexIn, item, evidence, media = null, now, caps = CAPS }) {
  const index = structuredClone(indexIn);
  const sid = sourceId(item);
  const at = (now instanceof Date ? now : new Date(now)).toISOString().replace(/\.\d{3}Z$/, "Z");
  const today = dayOf(at);
  const prior = index.items[sid];
  if (prior?.media) return { action: "duplicate", puts: [], refused: [], index: indexIn };

  const refused = [];
  const puts = [];
  const record = evidence?.record ?? null;
  const entry = {
    source: item.source,
    id: String(item.id),
    url: item.url ?? null,
    title: item.title ?? null,
    listed_at: item.captured_at ?? null,
    evidence: record,
    evidence_keys: [],
    media: null,
    refused: null,
    pinned: prior?.pinned ?? null,
  };

  // Evidence first: it is kept even when the media is refused.
  let added = 0;
  const newBlobs = (evidence?.blobs ?? []).filter((b) => !index.evidence[b.sha256]);
  const blobBytes = newBlobs.reduce((n, b) => n + b.gz.length, 0);
  const evidenceRoom = evidenceBytes(index) + blobBytes <= caps.evidenceCapBytes;
  const dayRoom = (n) => (index.days[today] ?? 0) + added + n <= caps.maxDayBytes;
  const bucketRoom = (n) => storedBytes(index) + added + n <= caps.bucketCapBytes;
  if (!evidenceRoom) refused.push(`evidence: over the ${caps.evidenceCapBytes}-byte evidence cap`);
  else if (!dayRoom(blobBytes)) refused.push(`evidence: over the ${caps.maxDayBytes}-byte day cap`);
  else if (!bucketRoom(blobBytes)) refused.push(`evidence: over the ${caps.bucketCapBytes}-byte bucket cap`);
  else {
    for (const b of newBlobs) {
      puts.push({ key: evidenceKey(b.sha256), body: b.gz });
      index.evidence[b.sha256] = { bytes: b.gz.length, kind: b.kind, url: b.url ?? null, stored_at: at };
    }
    added += blobBytes;
  }
  const evidenceStored = refused.length === 0;
  if (evidenceStored) entry.evidence_keys = (evidence?.blobs ?? []).map((b) => b.sha256).filter((s, i, a) => a.indexOf(s) === i);

  if (media) {
    const candidate = { ...entry, media: { sha256: media.sha256, ext: media.ext, bytes: media.bytes } };
    const why = [];
    if (!evidenceStored) why.push("media: its evidence was not stored");
    why.push(...lintMedia(candidate).map((p) => `media: ${p}`));
    if (!EXT.test(media.ext ?? "") || !HEX64.test(media.sha256 ?? "")) why.push("media: not a sha256 and extension");
    if (!(Number.isInteger(media.bytes) && media.bytes > 0)) why.push("media: no size");
    else if (media.bytes > caps.maxFileBytes) why.push(`media: ${media.bytes} bytes is over the ${caps.maxFileBytes}-byte file cap`);
    const held = HEX64.test(media.sha256 ?? "") ? index.media[media.sha256] : null;
    if (!why.length && !held) {
      if (!dayRoom(media.bytes)) why.push(`media: over the ${caps.maxDayBytes}-byte day cap`);
      else if (!bucketRoom(media.bytes)) why.push(`media: over the ${caps.bucketCapBytes}-byte bucket cap`);
    }
    if (why.length) refused.push(...why);
    else {
      if (!held) {
        puts.push({ key: mediaKey(media.sha256, media.ext), media: media.sha256 });
        index.media[media.sha256] = { bytes: media.bytes, ext: media.ext, stored_at: at };
        added += media.bytes;
      }
      entry.media = { sha256: media.sha256, ext: media.ext, bytes: media.bytes, key: mediaKey(media.sha256, media.ext), stored_at: held?.stored_at ?? at };
    }
  }

  entry.refused = refused.length ? refused : null;
  if (added) index.days[today] = (index.days[today] ?? 0) + added;
  index.items[sid] = entry;
  const action = entry.media ? "put" : refused.length ? "refused" : "metadata";
  return { action, puts, refused, index };
}

/** Pins an item's media to an episode: kept until `airs_on` plus 30 days (until it airs, when no date is set yet). */
export function pin(indexIn, sid, { issue, airs_on = null }) {
  const index = structuredClone(indexIn);
  const e = index.items[sid];
  if (!e) throw new Error(`no captured item ${sid}`);
  e.pinned = { issue, airs_on };
  return index;
}

export function unpin(indexIn, sid) {
  const index = structuredClone(indexIn);
  if (index.items[sid]) index.items[sid].pinned = null;
  return index;
}

/** Whether an entry's media is still kept at `t` (ms). */
export function mediaKept(entry, t, retention = RETENTION) {
  if (!entry.media) return false;
  if (entry.pinned) {
    if (!entry.pinned.airs_on) return true;
    return t <= Date.parse(`${entry.pinned.airs_on}T23:59:59Z`) + retention.pinnedAfterAirsDays * DAY_MS;
  }
  return t <= Date.parse(entry.media.stored_at) + retention.unpinnedMediaDays * DAY_MS;
}

function evidenceTime(entry) {
  const t = Date.parse(entry.evidence?.captured_at ?? entry.listed_at ?? "");
  return Number.isFinite(t) ? t : 0;
}

/**
 * The retention sweep. Returns { index, deletes }: deletes are keys to remove
 * after the new index has landed. Media goes when no kept entry names it;
 * an entry without media goes at 365 days, or oldest first while evidence is
 * over its cap; an evidence blob goes when no remaining entry names it.
 * Pinned media, and the evidence behind any kept media, always stay.
 */
export function sweep({ index: indexIn, now, retention = RETENTION, caps = CAPS }) {
  const index = structuredClone(indexIn);
  const t = (now instanceof Date ? now : new Date(now)).getTime();
  const at = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  const deletes = [];

  for (const e of Object.values(index.items)) {
    if (e.media && !mediaKept(e, t, retention)) {
      e.media_swept_at = at;
      e.media = null;
    }
  }
  const mediaNamed = new Set(Object.values(index.items).flatMap((e) => (e.media ? [e.media.sha256] : [])));
  for (const [sha, m] of Object.entries(index.media)) {
    if (!mediaNamed.has(sha)) {
      deletes.push(mediaKey(sha, m.ext));
      delete index.media[sha];
    }
  }

  for (const [sid, e] of Object.entries(index.items)) {
    if (!e.media && t - evidenceTime(e) > retention.evidenceDays * DAY_MS) delete index.items[sid];
  }
  const named = () => {
    const s = new Map();
    for (const e of Object.values(index.items)) for (const sha of e.evidence_keys ?? []) s.set(sha, (s.get(sha) ?? 0) + 1);
    return s;
  };
  const dropUnnamed = () => {
    const n = named();
    for (const sha of Object.keys(index.evidence)) {
      if (!n.has(sha)) {
        deletes.push(evidenceKey(sha));
        delete index.evidence[sha];
      }
    }
  };
  dropUnnamed();
  if (evidenceBytes(index) > caps.evidenceCapBytes) {
    const oldest = Object.entries(index.items)
      .filter(([, e]) => !e.media)
      .sort(([, a], [, b]) => evidenceTime(a) - evidenceTime(b));
    for (const [sid] of oldest) {
      if (evidenceBytes(index) <= caps.evidenceCapBytes) break;
      delete index.items[sid];
      dropUnnamed();
    }
  }
  // The day ledger only needs today and yesterday.
  for (const d of Object.keys(index.days)) if (Date.parse(`${d}T00:00:00Z`) < t - 2 * DAY_MS) delete index.days[d];
  return { index, deletes: [...new Set(deletes)] };
}

/**
 * Runs a plan against a store { put(key, body), delete(key) } ({ key, media }
 * puts are read by `mediaBody(sha256)`): the puts first, then the index, then
 * the deletes, so a reader that finds the index finds every object it names.
 */
export function commit(store, { puts = [], deletes = [], index }, { mediaBody = null } = {}) {
  for (const p of puts) {
    if (p.media) {
      if (!mediaBody) throw new Error(`no media body for ${p.key}`);
      store.put(p.key, mediaBody(p.media));
    } else store.put(p.key, p.body);
  }
  store.put(INDEX_KEY, serialiseIndex(index));
  for (const k of deletes) store.delete(k);
}
