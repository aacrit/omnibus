import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVE_MISSING, NO_PRINT, normaliseWeek, publisherSuffix } from "../scripts/lib/normalise.mjs";

const H = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Google News RSS appends " - <publisher>" to every title it syndicates. The
// board strips it only when that is provable: the outlet is read through a
// Google News feed, the article is a Google News link, and the text after the
// last " - " names the outlet whole (its name, its parenthesis, or its domain).

const GN = "https://news.google.com/rss/articles/CBMabc?oc=5";
const gnOutlet = (name: string, url: string) => ({
  name,
  url,
  rss_url: `https://news.google.com/rss/search?q=site:${new URL(url).host}+when:24h`,
});
const article = (title: string, url = GN) => ({ title, url });

describe("publisherSuffix", () => {
  it("strips the Google News publisher when it is the outlet's name, its parenthesis, or its domain", () => {
    expect(publisherSuffix(article("Vance tries to distance himself - Chicago Tribune"), gnOutlet("Chicago Tribune", "https://www.chicagotribune.com"))).toEqual({
      headline: "Vance tries to distance himself",
      suffix: " - Chicago Tribune",
    });
    expect(publisherSuffix(article("Ebola tops 10,000 cases - AP News"), gnOutlet("Associated Press", "https://apnews.com"))?.suffix).toBe(" - AP News");
    expect(
      publisherSuffix(article("UN officials condemn killing - CGTN"), gnOutlet("CGTN (China Global Television Network)", "https://www.cgtn.com"))?.headline,
    ).toBe("UN officials condemn killing");
    expect(publisherSuffix(article("Vance set to rally - Times Union"), gnOutlet("Albany Times Union", "https://www.timesunion.com"))?.headline).toBe(
      "Vance set to rally",
    );
  });

  it("splits on the last ' - ', so a hyphenated publisher and a dash inside the headline both survive", () => {
    expect(publisherSuffix(article("Talks resume - officials say - Agence France-Presse"), gnOutlet("Agence France-Presse", "https://www.afp.com"))).toEqual({
      headline: "Talks resume - officials say",
      suffix: " - Agence France-Presse",
    });
    expect(
      publisherSuffix(article("Georgia votes - The Atlanta Journal-Constitution"), gnOutlet("Atlanta Journal-Constitution", "https://www.ajc.com"))?.headline,
    ).toBe("Georgia votes");
    expect(publisherSuffix(article("Navy shipyard expands - The Virginian-Pilot"), gnOutlet("The Virginian-Pilot", "https://www.pilotonline.com"))?.suffix).toBe(
      " - The Virginian-Pilot",
    );
  });

  it("never matches part of a name", () => {
    expect(publisherSuffix(article("Senate votes - Chicago"), gnOutlet("Chicago Tribune", "https://www.chicagotribune.com"))).toBeNull();
    expect(publisherSuffix(article("Senate votes - Nation"), gnOutlet("NewsNation", "https://www.newsnationnow.com"))).toBeNull();
    expect(publisherSuffix(article("Senate votes - ape"), gnOutlet("Grapevine", "https://www.grapevine.example"))).toBeNull();
    expect(publisherSuffix(article("Senate votes - Tribune"), gnOutlet("Chicago Tribune", "https://www.chicagotribune.com"))).toBeNull();
  });

  it("keeps the headline whole when the suffix is not provably the RSS publisher", () => {
    const tribune = gnOutlet("Chicago Tribune", "https://www.chicagotribune.com");
    expect(publisherSuffix(article("Senate votes - Reuters"), tribune)).toBeNull();
    expect(publisherSuffix(article("Senate votes - Chicago Tribune", "https://www.chicagotribune.com/x"), tribune)).toBeNull();
    expect(publisherSuffix(article("Senate votes - Chicago Tribune"), { ...tribune, rss_url: "https://www.chicagotribune.com/feed" })).toBeNull();
    expect(publisherSuffix(article("Senate votes - Chicago Tribune", "https://news.google.com.evil.example/rss/articles/x"), tribune)).toBeNull();
    expect(publisherSuffix(article(" - Chicago Tribune"), tribune)).toBeNull();
    expect(publisherSuffix(article("Senate votes - C"), gnOutlet("C", "https://www.c.example"))).toBeNull();
    expect(publisherSuffix(article("Senate votes - Chicago Tribune"), undefined)).toBeNull();
  });
});

