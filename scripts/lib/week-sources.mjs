// Where normaliseWeek (scripts/lib/normalise.mjs) reads void news's record.
//
// gitSource: a voidnews checkout's main history at pinned commits, as of
//   origin/main or a given commit (`at`, so a record can be rebuilt exactly).
//   Each day is the last commit of feed.json on that UTC date; a deep dive
//   is the commit that first added it; ratings, the printed-edition archive
//   (archive.json, schema 2) and the echo at that commit.
//
// snapshotSource: the daily snapshots (scripts/snapshot.mjs), from a local
//   directory (dirReader) or R2 (r2Reader). Each day is that printed date's
//   snapshot; the weekly issue comes from the newest snapshot holding it
//   (the anchor), and so do the outlet ratings, the nearest record to the
//   week as printed; a deep dive comes from the earliest snapshot holding
//   it, its first printed state, as the git source does. Every file read is
//   checked against its manifest's sha256 first. Links are the public blob
//   URLs at each snapshot's pinned commit, which is where it was read.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { blobUrl, isDate, isSnapshotPath, sha256Hex, validateManifest, RAW_BASE } from "./snapshot.mjs";
import { INDEX_KEY, blobKey, manifestKey } from "./snapshot-store.mjs";
import { REPO_URL, addDays } from "./normalise.mjs";

const FEED = "frontend/build-data/feed.json";
const WEEKLY = "frontend/build-data/weekly-issues.json";
const SOURCES = "data/sources.json";
const ARCHIVE = "frontend/build-data/archive.json";
const DEEPDIVE = (id) => `frontend/public/data/deepdive/${id}.json`;
const blob = (sha, p) => `${REPO_URL}/blob/${sha}/${p}`;

export function gitSource(vn, { at = "origin/main" } = {}) {
  const git = (...a) => execFileSync("git", ["-C", vn, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const head = git("rev-parse", "--verify", `${at}^{commit}`).trim();
  const show = (sha, p) => JSON.parse(git("show", `${sha}:${p}`));
  // Commits on origin/main touching a path, oldest first, with their UTC dates.
  const commits = (p) =>
    git("log", head, "--format=%H %cI", "--", p)
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [sha, iso] = l.split(" ");
        return { sha, at: new Date(iso).toISOString() };
      })
      .reverse();
  let feedCommits;
  return {
    origin: () => head,
    weekly(issueNo) {
      const sha = commits(WEEKLY).at(-1).sha;
      const issue = show(sha, WEEKLY).find((w) => w.issue_number === issueNo);
      if (!issue) throw new Error(`issue ${issueNo} is not in ${WEEKLY} at ${sha}`);
      return { issue, link: blob(sha, WEEKLY) };
    },
    outlets: () => ({ list: show(head, SOURCES), link: blob(head, SOURCES) }),
    // The printed editions (schema 2), at the pinned commit.
    archive: () => ({ rows: show(head, ARCHIVE), link: blob(head, ARCHIVE) }),
    day(date) {
      feedCommits ??= commits(FEED);
      const snap = feedCommits.filter((c) => c.at.slice(0, 10) === date).at(-1);
      return snap ? { feed: show(snap.sha, FEED), link: blob(snap.sha, FEED) } : null;
    },
    deepdive(id) {
      // The commit that first added this cluster's deep dive: its printed state.
      const sha = git("log", head, "--diff-filter=A", "--format=%H", "--", DEEPDIVE(id)).trim().split("\n").at(-1);
      if (!sha) return null;
      return { rows: Object.values(show(sha, DEEPDIVE(id))), link: blob(sha, DEEPDIVE(id)) };
    },
    echo: (p) => ({ text: git("show", `${head}:${p}`), link: blob(head, p) }),
  };
}

