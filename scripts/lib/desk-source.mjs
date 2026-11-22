// Where the desk (scripts/lib/rundown2.mjs) reads void news: its public git
// history, through a checkout that only needs `git fetch`. Everything is read
// with `git show <sha>:<path>` from origin/main's history (or a given commit),
// never the working tree, so a rundown rebuilt at its own pin is the same.
//
// The pin (bible k): the first commit on the history whose archive.json holds
// the window's last day as printed (printed_on = to). When no commit holds it
// yet, the newest commit is pinned, and the desk names the days it lacks.
// The cutoff is the pinned commit's own time (UTC).

import { execFileSync } from "node:child_process";
import { buildDesk, buildRundown, serialise, sha256, weeklyCrosscheck } from "./rundown2.mjs";

export const REPO_URL = "https://github.com/aacrit/void--news";
export const ARCHIVE = "frontend/build-data/archive.json";
export const BRIEF = "frontend/public/data/brief.json";
export const WEEKLY = "frontend/build-data/weekly-issues.json";

export function gitDesk(vn, { at = "origin/main" } = {}) {
  const git = (...a) => execFileSync("git", ["-c", "safe.directory=*", "-C", vn, ...a], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }); // archive.json is about 45 MB
  const head = git("rev-parse", "--verify", `${at}^{commit}`).trim();
  const show = (sha, p) => JSON.parse(git("show", `${sha}:${p}`));
  const has = (sha, p) => {
    try {
      git("cat-file", "-e", `${sha}:${p}`);
      return true;
    } catch {
      return false;
    }
  };
  // Commits up to the head touching a path, oldest first, with their committer times (UTC).
  const commits = (p) =>
    git("log", head, "--first-parent", "--format=%H %cI", "--", p)
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [sha, t] = l.split(" ");
        return { sha, at: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") };
      })
      .reverse();
  const cache = new Map();
  const archiveAt = (sha) => {
    if (!cache.has(sha)) {
      cache.clear(); // one 45 MB file in memory at a time
      cache.set(sha, show(sha, ARCHIVE));
    }
    return cache.get(sha);
  };
  return {
    head: () => head,
    /** The pin for a window ending `to`: { repo, commit, committed_at, rule, complete }. */
    pin({ to }) {
      const list = commits(ARCHIVE);
      if (!list.length) throw new Error(`no commit up to ${head} touches ${ARCHIVE}`);
      for (const c of list.filter((x) => x.at >= `${to}T00:00:00Z`)) {
        if (archiveAt(c.sha).some((r) => r?.printed_on === to)) {
          return { repo: REPO_URL, commit: c.sha, committed_at: c.at, rule: `the first commit whose ${ARCHIVE} holds the ${to} print`, complete: true };
        }
      }
      const last = list.at(-1);
      return { repo: REPO_URL, commit: last.sha, committed_at: last.at, rule: `no commit up to ${head.slice(0, 12)} holds the ${to} print: the newest commit touching ${ARCHIVE}`, complete: false };
    },
    archive: (sha) => archiveAt(sha),
    /** Every version of brief.json committed from the day before `from` up to the pin, oldest first. */
    briefs({ sha, from, cutoff }) {
      const lo = new Date(`${from}T00:00:00Z`);
      lo.setUTCDate(lo.getUTCDate() - 1);
      const since = lo.toISOString().replace(/\.\d{3}Z$/, "Z");
      const pinned = git("log", sha, "--first-parent", "--format=%H %cI", "--", BRIEF)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" "))
        .map(([s, t]) => ({ sha: s, at: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") }))
        .reverse();
      return pinned.filter((c) => c.at >= since && c.at <= cutoff).map((c) => show(c.sha, BRIEF));
    },
    weekly: (sha) => (has(sha, WEEKLY) ? show(sha, WEEKLY) : []),
  };
}

/** A desk source over data in memory (tests and the synthetic week): { pin, archive, briefs, weekly }. */
export function memoryDesk({ pin, archive, briefs = [], weekly = [] }) {
  return {
    head: () => pin.commit,
    pin: () => pin,
    archive: () => archive,
    briefs: () => briefs,
    weekly: () => weekly,
  };
}

/**
 * The desk and the rundown for an issue, read through `source` (gitDesk or
 * memoryDesk). `edit`, `ledger`, `pool` are the episode's own files (or
 * null); `inputs` records where they were read and their sha256.
 */
export function normaliseRundown(source, { issue, from, to, edit = null, ledger = null, pool = null, inputs = {} }) {
  const pin = source.pin({ to });
  const archive = source.archive(pin.commit);
  const briefs = source.briefs({ sha: pin.commit, from, cutoff: pin.committed_at });
  const desk = buildDesk({ issue, from, to, pin, archive, briefs, weekly: source.weekly(pin.commit) });
  const rundown = buildRundown({ desk, archive, briefs, edit, ledger, pool, inputs: { ...inputs, desk_sha256: sha256(serialise(desk)) } });
  return { desk, rundown, pin };
}

/** The weekly edition for the window, read at the history's head, against the rundown's stories (by weight). */
export function crosscheckAt(source, { issue, from, to, pin, rundown }) {
  const ranked = rundown.stories.filter((s) => !s.slot.startsWith("brief_")).map((s) => ({ key: s.key, rows: s.cluster_ids.map((id) => ({ id })) }));
  return { schema: "omnibus.weekly-crosscheck/1", issue, read_at: source.head(), archive_commit: pin.commit, ...weeklyCrosscheck(source.weekly(source.head()), { from, to }, ranked) };
}
