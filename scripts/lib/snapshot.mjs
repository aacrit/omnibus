// Pure parts of the daily snapshot (bible section h, stage 1): what a
// snapshot holds, how its files are checked and hashed, the manifest, the
// size caps, and what to do when a snapshot of the same printed day already
// exists. No I/O here; scripts/snapshot.mjs fetches and writes, and
// scripts/snapshot-r2.mjs uploads.
//
// A snapshot is one printed day of void news, read from its public repo at
// one pinned commit, so every file in it is the same printed state:
//   feed.json      frontend/build-data/feed.json   (the printed day, in order)
//   weekly.json    frontend/public/data/weekly.json (the latest weekly issue)
//   sources.json   data/sources.json                (outlet ratings that day)
//   deepdive/<id>.json  frontend/public/data/deepdive/<id>.json, one per
//                  printed cluster. void news keeps a deep dive only while
//                  its cluster is printed, which is why this runs daily.
//
// Snapshots are keyed by the printed date (the feed's builtAt, UTC), never
// by the capture time: void news prints anywhere from noon to late evening,
// so a capture at 12:00 often still holds the previous day's edition.

import { createHash } from "node:crypto";

export const VOIDNEWS_REPO = "aacrit/void--news";
export const RAW_BASE = `https://raw.githubusercontent.com/${VOIDNEWS_REPO}`;
export const BLOB_BASE = `https://github.com/${VOIDNEWS_REPO}/blob`;

export const PATHS = {
  feed: "frontend/build-data/feed.json",
  weekly: "frontend/public/data/weekly.json",
  sources: "data/sources.json",
  deepdive: (id) => `frontend/public/data/deepdive/${id}.json`,
};

// R2 bills past its free tier, so every size is capped here, before any
// upload. The largest real files (2026-11-12): sources.json 478 KB, a deep
// dive 169 KB, feed.json 185 KB; a whole day about 2.5 MB. At the total cap
// a year of daily snapshots is under 3 GB of the account's 10 GB
// (budget.yaml r2_storage_gb).
export const LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxDeepDives: 60,
});

// A cluster id becomes a file name and an R2 key, and it comes from the
// network, so it is held to void news's uuid shape and nothing else.
const CLUSTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA = /^[0-9a-f]{40}$/;

export function isClusterId(id) {
  return typeof id === "string" && CLUSTER_ID.test(id);
}

export function isDate(s) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isCommit(s) {
  return typeof s === "string" && SHA.test(s);
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isIso = (v) => isStr(v) && !Number.isNaN(Date.parse(v));

/** Shape errors in a printed feed; an empty list means it is usable. */
export function validateFeed(feed) {
  if (!isObj(feed)) return ["feed is not an object"];
  const errors = [];
  if (!isIso(feed.builtAt)) errors.push("feed.builtAt is not a timestamp");
  if (!Array.isArray(feed.clusters) || feed.clusters.length === 0) {
    errors.push("feed.clusters is not a non-empty list");
    return errors;
  }
  feed.clusters.forEach((c, i) => {
    if (!isObj(c)) return errors.push(`clusters[${i}] is not an object`);
    if (!isClusterId(c.id)) errors.push(`clusters[${i}].id is not a cluster id`);
    if (!isStr(c.title)) errors.push(`clusters[${i}].title is missing`);
    if (!Number.isInteger(c.source_count) || c.source_count < 0) errors.push(`clusters[${i}].source_count is not a count`);
  });
  return errors;
}

/** Shape errors in weekly.json (the latest weekly issue). */
export function validateWeekly(w) {
  if (!isObj(w)) return ["weekly is not an object"];
  const errors = [];
  if (!Number.isInteger(w.issue_number) || w.issue_number < 1) errors.push("weekly.issue_number is not an issue number");
  if (!isDate(w.week_start)) errors.push("weekly.week_start is not a date");
  if (!isDate(w.week_end)) errors.push("weekly.week_end is not a date");
  if (!isIso(w.created_at)) errors.push("weekly.created_at is not a timestamp");
  return errors;
}

/** Shape errors in sources.json (outlet ratings). */
export function validateSources(s) {
  if (!Array.isArray(s) || s.length === 0) return ["sources is not a non-empty list"];
  const bad = s.findIndex((o) => !isObj(o) || !isStr(o.name));
  return bad === -1 ? [] : [`sources[${bad}] has no name`];
}

/** Shape errors in one deep dive: a list (or keyed object) of { article }. */
export function validateDeepDive(dd) {
  const rows = Array.isArray(dd) ? dd : isObj(dd) ? Object.values(dd) : null;
  if (!rows) return ["deep dive is not a list"];
  const bad = rows.findIndex((r) => !isObj(r?.article) || !isStr(r.article.url) || !isStr(r.article.title) || !isStr(r.article.source?.name));
  return bad === -1 ? [] : [`deep dive row ${bad} is not an article with url, title and source`];
}

/** The printed date of a feed: its builtAt, in UTC. */
export function printedDate(feed) {
  return new Date(feed.builtAt).toISOString().slice(0, 10);
}

/** Deep dives to fetch: every printed cluster, in printed order, capped, ids checked. */
export function planDeepDives(feed, limits = LIMITS) {
  const ids = [];
  const skipped = [];
  for (const c of feed.clusters) {
    if (!isClusterId(c.id)) continue; // validateFeed already refused a feed with one
    if (ids.includes(c.id)) continue;
    if (ids.length >= limits.maxDeepDives) skipped.push({ cluster_id: c.id, reason: "over_file_cap" });
    else ids.push(c.id);
  }
  return { ids, skipped };
}

/**
 * The manifest of one snapshot. `content_sha256` covers what was printed
 * (each file's path and hash, and what was missing), not when it was
 * captured, so two captures of the same edition have the same value.
 */
export function buildManifest({ date, printedAt, commit, capturedAt, files, missing, weeklyIssue = null }) {
  if (!isDate(date)) throw new Error(`manifest date ${JSON.stringify(date)} is not a date`);
  if (!isCommit(commit)) throw new Error("manifest commit is not a sha");
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const gone = [...missing].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id));
  const content = [
    `date ${date}`,
    `printed_at ${printedAt}`,
    `commit ${commit}`,
    ...sorted.map((f) => `file ${f.path} ${f.sha256} ${f.bytes}`),
    ...gone.map((m) => `missing ${m.cluster_id} ${m.reason}`),
  ].join("\n");
  return {
    schema: 1,
    date,
    printed_at: printedAt,
    captured_at: capturedAt,
    // The weekly issue this day's weekly.json holds, so a reader can find an
    // issue's snapshot from the index without opening every weekly.json.
    weekly_issue: weeklyIssue,
    source: { repo: `https://github.com/${VOIDNEWS_REPO}`, commit },
    files: sorted,
    missing: gone,
    total_bytes: sorted.reduce((n, f) => n + f.bytes, 0),
    content_sha256: sha256Hex(content),
  };
}