/** Reads snapshots from a local directory of <date>/ folders. */
export function dirReader(root) {
  return {
    label: path.resolve(root),
    dates: () => (existsSync(root) ? readdirSync(root).filter(isDate).sort() : []),
    manifest(date) {
      const f = path.join(root, date, "manifest.json");
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    file(date, entry) {
      const f = path.join(root, date, entry.path);
      return existsSync(f) ? readFileSync(f) : null;
    },
    weeklyIssue: () => undefined, // unknown without opening the manifest
  };
}

/**
 * Reads snapshots from R2 through a store ({ get(key) }: scripts/snapshot-r2.mjs
 * wranglerStore), caching every object it fetches under cacheDir, and using
 * snapshots/index.json for the list of dates so nothing is fetched it does not need.
 */
export function r2Reader(store, cacheDir) {
  const cached = (key, binary) => {
    const f = path.join(cacheDir, ...key.split("/"));
    if (existsSync(f)) return binary ? readFileSync(f) : readFileSync(f, "utf8");
    const text = store.get(key);
    if (text == null) return null;
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    return binary ? Buffer.from(text, "utf8") : text;
  };
  let index;
  const entries = () => {
    if (!index) {
      const text = store.get(INDEX_KEY);
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      index = Array.isArray(parsed?.dates) ? parsed.dates.filter((d) => isDate(d?.date)) : [];
    }
    return index;
  };
  return {
    label: "r2://omnibus/snapshots",
    dates: () => entries().map((d) => d.date).sort(),
    manifest: (date) => cached(manifestKey(date), false),
    file: (date, entry) => cached(blobKey(date, entry.sha256), true),
    weeklyIssue: (date) => entries().find((d) => d.date === date)?.weekly_issue,
  };
}

/**
 * The snapshot source. `echoText(commit, path)` reads the history bank at the
 * anchor's commit: a voidnews checkout when given, else void news's public
 * raw file at that commit.
 */
export function snapshotSource(reader, { voidnews } = {}) {
  const manifests = new Map();
  const manifest = (date) => {
    if (!manifests.has(date)) {
      const text = reader.manifest(date);
      let m = null;
      try {
        m = text ? JSON.parse(text) : null;
      } catch {
        m = null;
      }
      manifests.set(date, m && validateManifest(m).length === 0 && m.date === date ? m : null);
    }
    return manifests.get(date);
  };
  const json = (date, rel) => {
    const m = manifest(date);
    const entry = m?.files.find((f) => f.path === rel);
    if (!entry || !isSnapshotPath(rel)) return null;
    const bytes = reader.file(date, entry);
    if (!bytes) throw new Error(`snapshot ${date} names ${rel} but it is not stored`);
    if (sha256Hex(bytes) !== entry.sha256) throw new Error(`snapshot ${date}/${rel} does not match its manifest sha256`);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  };
  // The public blob URL of a file at the commit it was read at.
  const link = (m, rel) => blobUrl(m.files.find((f) => f.path === rel)?.commit ?? m.source.commit, rel);
  let anchor = null; // { date, manifest }
  const used = new Set();
  return {
    weekly(issueNo) {
      for (const date of [...reader.dates()].reverse()) {
        const hint = reader.weeklyIssue(date);
        if (hint !== undefined && hint !== issueNo) continue;
        const m = manifest(date);
        if (!m || (m.weekly_issue != null && m.weekly_issue !== issueNo)) continue;
        const w = json(date, "weekly.json");
        if (w?.issue_number !== issueNo) continue;
        anchor = { date, manifest: m };
        used.add(date);
        return { issue: w, link: link(m, "weekly.json") };
      }
      throw new Error(`no snapshot in ${reader.label} holds weekly issue ${issueNo}`);
    },
    origin: () => anchor.manifest.source.commit,
    outlets: () => ({ list: json(anchor.date, "sources.json"), link: link(anchor.manifest, "sources.json") }),
    day(date) {
      const m = manifest(date);
      const feed = m && json(date, "feed.json");
      if (!feed) return null;
      used.add(date);
      return { feed, link: link(m, "feed.json") };
    },
    deepdive(id) {
      const rel = `deepdive/${id}.json`;
      if (!isSnapshotPath(rel)) return null;
      // Earliest snapshot holding it, from the day before the week up to the anchor.
      const from = addDays(json(anchor.date, "weekly.json").week_start, -1);
      for (const date of reader.dates()) {
        if (date < from || date > anchor.date) continue;
        const m = manifest(date);
        if (!m?.files.some((f) => f.path === rel)) continue;
        const rows = json(date, rel);
        used.add(date);
        return { rows: Array.isArray(rows) ? rows : Object.values(rows), link: link(m, rel) };
      }
      return null;
    },
    async echo(p) {
      const commit = anchor.manifest.source.commit;
      const text = voidnews
        ? execFileSync("git", ["-C", voidnews, "show", `${commit}:${p}`], { encoding: "utf8" })
        : await fetch(`${RAW_BASE}/${commit}/${p}`, { signal: AbortSignal.timeout(20_000) }).then((r) => {
            if (!r.ok) throw new Error(`echo record ${p} at ${commit.slice(0, 8)}: ${r.status}`);
            return r.text();
          });
      return { text, link: blob(commit, p) };
    },
    provenance: () => ({
      store: reader.label.startsWith("r2://") ? reader.label : "local",
      dates: [...used].sort().map((date) => ({ date, content_sha256: manifest(date).content_sha256 })),
    }),
  };
}