// A minimal source: the lead's cluster has a deep dive with one Google News
// row (outlet A) and printed members (outlets A and B, no headlines).
const CID = "00000000-0000-4000-8000-000000000001";
const CID2 = "00000000-0000-4000-8000-000000000002";
function fakeSource(echoFiles: Record<string, string> = {}, { weekDays = [] as string[], deepdive = true } = {}) {
  const outlets = [
    { name: "Chicago Tribune", url: "https://www.chicagotribune.com", rss_url: "https://news.google.com/rss/search?q=site:chicagotribune.com", tier: "us_major", political_lean_baseline: "center-right" },
    { name: "Fox News", url: "https://www.foxnews.com", rss_url: "https://moxie.foxnews.com/feed", tier: "us_major", political_lean_baseline: "right" },
  ];
  const cluster = { id: CID, title: "Lead", category: "politics", source_count: 9, importance_score: 1, bias_diversity: { lean_buckets: {} } };
  const feed = { builtAt: "2026-11-02T10:00:00Z", clusters: [cluster] };
  const archiveRows = [
    { source_cluster_id: CID2, printed_on: "2026-11-02", edition_position: 2, title: "Second", category: "world", source_count: 3, headline_rank: 5, created_at: "2026-11-02T19:00:00Z", members: [] },
    {
      source_cluster_id: CID,
      printed_on: "2026-11-02",
      edition_position: 1,
      title: "Lead printed",
      category: "politics",
      source_count: 9,
      headline_rank: 9,
      created_at: "2026-11-02T19:00:00Z",
      members: [
        { source_name: "Chicago Tribune", url: GN, published_at: "2026-11-02T09:00:00Z" },
        { source_name: "Fox News", url: "https://www.foxnews.com/a", published_at: "2026-11-02T08:00:00Z" },
        { source_name: "Fox News", url: "https://www.foxnews.com/late", published_at: "2026-11-09T08:00:00Z" },
      ],
    },
  ];
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
        week_days: weekDays.map((date) => ({ date, headline: "x" })),
        cover_timelines: [{ story_index: 0, entries: [{ date_iso: "2026-11-02", title: "Lead", source_count: 9, cluster_id: CID }] }],
      },
      link: "weekly",
    }),
    outlets: () => ({ list: outlets, link: "sources" }),
    archive: () => ({ rows: archiveRows, link: "archive" }),
    day: (date: string) => (date === "2026-11-02" ? { feed, link: "feed" } : null),
    deepdive: () =>
      deepdive
        ? { rows: [{ article: { title: "Vance speaks - Chicago Tribune", url: GN, published_at: "2026-11-02T09:00:00Z", source: { name: "Chicago Tribune" } } }], link: "dd" }
        : null,
    echo(p: string) {
      requested.push(p);
      if (!(p in echoFiles)) throw new Error(`no ${p}`);
      return { text: echoFiles[p], link: `link:${p}` };
    },
  };
}

const SPANISH = "slug: spanish-flu-1918\ntitle: The 1918 Influenza Pandemic\ndate_display: 1918-1919\n";
const KOREA = "slug: korean-war\ntitle: The Korean War\ndate_display: 1950-1953\n";
const V2 = { schema: 2, echo: "pending" };

describe("normaliseWeek, schema 1 (week 32's rules)", () => {
  it("keeps the board headline as printed and the week-32 echo for week 32", async () => {
    const src = fakeSource({ "data/history/events/spanish-flu-1918.yaml": SPANISH });
    src.weekly = (() => {
      const w = fakeSource().weekly();
      w.issue.issue_number = 32;
      return () => w;
    })();
    const out = await normaliseWeek(src, 32);
    expect(out.schema).toBeUndefined();
    expect(out.lead.board[0].headline).toBe("Vance speaks - Chicago Tribune");
    expect(out.lead.board[0].headline_raw).toBeUndefined();
    expect(out.days[1]).toEqual({ date: "2026-11-03", available: false });
    expect(out.echo).toMatchObject({ slug: "spanish-flu-1918", status: "candidate", alternate: "black-death" });
  });

  it("requires --echo for any other issue, and for schema 2 even at week 32", async () => {
    await expect(normaliseWeek(fakeSource({}), 99)).rejects.toThrow(/--echo is required/);
    await expect(normaliseWeek(fakeSource({}), 32, { schema: 2 })).rejects.toThrow(/--echo is required/);
  });
});

