import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseWeek, publisherSuffix } from "../scripts/lib/normalise.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Google News RSS appends " - <publisher>" to every title it syndicates. The
// board strips it only when that is provable: the outlet is read through a
// Google News feed, the article is a Google News link, and the suffix names
// the outlet (its name, part of its name, or its domain).

const GN = "https://news.google.com/rss/articles/CBMabc?oc=5";
const gnOutlet = (name: string, url: string) => ({
  name,
  url,
  rss_url: `https://news.google.com/rss/search?q=site:${new URL(url).host}+when:24h`,
});
const article = (title: string, url = GN) => ({ title, url });

describe("publisherSuffix", () => {
  it("strips the Google News publisher when it is the outlet's name, part of it, or its domain", () => {
    expect(publisherSuffix(article("Vance tries to distance himself - Chicago Tribune"), gnOutlet("Chicago Tribune", "https://www.chicagotribune.com"))).toEqual({
      headline: "Vance tries to distance himself",
      suffix: " - Chicago Tribune",
    });
    expect(publisherSuffix(article("Ebola tops 10,000 cases - AP News"), gnOutlet("Associated Press", "https://apnews.com"))?.suffix).toBe(" - AP News");
    expect(
      publisherSuffix(article("UN officials condemn killing - CGTN"), gnOutlet("CGTN (China Global Television Network)", "https://www.cgtn.com"))?.headline,
    ).toBe("UN officials condemn killing");
  });

  it("keeps the headline whole when the suffix is not provably the RSS publisher", () => {
    const tribune = gnOutlet("Chicago Tribune", "https://www.chicagotribune.com");
    // A dash inside the headline that names someone else.
    expect(publisherSuffix(article("Senate votes - Reuters"), tribune)).toBeNull();
    // Not a Google News link.
    expect(publisherSuffix(article("Senate votes - Chicago Tribune", "https://www.chicagotribune.com/x"), tribune)).toBeNull();
    // An outlet read from its own feed.
    expect(
      publisherSuffix(article("Senate votes - Chicago Tribune"), { ...tribune, rss_url: "https://www.chicagotribune.com/feed" }),
    ).toBeNull();
    // A link that only looks like Google News.
    expect(publisherSuffix(article("Senate votes - Chicago Tribune", "https://news.google.com.evil.example/rss/articles/x"), tribune)).toBeNull();
    // Nothing left once stripped, a one-letter publisher, or no outlet record.
    expect(publisherSuffix(article(" - Chicago Tribune"), tribune)).toBeNull();
    expect(publisherSuffix(article("Senate votes - C"), gnOutlet("C-SPAN", "https://www.c-span.org"))).toBeNull();
    expect(publisherSuffix(article("Senate votes - Chicago Tribune"), undefined)).toBeNull();
  });
});

// A minimal source: one day, a lead with a board of one Google News row.
function fakeSource(echoFiles: Record<string, string> = {}) {
  const outlets = [
    { name: "Chicago Tribune", url: "https://www.chicagotribune.com", rss_url: "https://news.google.com/rss/search?q=site:chicagotribune.com", tier: "us_major", political_lean_baseline: "center-right" },
  ];
  const cid = "00000000-0000-4000-8000-000000000001";
  const feed = {
    builtAt: "2026-11-02T10:00:00Z",
    clusters: [{ id: cid, title: "Lead", category: "politics", source_count: 9, importance_score: 1, bias_diversity: { lean_buckets: {} } }],
  };
  const read = (p: string) => {
    if (!(p in echoFiles)) throw new Error(`no ${p}`);
    return { text: echoFiles[p], link: `link:${p}` };
  };
  const requested: string[] = [];
  return {
    requested,
    origin: () => "f".repeat(40),
    weekly: () => ({
      issue: {
        issue_number: 99,
        week_start: "2026-11-02",
        week_end: "2026-11-08",
        created_at: "2026-11-08T22:00:00Z",
        edition: "world",
        cover_headline: "Cover",
        cover_numbers: [],
        cover_timelines: [{ story_index: 0, entries: [{ date_iso: "2026-11-02", title: "Lead", source_count: 9, cluster_id: cid }] }],
      },
      link: "weekly",
    }),
    outlets: () => ({ list: outlets, link: "sources" }),
    day: (date: string) => (date === "2026-11-02" ? { feed, link: "feed" } : null),
    deepdive: () => ({
      rows: [{ article: { title: "Vance speaks - Chicago Tribune", url: GN, published_at: "2026-11-02T09:00:00Z", source: { name: "Chicago Tribune" } } }],
      link: "dd",
    }),
    echo(p: string) {
      requested.push(p);
      return read(p);
    },
  };
}

const SPANISH = "slug: spanish-flu-1918\ntitle: The 1918 Influenza Pandemic\ndate_display: 1918-1919\n";
const KOREA = "slug: korean-war\ntitle: The Korean War\ndate_display: 1950-1953\n";