/** Cap violations for a set of files about to be stored. */
export function checkCaps(files, limits = LIMITS) {
  const errors = [];
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    if (f.bytes > limits.maxFileBytes) errors.push(`${f.path} is ${f.bytes} bytes, over the ${limits.maxFileBytes}-byte file cap`);
  }
  if (total > limits.maxTotalBytes) errors.push(`snapshot is ${total} bytes, over the ${limits.maxTotalBytes}-byte total cap`);
  return errors;
}

/**
 * What to do given the manifest already stored for this printed date (or
 * null): "write" a new date, "unchanged" when the same edition is already
 * held (a re-run writes nothing), or "replace" when void news reprinted the
 * same date (the later printing wins, as normalise-week's git source takes
 * the day's last commit).
 */
export function decideWrite(existing, next) {
  if (!existing) return "write";
  return existing.content_sha256 === next.content_sha256 ? "unchanged" : "replace";
}

/** Shape errors in a stored manifest read back from disk or R2. */
export function validateManifest(m) {
  if (!isObj(m)) return ["manifest is not an object"];
  const errors = [];
  if (m.schema !== 1) errors.push("manifest.schema is not 1");
  if (!isDate(m.date)) errors.push("manifest.date is not a date");
  if (!isCommit(m.source?.commit)) errors.push("manifest.source.commit is not a sha");
  if (!/^[0-9a-f]{64}$/.test(m.content_sha256 ?? "")) errors.push("manifest.content_sha256 is not a sha256");
  if (!Array.isArray(m.files)) errors.push("manifest.files is not a list");
  else
    for (const f of m.files) {
      if (!isSnapshotPath(f?.path)) errors.push(`manifest file path ${JSON.stringify(f?.path)} is not a snapshot path`);
      if (!/^[0-9a-f]{64}$/.test(f?.sha256 ?? "")) errors.push(`manifest file ${JSON.stringify(f?.path)} has no sha256`);
    }
  return errors;
}

/** The only relative paths a snapshot may hold: no traversal, no other names. */
export function isSnapshotPath(p) {
  if (p === "feed.json" || p === "weekly.json" || p === "sources.json") return true;
  const m = typeof p === "string" ? /^deepdive\/(.+)\.json$/.exec(p) : null;
  return !!m && isClusterId(m[1]);
}

/** The public blob URL of a snapshot file at its pinned commit. */
export function blobUrl(commit, relPath) {
  const repoPath =
    relPath === "feed.json"
      ? PATHS.feed
      : relPath === "weekly.json"
        ? PATHS.weekly
        : relPath === "sources.json"
          ? PATHS.sources
          : PATHS.deepdive(relPath.slice("deepdive/".length, -".json".length));
  return `${BLOB_BASE}/${commit}/${repoPath}`;
}