describe("normaliseWeek, schema 2 (printed editions)", () => {
  it("takes each day's lead from archive.json edition_position 1, with that edition's size and print time", async () => {
    const out = await normaliseWeek(fakeSource({}), 99, V2);
    expect(out.schema).toBe(2);
    expect(out.normalised_from.archive).toBe("archive");
    expect(out.days[0]).toMatchObject({
      date: "2026-11-02",
      available: true,
      printed_at: "2026-11-02T19:00:00Z",
      printed_count: 2,
      record: "archive",
      lead: { cluster_id: CID, edition_position: 1, title: "Lead printed" },
      next: [{ title: "Second", source_count: 3 }],
    });
    expect(out.days[0].snapshot).toBeUndefined();
  });

  it("records NO PRINT only when neither archive.json nor the weekly's week_days has the date", async () => {
    const out = await normaliseWeek(fakeSource({}, { weekDays: ["2026-11-03"] }), 99, V2);
    expect(out.days[1]).toEqual({ date: "2026-11-03", available: false, archive_missing: ARCHIVE_MISSING });
    expect(out.days[2]).toEqual({ date: "2026-11-04", available: false, no_print: NO_PRINT });
  });

  it("pools the printed members into the lead's counts, inside the horizon, and boards only outlets with a headline", async () => {
    const out = await normaliseWeek(fakeSource({}), 99, V2);
    expect(out.lead.outlets).toBe(2);
    expect(out.lead.articles).toBe(2); // the Tribune link once; Fox's late member is after the horizon
    expect(out.lead.after_horizon).toBe(1);
    expect(out.lead.untitled_articles).toBe(1);
    expect(out.lead.coverage_complete).toBe(true);
    expect(out.lead.board.map((b: { rung: string }) => b.rung)).toEqual(["center-right"]);
    expect(out.lead.board_untitled_rungs).toEqual(["right"]);
    expect(out.lead.records[0]).toMatchObject({ cluster_id: CID, deepdive: "dd", archive: { printed_on: "2026-11-02", members: 3, record: "archive" } });
  });

  it("strips a provable publisher suffix, records the raw headline, both hashes, the cluster and record date", async () => {
    const out = await normaliseWeek(fakeSource({}), 99, V2);
    const b = out.lead.board[0];
    expect(b).toMatchObject({
      cluster_id: CID,
      record_date: "2026-11-02",
      headline: "Vance speaks",
      headline_raw: "Vance speaks - Chicago Tribune",
      stripped_suffix: " - Chicago Tribune",
    });
    expect(b.headline_sha256).not.toBe(b.sha256);
    expect(b.headline_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The ledger stays verbatim; a member without a deep dive row has no headline.
    expect(out.lead.ledger.map((a: { headline: string | null }) => a.headline)).toEqual([null, "Vance speaks - Chicago Tribune"]);
  });

  it("says coverage is incomplete, naming the cluster, when a lead cluster has neither a deep dive nor printed members", async () => {
    const src = fakeSource({}, { deepdive: false });
    src.archive = () => ({ rows: [], link: "archive" });
    const out = await normaliseWeek(src, 99, V2);
    expect(out.lead.coverage_complete).toBe(false);
    expect(out.lead.excluded_clusters).toEqual([{ cluster_id: CID, source_count: 9 }]);
  });

  it("an untitled printed member read first takes its headline from a later cluster's deep dive, keeping its first origin", async () => {
    const src = fakeSource({}, { deepdive: false });
    const base = src.weekly();
    base.issue.cover_timelines[0].entries.push({ date_iso: "2026-11-03", title: "Second", source_count: 3, cluster_id: CID2 });
    src.weekly = () => base;
    src.deepdive = ((id: string) =>
      id === CID2
        ? { rows: [{ article: { title: "Fox headline", url: "https://www.foxnews.com/a", published_at: "2026-11-02T08:00:00Z", source: { name: "Fox News" } } }], link: "dd2" }
        : null) as typeof src.deepdive;
    const out = await normaliseWeek(src, 99, V2);
    const fox = out.lead.ledger.find((a: { url: string }) => a.url === "https://www.foxnews.com/a");
    expect(fox.headline).toBe("Fox headline");
    expect(out.lead.untitled_articles).toBe(1); // the Tribune member only
    const row = out.lead.board.find((b: { rung: string }) => b.rung === "right");
    expect(row).toMatchObject({ outlet: "Fox News", headline: "Fox headline", cluster_id: CID, record_date: "2026-11-02" });
  });

  it("counts fewer members read than archive.json's member_count as a coverage gap", async () => {
    const src = fakeSource({});
    const rows = src.archive().rows.map((r) => (r.source_cluster_id === CID ? { ...r, member_count: 75 } : r));
    src.archive = () => ({ rows, link: "archive" });
    const out = await normaliseWeek(src, 99, V2);
    expect(out.lead.coverage_complete).toBe(false);
    expect(out.lead.excluded_clusters).toEqual([{ cluster_id: CID, source_count: 9, member_count: 75, members_read: 3 }]);
  });

  it("refuses a source without archive.json", async () => {
    const src: Record<string, unknown> = fakeSource({});
    delete src.archive;
    await expect(normaliseWeek(src, 99, V2)).rejects.toThrow(/archive\.json/);
  });
});

describe("normaliseWeek echo option", () => {
  it("--echo pending reads no history file and says the echo is not picked", async () => {
    const src = fakeSource({});
    const out = await normaliseWeek(src, 99, V2);
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

  it("refuses an echo slug that could leave the history folder, or a record naming another slug", async () => {
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

// Board rows on a Google News link whose suffix the rule could not prove are
// listed here with a reason, or the record fails: an unstripped publisher
// name would print as part of a headline.
const UNSTRIPPED_GOOGLE_NEWS_ALLOWED: Record<string, string> = {};

const schema2Records = readdirSync(path.join(root, "data"))
  .filter((f) => /^week-\d+\.json$/.test(f))
  .map((f) => ({ f, w: JSON.parse(readFileSync(path.join(root, "data", f), "utf8")) }))
  .filter(({ w }) => (w.schema ?? 1) >= 2);

describe("schema 2 week records", () => {
  it("week 33 is one of them", () => {
    expect(schema2Records.map(({ f }) => f)).toContain("week-33.json");
  });

  for (const { f, w } of schema2Records) {
    it(`${f}: seven days, each printed or recorded missing, a board of at least three rows, nothing after the horizon`, () => {
      expect(readFileSync(path.join(root, "data", f)).byteLength).toBeLessThan(200_000);
      expect(w.days).toHaveLength(7);
      for (const d of w.days) {
        if (d.available) expect(d.lead.title.length, d.date).toBeGreaterThan(0);
        else expect(d.no_print === NO_PRINT || d.archive_missing === ARCHIVE_MISSING, d.date).toBe(true);
      }
      expect(w.lead.board.length).toBeGreaterThanOrEqual(3);
      for (const a of w.lead.ledger) expect(a.published_at == null || a.published_at <= w.as_of, a.url).toBe(true);
      expect(typeof w.lead.coverage_complete).toBe("boolean");
      if (!w.lead.coverage_complete) expect(w.lead.excluded_clusters.length).toBeGreaterThan(0);
    });

    it(`${f}: every board row traces to its ledger row, discloses any strip, and a Google News row is stripped or allowed`, () => {
      for (const b of w.lead.board) {
        const raw = b.headline_raw ?? b.headline;
        expect(w.lead.ledger.some((a: { url: string; headline: string }) => a.url === b.url && a.headline === raw), b.url).toBe(true);
        if (b.headline_raw) expect(b.headline + b.stripped_suffix).toBe(b.headline_raw);
        expect(b.sha256, b.url).toBe(H(b.headline_raw ?? b.headline));
        expect(b.headline_sha256, b.url).toBe(H(b.headline));
        expect(b.cluster_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(b.record_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (new URL(b.url).hostname === "news.google.com" && !b.headline_raw) {
          expect(UNSTRIPPED_GOOGLE_NEWS_ALLOWED[b.url], `${b.outlet}: Google News row kept whole without an allowance`).toBeTruthy();
        }
      }
    });
  }
});