describe("normaliseWeek options", () => {
  it("schema 1 (the default, week 32's) keeps the board headline as printed and the week-32 echo", async () => {
    const src = fakeSource({ "data/history/events/spanish-flu-1918.yaml": SPANISH });
    const out = await normaliseWeek(src, 99);
    expect(out.schema).toBeUndefined();
    expect(out.lead.board[0].headline).toBe("Vance speaks - Chicago Tribune");
    expect(out.lead.board[0].headline_raw).toBeUndefined();
    expect(out.echo).toMatchObject({ slug: "spanish-flu-1918", status: "candidate", alternate: "black-death" });
  });

  it("schema 2 strips a provable publisher suffix and records the raw headline beside it", async () => {
    const out = await normaliseWeek(fakeSource({}), 99, { schema: 2, echo: "pending" });
    expect(out.schema).toBe(2);
    expect(out.lead.board[0]).toMatchObject({
      headline: "Vance speaks",
      headline_raw: "Vance speaks - Chicago Tribune",
      stripped_suffix: " - Chicago Tribune",
    });
    // The ledger stays verbatim.
    expect(out.lead.ledger[0].headline).toBe("Vance speaks - Chicago Tribune");
  });

  it("schema 2 records a day with no printed edition as NO PRINT in words; schema 1 keeps week 32's shape", async () => {
    const two = await normaliseWeek(fakeSource({}), 99, { schema: 2, echo: "pending" });
    expect(two.days[1]).toEqual({ date: "2026-11-03", available: false, no_print: "no printed edition of that date in the source" });
    const one = await normaliseWeek(fakeSource({}), 99, { echo: "pending" });
    expect(one.days[1]).toEqual({ date: "2026-11-03", available: false });
  });

  it("--echo pending reads no history file and says the echo is not picked", async () => {
    const src = fakeSource({});
    const out = await normaliseWeek(src, 99, { schema: 2, echo: "pending" });
    expect(src.requested).toEqual([]);
    expect(out.echo).toEqual({ slug: null, status: "pending" });
  });

  it("--echo <slug> reads that history record, with no alternate invented", async () => {
    const src = fakeSource({ "data/history/events/korean-war.yaml": KOREA });
    const out = await normaliseWeek(src, 99, { schema: 2, echo: "korean-war" });
    expect(src.requested).toEqual(["data/history/events/korean-war.yaml"]);
    expect(out.echo).toEqual({
      slug: "korean-war",
      title: "The Korean War",
      date_display: "1950-1953",
      horizon: "1950-1953",
      status: "candidate",
      page: "https://news.voidvision.org/history/korean-war/",
      record: "link:data/history/events/korean-war.yaml",
    });
  });

  it("refuses an echo slug that could leave the history folder, or a slug the record does not hold", async () => {
    for (const bad of ["../sources", "korean-war/../x", "Korean War", "", "a".repeat(81)]) {
      await expect(normaliseWeek(fakeSource({}), 99, { echo: bad })).rejects.toThrow(/echo/);
    }
    const lying = fakeSource({ "data/history/events/korean-war.yaml": SPANISH });
    await expect(normaliseWeek(lying, 99, { echo: "korean-war" })).rejects.toThrow(/echo/);
  });

  it("refuses an unknown schema", async () => {
    await expect(normaliseWeek(fakeSource({}), 99, { schema: 3, echo: "pending" })).rejects.toThrow(/schema/);
  });
});

describe("week 33 record", () => {
  it("has seven days, each a printed lead or a recorded NO PRINT, a board of at least three rows, and nothing after its horizon", () => {
    const text = readFileSync(path.join(root, "data", "week-33.json"), "utf8");
    expect(text.length).toBeLessThan(200_000);
    const w = JSON.parse(text);
    expect(w).toMatchObject({ issue: 33, schema: 2, week_start: "2026-11-02", week_end: "2026-11-08", cover_headline: "The Cost of the Strait" });
    expect(w.days).toHaveLength(7);
    for (const d of w.days) {
      if (d.available) expect(d.lead.title.length, d.date).toBeGreaterThan(0);
      else expect(d.no_print, d.date).toBeTruthy();
    }
    expect(w.lead.board.length).toBeGreaterThanOrEqual(3);
    for (const a of w.lead.ledger) expect(a.published_at <= w.as_of, a.url).toBe(true);
    for (const b of w.lead.board) {
      // Every board headline traces to its ledger row; a strip is disclosed and reversible.
      const raw = b.headline_raw ?? b.headline;
      expect(w.lead.ledger.some((a: { url: string; headline: string }) => a.url === b.url && a.headline === raw), b.url).toBe(true);
      if (b.headline_raw) expect(b.headline + b.stripped_suffix).toBe(b.headline_raw);
      expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(w.echo).toEqual({ slug: null, status: "pending" });
  });
});
