// Where snapshots live in R2, and the pure plan for copying one there.
// Keys (bucket `omnibus`):
//   snapshots/<date>/blobs/<sha256>.json  each file, named by its content, so
//                                  an object a manifest names is never
//                                  overwritten; the manifest maps paths to
//                                  them
//   snapshots/<date>/manifest.json the date's snapshot
//   snapshots/index.json           every stored date, oldest first
//   snapshots/latest.json          the newest printed date's summary
//   snapshots/heartbeat.json       the last successful run, written every run;
//                                  the Worker serves it at /api/snapshots/heartbeat
// New blobs go first, then the manifest, the index and the pointer; blobs
// the new manifest no longer names are deleted only after it has landed, and
// the heartbeat is last. A reader that finds a manifest finds every blob it
// names, whenever it reads.

import { isDate, planSnapshot, validateManifest } from "./snapshot.mjs";

export const BUCKET = "omnibus";
export const PREFIX = "snapshots";
export const INDEX_KEY = `${PREFIX}/index.json`;
export const LATEST_KEY = `${PREFIX}/latest.json`;
export const HEARTBEAT_KEY = `${PREFIX}/heartbeat.json`;

// This product's share of the account's 10 GB of free R2 storage. R2 bills
// past its free tier, so the uploader refuses to grow the bucket past it
// (budget.yaml r2_storage_gb; the document product shares the account).
export const BUCKET_CAP_BYTES = 3 * 1024 ** 3;

const HEX64 = /^[0-9a-f]{64}$/;

export const blobKey = (date, sha256) => {
  if (!isDate(date) || !HEX64.test(sha256 ?? "")) throw new Error(`not a snapshot blob key: ${date}/${sha256}`);
  return `${PREFIX}/${date}/blobs/${sha256}.json`;
};

export const manifestKey = (date) => {
  if (!isDate(date)) throw new Error(`not a snapshot date: ${date}`);
  return `${PREFIX}/${date}/manifest.json`;
};

/** A summary of a manifest small enough for the index and the pointer. */
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

/**
 * The stored index. Absent means no dates yet; present but unreadable throws,
 * because rewriting it from one date would silently forget every other.
 */
export function readIndex(text) {
  if (text == null) return { schema: 1, dates: [] };
  let idx;
  try {
    idx = JSON.parse(text);
  } catch {
    throw new Error(`${INDEX_KEY} is not JSON; fix or remove it by hand before uploading`);
  }
  if (idx?.schema !== 1 || !Array.isArray(idx.dates) || idx.dates.some((d) => !isDate(d?.date))) {
    throw new Error(`${INDEX_KEY} is not a schema 1 index; fix or remove it by hand before uploading`);
  }
  return idx;
}

/** The bytes the index says are stored: a floor under the bucket's own size figure. */
export function indexedBytes(index) {
  return index.dates.reduce((n, d) => n + (Number.isFinite(d.total_bytes) ? d.total_bytes : 0), 0);
}

function readStoredManifest(text) {
  if (text == null) return null;
  try {
    const m = JSON.parse(text);
    return validateManifest(m).length === 0 ? m : null;
  } catch {
    return null; // a damaged manifest is replaced: its blobs are re-sent
  }
}

/**
 * The puts and deletes that store the local snapshot `local` (a manifest
 * already checked against its files) beside what R2 holds: `remote` =
 * { manifest, index, latest } as text or null. The stored and local
 * captures meet through planSnapshot, so a capture that holds less than R2
 * never removes anything from the same edition.
 *
 * Returns { action, manifest, puts, deletes }: each put is
 * { key, sha256 } for a blob from the local snapshot or { key, body };
 * deletes run after the manifest has landed.
 */
export function planUpload({ local, remote, ranAt, limits }) {
  const problems = validateManifest(local);
  if (problems.length) throw new Error(`manifest is not valid: ${problems.join("; ")}`);
  const index = readIndex(remote.index);
  const stored = readStoredManifest(remote.manifest);
  const plan = planSnapshot(
    stored,
    {
      date: local.date,
      printedAt: local.printed_at,
      commit: local.source.commit,
      capturedAt: local.captured_at,
      weeklyIssue: local.weekly_issue,
      files: priorityOrder(local.files),
      missing: local.missing,
    },
    limits,
  );
  const { action, manifest } = plan;

  const puts = [];
  const deletes = [];
  if (action !== "unchanged" && action !== "older") {
    const held = new Set(stored ? stored.files.map((f) => f.sha256) : []);
    const sent = new Set();
    for (const f of manifest.files) {
      if (held.has(f.sha256) || sent.has(f.sha256)) continue;
      sent.add(f.sha256);
      puts.push({ key: blobKey(manifest.date, f.sha256), sha256: f.sha256 });
    }
    puts.push({ key: manifestKey(manifest.date), body: JSON.stringify(manifest, null, 2) + "\n" });

    const entry = summary(manifest);
    index.dates = [...index.dates.filter((d) => d.date !== manifest.date), entry].sort((a, b) => a.date.localeCompare(b.date));
    puts.push({ key: INDEX_KEY, body: JSON.stringify(index, null, 2) + "\n" });

    // A late or replayed older date never moves the pointer back.
    let latest = null;
    try {
      latest = remote.latest == null ? null : JSON.parse(remote.latest);
    } catch {
      latest = null;
    }
    if (!latest || !isDate(latest.date) || latest.date <= manifest.date) {
      puts.push({ key: LATEST_KEY, body: JSON.stringify(entry, null, 2) + "\n" });
    }
    for (const sha of plan.superseded) deletes.push(blobKey(manifest.date, sha));
  }
  const heartbeat = {
    key: HEARTBEAT_KEY,
    body:
      JSON.stringify(
        { schema: 1, ran_at: ranAt, result: action, date: manifest.date, printed_at: manifest.printed_at, content_sha256: manifest.content_sha256 },
        null,
        2,
      ) + "\n",
  };
  return { action, manifest, puts, deletes, heartbeat, index };
}

/** Core files first, then deep dives, in the order the local manifest kept them. */
function priorityOrder(files) {
  const core = ["feed.json", "weekly.json", "sources.json"];
  return [...files].sort((a, b) => {
    const ca = core.indexOf(a.path);
    const cb = core.indexOf(b.path);
    return (ca === -1 ? 9 : ca) - (cb === -1 ? 9 : cb);
  });
}

/** Bytes this plan adds to the bucket, at most (new blobs plus the JSON written here). */
export function planBytes(manifest, plan) {
  const sizes = new Map(manifest.files.map((f) => [f.sha256, f.bytes]));
  return [...plan.puts, plan.heartbeat].reduce((n, p) => n + (p.sha256 ? sizes.get(p.sha256) ?? 0 : Buffer.byteLength(p.body)), 0);
}

