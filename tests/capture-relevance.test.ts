// C3: relevance and always-capture channels. A week 33 replay: the editions void news printed 31 Oct to 8 Nov
// (recorded from its git history through the snapshot library, cluster titles and deep-dive article titles
// only) and the feeds as recorded (the White House's Commons category, the DVIDS Hegseth search), run at the
// capture schedule's three times a day.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTerms, channelProblems, latestEditions, loadChannels, matchChannel, printedEdition, scoreItem, selectItems, snapshotEditions, tokens } from "../scripts/capture/relevance.mjs";
import { CATEGORIES, parseCategory } from "../scripts/capture/listers/commons.mjs";
import { parseSearch } from "../scripts/capture/listers/dvids.mjs";
import { buildManifest, sha256Hex } from "../scripts/lib/snapshot.mjs";

const fixture = (p: string) => JSON.parse(readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8"));
const channels = loadChannels();
const editions = fixture("capture/week33-editions.json").editions;
const listed = [
  ...parseCategory(fixture("capture/commons-wh-week33.json").response, { category: CATEGORIES[0], capturedAt: "2026-11-13T00:00:00Z" }),
  ...parseSearch(fixture("rights/dvids-search-hegseth.json").response, { capturedAt: "2026-11-13T00:00:00Z" }),
];

const MILLER = "File:White House Chief of Staff, Stephen Miller.webm";
const REMARKS_4 = "File:President Trump Delivers Remarks, Nov. 4, 2026.webm";
const HEGSETH = "File:Secretary of War Pete Hegseth is delivering a stronger military, a safer America.webm";
const HEGSETH_DVIDS = "video:1028891";

/** The schedule's run times (capture.yml: 05:23, 13:11, 21:41 UTC) from 2 Nov to the morning of 9 Nov. */
function runTimes() {
  const out: string[] = [];
  for (let d = 2; d <= 9; d++) for (const hm of ["05:23", "13:11", "21:41"]) out.push(`2026-11-${String(d).padStart(2, "0")}T${hm}:00Z`);
  return out.filter((t) => t <= "2026-11-09T05:23:00Z");
}

/** Every run sees what was listed by then; returns the first run that captured each item. */
function replay() {
  const firstCapture = new Map<string, { at: string; reason: string; channel: string | null; score: number }>();
  const decisions = new Map<string, boolean>();
  for (const at of runTimes()) {
    const seen = listed.filter((i) => Date.parse(i.published_at) <= Date.parse(at));
    for (const s of selectItems(seen, { editions, channels, now: at })) {
      decisions.set(s.item.id, (decisions.get(s.item.id) ?? false) || s.capture);
      if (s.capture && !firstCapture.has(s.item.id)) firstCapture.set(s.item.id, { at, reason: s.reason, channel: s.channel, score: s.score });
    }
  }
  return { firstCapture, decisions };
}

describe("capture/channels.json", () => {
  it("is well formed: schema, numbers, stoplist and compilable patterns", () => {
    expect(channelProblems(channels)).toEqual([]);
    expect(channels.capture_at).toBe(2);
    expect(channels.ngram_points).toBe(2);
    expect(channels.term_points).toBe(1);
    expect(channels.editions).toBe(3);
    expect(channels.top_clusters).toBe(15);
    expect(channels.rescore_hours).toBe(72);
    for (const n of ["United States", "Congress", "Washington", "White House"]) expect(channels.stoplist).toContain(n);
    expect(channelProblems({ ...channels, always: [{ id: "x", sources: ["dvids"], when: [{ title: "(" }] }] }).join()).toMatch(/x\.title/);
  });

  it("names the always-capture channels the design lists", () => {
    const ids = channels.always.map((c: { id: string }) => c.id);
    for (const id of ["potus-remarks", "vp-remarks", "press-secretary", "dvids-secwar-osd", "dvids-joint-staff", "dvids-centcom", "state-briefings"]) expect(ids).toContain(id);
  });
});

describe("terms", () => {
  it("are proper-noun n-grams and single names; the stoplist and common headline words never count", () => {
    const ed = printedEdition({
      date: "2026-11-06",
      feed: { builtAt: "2026-11-06T19:00:00Z", clusters: [{ id: "a", title: "Defense Secretary Pete Hegseth Faces Impeachment Threat in Congress" }] },
      deepdive: () => [{ article: { title: "Democrats in the United States Congress move to impeach Pete Hegseth - Reuters" } }, { article: { title: "What the impeachment threat faces" } }],
    });
    expect(ed.clusters[0].articles[0]).not.toMatch(/Reuters/);
    const t = buildTerms([ed], { stoplist: channels.stoplist });
    expect(t.ngrams.has("pete hegseth")).toBe(true);
    expect(t.terms.has("hegseth")).toBe(true);
    for (const w of ["congress", "united", "states", "democrats", "faces", "threat", "impeachment", "secretary"]) expect(t.terms.has(w), w).toBe(false);
    expect([...t.ngrams].some((g) => g.includes("united"))).toBe(false);
    expect(tokens("Hegseth's U.S. visit")).toEqual(["Hegseth", "U.S", "visit"]);
  });

  it("scores 2 per n-gram and 1 per single term, counting each once, and only capitalised words in the item", () => {
    const t = buildTerms([{ date: "d", printed_at: null, clusters: [{ id: "a", title: "Stephen Miller Named Chief of Staff", articles: [] }] }], { stoplist: [] });
    expect(scoreItem({ title: "Stephen Miller, Stephen Miller" }, t)).toEqual({ score: 4, ngrams: ["stephen miller"], terms: ["miller", "stephen"] });
    expect(scoreItem({ title: "a miller grinds" }, t).score).toBe(0);
    expect(scoreItem({ title: "Miller" }, t).score).toBe(1);
  });

  it("uses the latest three editions printed by the run", () => {
    const at = "2026-11-06T21:41:00Z";
    expect(latestEditions(editions, { n: 3, at }).map((e: { date: string }) => e.date)).toEqual(["2026-11-03", "2026-11-05", "2026-11-06"]);
    expect(latestEditions(editions, { n: 3, at: "2026-11-06T13:11:00Z" }).map((e: { date: string }) => e.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-05"]);
  });

  it("reads editions from the daily snapshots, each file checked against its manifest", () => {
    const feed = Buffer.from(JSON.stringify({ builtAt: "2026-11-06T19:00:00Z", clusters: [{ id: "c0000000-0000-4000-8000-000000000000", title: "Pete Hegseth Speaks" }] }));
    const dd = Buffer.from(JSON.stringify([{ article: { title: "Hegseth speaks at the Pentagon - AP" } }]));
    const files = [
      { path: "feed.json", sha256: sha256Hex(feed), bytes: feed.length },
      { path: "deepdive/c0000000-0000-4000-8000-000000000000.json", sha256: sha256Hex(dd), bytes: dd.length },
    ];
    const bodies = new Map([[files[0].sha256, feed], [files[1].sha256, dd]]);
    const manifest = buildManifest({ date: "2026-11-06", printedAt: "2026-11-06T19:00:00Z", commit: "a".repeat(40), capturedAt: "2026-11-06T20:00:00Z", files, missing: [] });
    const reader = { dates: () => ["2026-11-06"], manifest: () => JSON.stringify(manifest), file: (_d: string, e: { sha256: string }) => bodies.get(e.sha256) };
    const got = snapshotEditions(reader, { n: 3 });
    expect(got).toHaveLength(1);
    expect(got[0].clusters[0]).toEqual({ id: "c0000000-0000-4000-8000-000000000000", title: "Pete Hegseth Speaks", articles: ["Hegseth speaks at the Pentagon"] });
    expect(() => snapshotEditions({ ...reader, file: () => Buffer.from("{}") }, { n: 3 })).toThrow(/manifest/);
  });
});

describe("always-capture channels", () => {
  it("match the President's remarks, the Secretary of War on DVIDS and State briefings, and not a plain feature", () => {
    expect(matchChannel({ source: "commons", title: "President Trump Delivers Remarks, Nov. 4, 2026" }, channels)).toBe("potus-remarks");
    expect(matchChannel({ source: "whitehouse", title: "Press Secretary Karoline Leavitt Briefs Members of the Media" }, channels)).toBe("press-secretary");
    expect(matchChannel({ source: "dvids", title: "Send Me", unit: "Office of the Secretary of War Public Affairs" }, channels)).toBe("dvids-secwar-osd");
    expect(matchChannel({ source: "dvids", title: "Update", unit: "U.S. Central Command" }, channels)).toBe("dvids-centcom");
    expect(matchChannel({ source: "commons", title: "Department Press Briefing", category: "Category:Videos of United States State Department Press Briefings" }, channels)).toBe("state-briefings");
    expect(matchChannel({ source: "commons", title: "POTUS Signs a Proclamation For Fishermen" }, channels)).toBeNull();
    // A channel holds to its sources: a DVIDS-only channel never fires on Commons.
    expect(matchChannel({ source: "commons", title: "x", unit: "Office of the Secretary of War" }, channels)).toBeNull();
  });
});

describe("week 33 replay (2 to 8 Nov)", () => {
  const { firstCapture, decisions } = replay();

  it("selects S1/S4's Stephen Miller video, the 4 Nov remarks and the 6 Nov Hegseth items", () => {
    for (const id of [MILLER, REMARKS_4, HEGSETH, HEGSETH_DVIDS]) expect(firstCapture.has(id), id).toBe(true);
    // Miller and the Commons Hegseth video are caught by relevance (the week's names), not by a channel.
    expect(firstCapture.get(MILLER)!.channel).toBeNull();
    expect(firstCapture.get(MILLER)!.reason).toMatch(/stephen miller/);
    expect(firstCapture.get(HEGSETH)!.reason).toMatch(/pete hegseth/);
    expect(firstCapture.get(REMARKS_4)!.channel).toBe("potus-remarks");
    expect(firstCapture.get(HEGSETH_DVIDS)!.channel).toBe("dvids-secwar-osd");
  });

  it("catches Miller on a later run by re-scoring the last 72 hours, once his story has printed", () => {
    const upload = Date.parse(listed.find((i) => i.id === MILLER)!.published_at);
    const caught = Date.parse(firstCapture.get(MILLER)!.at);
    expect(caught).toBeGreaterThan(upload + 12 * 3600_000); // not the first run that listed it
    expect(caught - upload).toBeLessThanOrEqual(72 * 3600_000);
    // Outside the window it is no longer scored at all.
    const late = selectItems(listed, { editions, channels, now: new Date(upload + 73 * 3600_000).toISOString() });
    expect(late.some((s: { item: { id: string } }) => s.item.id === MILLER)).toBe(false);
  });

  it("does not capture everything: items with none of the week's names and no channel stay listed only", () => {
    const refused = [...decisions].filter(([, c]) => !c).map(([id]) => id);
    expect(refused).toContain("File:POTUS Signs a Proclamation For Fishermen.webm");
    expect(refused).toContain("File:Stand. Fight. Defend the Republic.webm");
    expect(refused.length).toBeGreaterThanOrEqual(5);
  });
});
