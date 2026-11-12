// Where snapshots live in R2, and the pure plan for copying one there.
// Keys (bucket `omnibus`):
//   snapshots/<date>/<file>        the snapshot's files, then its manifest
//   snapshots/index.json           every stored date, oldest first
//   snapshots/latest.json          the newest printed date's manifest summary
//   snapshots/heartbeat.json       the last successful run, written every run;
//                                  the Worker serves it at /api/snapshots/heartbeat
// Data files go first, the manifest after them, the index and pointers
// last: a reader that finds a manifest finds every file it names.

import { isDate, isSnapshotPath, validateManifest } from "./snapshot.mjs";

export const BUCKET = "omnibus";
export const PREFIX = "snapshots";
export const INDEX_KEY = `${PREFIX}/index.json`;
export const LATEST_KEY = `${PREFIX}/latest.json`;
export const HEARTBEAT_KEY = `${PREFIX}/heartbeat.json`;

// This product's share of the account's 10 GB of free R2 storage. R2 bills
// past its free tier, so the uploader refuses to grow the bucket past it
// (budget.yaml r2_storage_gb; the document product shares the account).
export const BUCKET_CAP_BYTES = 3 * 1024 ** 3;

export const fileKey = (date, rel) => {
  if (!isDate(date) || !isSnapshotPath(rel)) throw new Error(`not a snapshot key: ${date}/${rel}`);
  return `${PREFIX}/${date}/${rel}`;
};

export const manifestKey = (date) => {
  if (!isDate(date)) throw new Error(`not a snapshot date: ${date}`);
  return `${PREFIX}/${date}/manifest.json`;
};

/** A summary of a manifest small enough for the index and the pointers. */
export function summary(m) {
  return {
    date: m.date,
    printed_at: m.printed_at,
    commit: m.source.commit,
    content_sha256: m.content_sha256,
    weekly_issue: m.weekly_issue ?? null,
    files: m.files.length,
    missing: m.missing.length,
    total_bytes: m.total_bytes,
  };
}

function parseJson(text) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readIndex(text) {
  const idx = parseJson(text);
  if (!idx || idx.schema !== 1 || !Array.isArray(idx.dates)) return { schema: 1, dates: [] };
  return { schema: 1, dates: idx.dates.filter((d) => isDate(d?.date)) };
}

/**
 * The puts that store `manifest` (already checked against its local files).
 * `remote` holds what R2 has now: { manifest, index, latest } as text or null.
 * Returns { action, puts } with puts in upload order; each put is
 * { key, rel } for a snapshot file or { key, body } for JSON written here.
 */
export function planUpload({ manifest, remote, ranAt }) {
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`manifest is not valid: ${problems.join("; ")}`);
  const stored = parseJson(remote.manifest);
  const same = stored && validateManifest(stored).length === 0 && stored.content_sha256 === manifest.content_sha256;
  const action = !stored ? "write" : same ? "unchanged" : "replace";

  const puts = [];
  if (action !== "unchanged") {
    for (const f of manifest.files) puts.push({ key: fileKey(manifest.date, f.path), rel: f.path });
    puts.push({ key: manifestKey(manifest.date), body: JSON.stringify(manifest, null, 2) + "\n" });

    const index = readIndex(remote.index);
    const entry = summary(manifest);
    index.dates = [...index.dates.filter((d) => d.date !== manifest.date), entry].sort((a, b) => a.date.localeCompare(b.date));
    puts.push({ key: INDEX_KEY, body: JSON.stringify(index, null, 2) + "\n" });

    // A late or replayed older date never moves the pointer back.
    const latest = parseJson(remote.latest);
    if (!latest || !isDate(latest.date) || latest.date <= manifest.date) {
      puts.push({ key: LATEST_KEY, body: JSON.stringify(entry, null, 2) + "\n" });
    }
  }
  puts.push({
    key: HEARTBEAT_KEY,
    body: JSON.stringify({ schema: 1, ran_at: ranAt, result: action, date: manifest.date, printed_at: manifest.printed_at, content_sha256: manifest.content_sha256 }, null, 2) + "\n",
  });
  return { action, puts };
}

/** Bytes this plan adds to the bucket, at most (snapshot files plus the JSON written here). */
export function planBytes(manifest, puts) {
  const sizes = new Map(manifest.files.map((f) => [f.path, f.bytes]));
  return puts.reduce((n, p) => n + (p.rel ? sizes.get(p.rel) ?? 0 : Buffer.byteLength(p.body)), 0);
}
