import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COVERED,
  FOOTAGE_CAP_S,
  STOP_WORDS,
  WEIGHTS,
  applyThreadChecks,
  briefMentions,
  buildDesk,
  buildRundown,
  coiMatches,
  editProblems,
  footageByStory,
  printedRows,
  rundownProblems,
  scoreGroups,
  serialise,
  sha256,
} from "../scripts/lib/rundown2.mjs";
import { gitDesk, memoryDesk, normaliseRundown } from "../scripts/lib/desk-source.mjs";
import { FAIR_USE } from "../scripts/lib/rights/licences.mjs";

// Show bible v2, ticket 2: the desk (void news's weekly score reproduced over the pinned archive), the rundown/2,
// the hand check of threads, footage from the ledger and the pool, shapes by the cap. A synthetic v2 week tests
// the rules; week 33 (regression) and issue 35 are rebuilt byte for byte from void news's history at their pins.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- The synthetic week: Ruritania, Mon 2 to Sat 7 March 2026 -------------------------------------------------
const FROM = "2026-03-02";
const TO = "2026-03-07";
const PIN = { repo: "https://example.invalid/void", commit: "0123456789abcdef0123456789abcdef01234567", committed_at: "2026-03-07T14:00:00Z", rule: "test pin", complete: true };
const cid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pid = (n: number, day: string) => `${String(n).padStart(4, "0")}${day.slice(8)}00-0000-4000-9000-000000000000`;

type R = { n: number; day: string; title: string; thread: string; src: number; rank: number; div: number; cat?: string; pos?: number; summary?: string };
function row(r: R) {
  return {
    id: pid(r.n, r.day),
    source_cluster_id: cid(r.n),
    printed_on: r.day,
    edition_position: r.pos ?? 1,
    title: r.title,
    summary: r.summary ?? `${r.title}. A summary in the desk's words.`,
    category: r.cat ?? "politics",
    source_count: r.src,
    rank_world: r.rank,
    headline_rank: r.rank - 1,
    divergence_score: r.div,
    first_published: `${r.day}T06:00:00+00:00`,
    created_at: `${r.day}T13:00:00+00:00`,
    story_thread_id: r.thread,
    members: [],
  };
}
const ROWS: R[] = [
  // The council's water vote: one thread over three days.
  { n: 1, day: "2026-03-02", title: "Strelsau Council Schedules Water Rights Vote", thread: "t-water", src: 30, rank: 70, div: 20 },
  { n: 2, day: "2026-03-04", title: "Strelsau Council Votes on Water Rights", thread: "t-water", src: 60, rank: 75, div: 30 },
  { n: 2, day: "2026-03-05", title: "Strelsau Council Votes on Water Rights", thread: "t-water", src: 50, rank: 72, div: 25 },
  // A thread the linker got wrong: the contract story holds an unrelated bridge inspection.
  { n: 3, day: "2026-03-03", title: "Water Ministry Publishes the Contract", thread: "t-contract", src: 40, rank: 68, div: 22, pos: 2 },
  { n: 4, day: "2026-03-06", title: "Zenda Bridge Is Inspected After Flood", thread: "t-contract", src: 12, rank: 50, div: 5, pos: 3 },
  // One story the linker split in two: the rail strike.
  { n: 5, day: "2026-03-03", title: "Zenda Rail Workers Walk Out", thread: "t-rail-a", src: 25, rank: 66, div: 18, pos: 3 },
  { n: 6, day: "2026-03-06", title: "Zenda Rail Strike Ends With Pay Deal", thread: "t-rail-b", src: 35, rank: 69, div: 15, pos: 2 },
  // A sport story heavy enough for the top five.
  { n: 7, day: "2026-03-07", title: "Ruritania Wins the Cup Final", thread: "t-cup", src: 90, rank: 74, div: 40, cat: "sport", pos: 2 },
  // The rest: one day each, for the briefs and below.
  ...Array.from({ length: 12 }, (_, i) => ({ n: 20 + i, day: `2026-03-0${2 + (i % 6)}`, title: `Minor Story Number ${i + 1} In Ruritania`, thread: `t-minor-${i}`, src: 20 - i, rank: 60 - i, div: 10 - i / 2, pos: 4 + i })),
  // A company filing that names a coi entity.
  { n: 40, day: "2026-03-05", title: "Anthropic Files Papers in Strelsau", thread: "t-filing", src: 3, rank: 30, div: 1, cat: "economy", pos: 20 },
];
const ARCHIVE = [
  ...ROWS.map(row),
  row({ n: 90, day: "2026-03-01", title: "Before The Window", thread: "t-before", src: 99, rank: 99, div: 99 }), // outside the window
  row({ n: 91, day: "2026-03-08", title: "After The Window", thread: "t-after", src: 99, rank: 99, div: 99 }),
  { ...row({ n: 92, day: "2026-03-04", title: "No Summary Printed", thread: "t-empty", src: 99, rank: 99, div: 99 }), summary: "  " },
];
const BRIEFS = [
  { id: "b-1", edition: "world", created_at: "2026-03-02T14:00:00+00:00", top_cluster_ids: [cid(1)], tldr_headline: "Council Schedules a Vote" },
  { id: "b-2", edition: "world", created_at: "2026-03-04T14:00:00+00:00", top_cluster_ids: [cid(99)], tldr_headline: "First Draft" },
  { id: "b-2", edition: "world", created_at: "2026-03-04T14:00:00+00:00", top_cluster_ids: [cid(2), cid(5)], tldr_headline: "Council Votes, Rail Walkout" }, // the later version wins
  { id: "b-3", edition: "world", created_at: "2026-03-06T14:00:00+00:00", top_cluster_ids: [], tldr_headline: "Zenda Rail Strike Ends" }, // by title words
  { id: "b-us", edition: "us", created_at: "2026-03-05T14:00:00+00:00", top_cluster_ids: [cid(7)], tldr_headline: "Cup" },
  { id: "b-late", edition: "world", created_at: "2026-03-07T15:00:00+00:00", top_cluster_ids: [cid(7)], tldr_headline: "After the cutoff" },
];
const EDIT = {
  schema: "omnibus.rundown-edit/1",
  issue: 99,
  threads: [
    { op: "split", key: "zenda-bridge", cluster_ids: [cid(4)], reason: "a bridge inspection is not the contract story" },
    { op: "join", key: "zenda-rail-strike", cluster_ids: [cid(5), cid(6)], reason: "one strike, from the walkout to the pay deal" },
  ],
  stories: { "thread-t-contra": { slug: "THE CONTRACT IS PUBLISHED", place: "STRELSAU", primary_sources: [{ id: "doc-contract" }] } },
};

const items = JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "rundown", "ledger-items.json"), "utf8")).items;
const tmpl = (i: number, over: Record<string, unknown>) => ({ ...structuredClone(items[i]), request_id: `req-${over.id}`, ...over });
const hex = (c: string) => c.repeat(64);
function ledger() {
  return {
    schema: "omnibus.rights-ledger/1",
    issue: 99,
    items: [
      // 33 s of the council's vote (the template's aired span), by its fit's beat (the lead's cluster): clears the cap.
      tmpl(1, { id: "v-council", sha256: hex("a"), fit: { ...items[1].fit, beat: cid(2) } }),
      // The same file again under another id: counted once.
      tmpl(1, { id: "v-council-copy", sha256: hex("a"), fit: { ...items[1].fit, beat: "thread-t-water" } }),
      // Fair use: refused whatever it shows.
      tmpl(1, { id: "v-fair", sha256: hex("b"), licence: FAIR_USE, fit: { ...items[1].fit, beat: cid(3) } }),
      // An automatic fit nobody confirmed: not counted.
      tmpl(1, { id: "v-auto", sha256: hex("c"), fit: { ...items[1].fit, beat: cid(3), why: "auto: scored 9", auto: true } }),
      // The rail strike's footage: 14.5 s found through the capture pool (its item_url), 33 s by the story's key.
      tmpl(0, { id: "v-rail", sha256: hex("d") }),
      tmpl(1, { id: "v-rail-2", sha256: hex("f"), fit: { ...items[1].fit, beat: "zenda-rail-strike" } }),
    ],
    rejected: [],
  };
}
const POOL = { schema: "omnibus.capture-pool/1", issue: 99, stories: [{ key: "day-5", cluster_ids: [cid(6)], items: [{ url: items[0].item_url, media: { sha256: hex("e") } }] }] };

function synthetic(over: { edit?: unknown; ledger?: unknown; pool?: unknown; archive?: unknown[] } = {}) {
  const source = memoryDesk({ pin: PIN, archive: (over.archive ?? ARCHIVE) as any[], briefs: BRIEFS, weekly: [] });
  return normaliseRundown(source, { issue: 99, from: FROM, to: TO, edit: "edit" in over ? over.edit : EDIT, ledger: "ledger" in over ? over.ledger : ledger(), pool: "pool" in over ? over.pool : POOL, inputs: {} });
}

describe("the desk: void news's weekly score, reproduced", () => {
  it("keeps void news's six weights and stop words", () => {
    expect(WEIGHTS).toEqual({ daily_appearances: 0.25, cumulative_sources: 0.2, brief_mentions: 0.2, peak_rank: 0.15, edition_spread: 0.1, total_divergence: 0.1 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(STOP_WORDS.has("after") && STOP_WORDS.has("says") && !STOP_WORDS.has("council")).toBe(true);
  });

  it("scores each signal over its week maximum, as _score_weekly_threads does", () => {
    const g = (key: string, rows: any[]) => ({ key, rows });
    const r = (id: string, day: string, src: number, rank: number, div: number, title = "x y z") => ({ id, printed_on: day, source_count: src, headline_rank: rank, divergence_score: div, title, first_published: `${day}T00:00:00Z` });
    const groups = scoreGroups([g("a", [r("1", "2026-03-02", 10, 50, 4), r("2", "2026-03-03", 30, 80, 6)]), g("b", [r("3", "2026-03-02", 20, 40, 20)])], [{ top_cluster_ids: ["3"] }, { top_cluster_ids: ["1", "3"] }]);
    // a: days 2/2, sources 40/40, mentions 1/2, peak 80/80, spread 1/1, divergence 10/20
    const a = 0.25 + 0.2 + 0.1 + 0.15 + 0.1 + 0.05;
    // b: days 1/2, sources 20/40, mentions 2/2, peak 40/80, spread 1/1, divergence 20/20
    const b = 0.125 + 0.1 + 0.2 + 0.075 + 0.1 + 0.1;
    expect(groups.map((x: any) => x.key)).toEqual(["a", "b"]);
    expect(groups[0].score).toBeCloseTo(a, 12);
    expect(groups[1].score).toBeCloseTo(b, 12);
  });

  it("counts a brief once, by its clusters or else by two title words", () => {
    const group = { title: "Zenda Rail Strike Ends With Pay Deal", rows: [{ id: "x" }] };
    expect(briefMentions(group, [{ top_cluster_ids: ["x"], tldr_headline: "zenda rail" }, { top_cluster_ids: [], tldr_headline: "Rail strike over" }, { top_cluster_ids: [], tldr_headline: "Zenda weather" }])).toBe(2);
  });

  it("reads only printed rows inside the window that have a summary, with rank_world as the rank", () => {
    const rows = printedRows(ARCHIVE, { from: FROM, to: TO });
    expect(rows.some((r: any) => ["2026-03-01", "2026-03-08"].includes(r.printed_on))).toBe(false);
    expect(rows.some((r: any) => r.id === cid(92))).toBe(false);
    expect(rows.find((r: any) => r.id === cid(1)).headline_rank).toBe(70);
  });

  it("reads the window's world briefs once each, the last version read, by the cutoff", () => {
    const { desk } = synthetic();
    expect(desk.briefs.map((b: any) => b.id)).toEqual(["b-1", "b-2", "b-3"]);
    expect(desk.briefs[1].tldr_headline).toBe("Council Votes, Rail Walkout");
    expect(desk.window).toMatchObject({ from: FROM, to: TO, days_missing: [] });
    expect(desk.pin).toMatchObject({ archive_commit: PIN.commit, cutoff_utc: PIN.committed_at, last_print_utc: "2026-03-07T13:00:00Z" });
    expect(desk.threads[0].key).toBe("thread-t-water");
  });

  it("names the days the pin does not hold yet", () => {
    const { desk, rundown } = synthetic({ archive: ARCHIVE.filter((r: any) => r.printed_on !== "2026-03-07") });
    expect(desk.window.days_missing).toEqual(["2026-03-07"]);
    expect(rundown.notes[0]).toBe("days not printed by the pin: 2026-03-07");
  });
});

describe("the hand check of threads", () => {
  it("splits a misfiled cluster out and joins a split story with its thread_reason", () => {
    const { rundown } = synthetic();
    const by = Object.fromEntries([...rundown.stories, ...rundown.not_covered].map((s: any) => [s.key, s]));
    expect(by["thread-t-contra"].cluster_ids).toEqual([cid(3)]);
    expect(by["zenda-bridge"].cluster_ids).toEqual([cid(4)]);
    expect(by["zenda-rail-strike"].cluster_ids).toEqual([cid(5), cid(6)]);
    expect(by["zenda-rail-strike"].thread_ids).toEqual(["t-rail-a", "t-rail-b"]);
    expect(by["zenda-rail-strike"].thread_reason).toBe("one strike, from the walkout to the pay deal");
    expect(rundown.thread_checks.map((c: any) => [c.op, c.key, c.from])).toEqual([
      ["split", "zenda-bridge", ["thread-t-contra"]],
      ["join", "zenda-rail-strike", ["thread-t-rail-a", "thread-t-rail-b"]],
    ]);
  });

  it("names a cluster by its printed row's id too, and refuses a reference that names none or several", () => {
    const rows = printedRows(ARCHIVE, { from: FROM, to: TO });
    const byPrinted = applyThreadChecks(rows, { threads: [{ op: "split", key: "b", cluster_ids: [pid(4, "2026-03-06")], reason: "printed id" }] });
    expect(byPrinted.groups.find((g: any) => g.key === "b").rows.map((r: any) => r.id)).toEqual([cid(4)]);
    expect(() => applyThreadChecks(rows, { threads: [{ op: "split", cluster_ids: ["ffffffff"], reason: "x" }] })).toThrow(/names no cluster/);
    expect(() => applyThreadChecks(rows, { threads: [{ op: "split", cluster_ids: ["c0000000"], reason: "x" }] })).toThrow(/names \d+ clusters/);
  });

  it("refuses a check without its written reason, and a join without its key", () => {
    expect(editProblems({ ...EDIT, threads: [{ op: "join", key: "x", cluster_ids: [cid(5)], reason: "" }] }, 99).join()).toMatch(/written reason/);
    expect(editProblems({ ...EDIT, threads: [{ op: "join", cluster_ids: [cid(5)], reason: "a reason long enough" }] }, 99).join()).toMatch(/story key/);
    expect(editProblems({ ...EDIT, threads: [{ op: "merge", cluster_ids: [cid(5)], reason: "a reason long enough" }] }, 99).join()).toMatch(/split or join/);
    expect(editProblems({ ...EDIT, issue: 98 }, 99).join()).toMatch(/issue 98/);
    expect(() => synthetic({ edit: { ...EDIT, threads: [{ op: "join", key: "x", cluster_ids: [cid(5)], reason: "" }] } })).toThrow(/rundown-edit/);
  });

  it("never bundles two threads without a reason", () => {
    const rows = printedRows(ARCHIVE, { from: FROM, to: TO });
    // A split into an existing story's key bundles two threads with no join: refused.
    expect(() => applyThreadChecks(rows, { threads: [{ op: "split", key: "thread-t-water", cluster_ids: [cid(4)], reason: "into the water story" }] })).toThrow(/without a thread_reason/);
  });
});

describe("footage: the rights ledger and the capture pool", () => {
  it("counts cleared footage per story, once per file, never fair use or an unconfirmed fit", () => {
    const { rundown } = synthetic();
    const by = Object.fromEntries(rundown.stories.map((s: any) => [s.key, s]));
    expect(by["thread-t-water"].footage_cleared_s).toBe(33);
    expect(by["thread-t-water"].footage.items).toEqual([{ id: "v-council", seconds: 33 }]);
    expect(by["thread-t-contra"].footage_cleared_s).toBe(0);
    expect(by["thread-t-contra"].footage.refused.map((x: any) => x.id)).toEqual(["v-fair"]);
    expect(by["thread-t-contra"].footage.refused[0].why.join()).toMatch(/fair-use-refused/);
    expect(by["thread-t-contra"].footage.unconfirmed.map((x: any) => x.id)).toEqual(["v-auto"]);
    // through the pool: the rail strike's pool story holds the item's page
    expect(by["zenda-rail-strike"].footage.items).toEqual([{ id: "v-rail", seconds: 14.5 }, { id: "v-rail-2", seconds: 33 }]);
    expect(by["zenda-rail-strike"].footage_cleared_s).toBe(47.5);
  });

  it("is zero for every story without a ledger, and says so", () => {
    const { rundown } = synthetic({ ledger: null });
    expect(rundown.stories.every((s: any) => s.footage_cleared_s === 0)).toBe(true);
    expect(rundown.notes.join("\n")).toMatch(/no rights ledger yet/);
  });

  it("counts nothing from a ledger that fails its schema", () => {
    const bad = ledger();
    (bad.items[0] as any).kind = "film";
    const rows = printedRows(ARCHIVE, { from: FROM, to: TO });
    const { byStory, problems } = footageByStory([{ key: "w", rows: rows.filter((r: any) => r.id === cid(2)) }], { ledger: bad });
    expect(byStory.get("w").seconds).toBe(0);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("the rundown/2: ranks, slots and shapes by the cap", () => {
  it("ranks by weight and shapes by the cap: full at 30 s, else a document package at its rank", () => {
    const { rundown } = synthetic();
    expect(rundownProblems(rundown)).toEqual([]);
    const pk = rundown.stories.filter((s: any) => !s.slot.startsWith("brief_"));
    expect(pk.map((s: any) => [s.slot, s.key, s.shape])).toEqual([
      ["lead", "thread-t-water", "full"],
      ["package_2", "zenda-rail-strike", "full"],
      ["package_3", "thread-t-contra", "document"],
      ["package_4", pk[3].key, "document"],
    ]);
    expect(pk[1].footage_cleared_s).toBeGreaterThanOrEqual(FOOTAGE_CAP_S);
    for (let i = 1; i < pk.length; i++) expect(pk[i].weight).toBeLessThanOrEqual(pk[i - 1].weight);
    expect(rundown.tease).toEqual(pk.map((s: any) => s.key));
  });

  it("keeps sport out of the packages; it may hold the final brief from the top five", () => {
    const { rundown } = synthetic();
    const cup = rundown.stories.find((s: any) => s.key === "thread-t-cup");
    expect(COVERED.has("sport")).toBe(false);
    expect(cup.rank).toBeLessThanOrEqual(5);
    expect(cup.slot).toBe(rundown.stories.filter((s: any) => s.shape === "brief").at(-1).slot);
    expect(rundown.briefs_order.at(-1)).toBe("thread-t-cup");
    expect(rundown.stories.filter((s: any) => s.shape === "brief").length).toBeLessThanOrEqual(10);
  });

  it("runs package 5 only when rank 5 clears the cap or names its primary sources", () => {
    const fifth = (r: any) => r.stories.find((s: any) => s.slot === "package_5");
    expect(fifth(synthetic().rundown)).toBeUndefined();
    const { rundown } = synthetic();
    const rank5 = rundown.stories.find((s: any) => s.slot === "brief_1");
    const edit = structuredClone(EDIT) as any;
    edit.stories[rank5.key] = { primary_sources: [{ id: "doc-1" }] };
    const p5 = fifth(synthetic({ edit }).rundown);
    expect(p5).toMatchObject({ key: rank5.key, shape: "document" });
  });

  it("flags a coi entity from a story's title, parties or entities", () => {
    const { rundown } = synthetic();
    const filing = [...rundown.stories, ...rundown.not_covered].find((s: any) => s.key === "thread-t-filing");
    expect(filing).toBeDefined();
    expect(coiMatches(["Anthropic Files Papers"])).toEqual(["Anthropic"]);
    expect(coiMatches(["Claudette Colvin", "Mistrals blow"])).toEqual([]);
    expect(coiMatches(["the Google DeepMind team"])).toEqual(["DeepMind", "Google DeepMind"]);
  });

  it("refuses a rundown whose shape is not the cap's", () => {
    const { rundown } = synthetic();
    const bad = structuredClone(rundown);
    bad.stories.find((s: any) => s.slot === "package_3").shape = "full";
    expect(rundownProblems(bad).join()).toMatch(/the cap gives document/);
    const order = structuredClone(rundown);
    [order.stories[1], order.stories[2]] = [order.stories[2], order.stories[1]];
    expect(rundownProblems(order).join()).toMatch(/runs after a lighter package/);
    expect(rundownProblems(rundown, { final: true }).join()).toMatch(/slug is not written/);
  });

  it("rebuilds byte for byte, whatever order the archive lists its rows in", () => {
    const a = synthetic();
    const b = synthetic({ archive: [...ARCHIVE].reverse() });
    expect(serialise(b.desk)).toBe(serialise(a.desk));
    expect(serialise(b.rundown)).toBe(serialise(a.rundown));
    expect(a.rundown.inputs.desk_sha256).toBe(sha256(serialise(a.desk)));
  });

  it("never reads the weekly edition to rank: only to cross-check", () => {
    const weekly = [{ edition: "world", issue_number: 99, week_start: FROM, week_end: "2026-03-08", created_at: "2026-03-08T22:58:00Z", cover_timelines: [{ story_index: 0, entries: [{ cluster_id: cid(20) }] }] }];
    const plain = synthetic().rundown;
    const source = memoryDesk({ pin: PIN, archive: ARCHIVE, briefs: BRIEFS, weekly });
    const seen = normaliseRundown(source, { issue: 99, from: FROM, to: TO, edit: EDIT, ledger: ledger(), pool: POOL, inputs: {} }).rundown;
    expect(seen.stories).toEqual(plain.stories);
    expect(seen.edition.weekly_edition_seen).toBe(true);
    expect(seen.weekly_crosscheck).toMatchObject({ agree: false, window_end_matches: false });
  });
});

// ---- Week 33 (regression) and issue 35, from void news's history at their pins --------------------------------

function hasCommit(dir: string, sha: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    execFileSync("git", ["-c", "safe.directory=*", "-C", dir, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
// VOIDNEWS_DIR or ../voidnews when it holds the commit, else a blob-less clone (git fetches only the blobs read).
// Never skipped: no checkout, no pass.
function voidnewsAt(sha: string): string {
  for (const dir of [process.env.VOIDNEWS_DIR, path.join(root, "..", "voidnews")]) if (dir && hasCommit(dir, sha)) return dir;
  const clone = path.join(os.tmpdir(), "omnibus-voidnews-partial");
  if (!hasCommit(clone, sha)) {
    if (existsSync(path.join(clone, ".git"))) execFileSync("git", ["-C", clone, "fetch", "-q", "origin"], { stdio: "ignore" });
    else {
      mkdirSync(path.dirname(clone), { recursive: true });
      execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", "https://github.com/aacrit/void--news", clone], { stdio: "ignore" });
    }
  }
  return clone;
}
const readText = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const readOpt = (p: string) => (existsSync(p) ? { doc: JSON.parse(readText(p)), ref: { path: path.relative(root, p).split(path.sep).join("/"), sha256: sha256(readText(p)) } } : { doc: null, ref: null });

for (const [label, dir, episodeDir] of [
  ["week 33 (regression fixture)", "tests/fixtures/rundown/week-33", "tests/fixtures/rundown/week-33"],
  ["issue 35", "episodes/35", "episodes/35"],
] as const) {
  describe(label, () => {
    it("is rebuilt byte for byte from its own pin", { timeout: 240_000 }, () => {
      const rundownText = readText(path.join(root, dir, "rundown.json"));
      const deskText = readText(path.join(root, dir, "desk.json"));
      const r = JSON.parse(rundownText);
      expect(rundownProblems(r)).toEqual([]);
      const pin = r.edition.archive_commit as string;
      const ep = path.join(root, episodeDir);
      const edit = readOpt(path.join(ep, "rundown-edit.json"));
      const ledger = readOpt(path.join(ep, "rights-ledger.json"));
      expect({ edit: edit.ref, rights_ledger: ledger.ref }).toEqual({ edit: r.inputs.edit, rights_ledger: r.inputs.rights_ledger });
      const out = normaliseRundown(gitDesk(voidnewsAt(pin), { at: pin }), {
        issue: r.edition.issue, from: r.edition.window.from, to: r.edition.window.to,
        edit: edit.doc, ledger: ledger.doc, pool: null, inputs: { edit: edit.ref, rights_ledger: ledger.ref, capture_pool: null },
      });
      expect(out.pin.commit).toBe(pin);
      expect(serialise(out.desk)).toBe(deskText);
      expect(serialise(out.rundown)).toBe(rundownText);
    });
  });
}

describe("week 33's reproduced score against its weekly edition", () => {
  it("puts the weekly edition's two covers at ranks 1 and 2", () => {
    const c = JSON.parse(readText(path.join(root, "tests/fixtures/rundown/week-33/weekly-crosscheck.json")));
    expect(c.weekly_edition_seen).toBe(true);
    expect(c.covers.map((x: any) => x.our_rank).sort()).toEqual([1, 2]);
    expect(c.agree).toBe(true);
  });
});
