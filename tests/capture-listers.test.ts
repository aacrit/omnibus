// C2: the capture listers, each against a small recorded fixture (metadata only, no media) through injected HTTP.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultSince, parseFeed, youtubeIds } from "../scripts/capture/listers/feed.mjs";
import { listWhiteHouse, matchCommons, parseWhiteHouseFeed, titleOverlap } from "../scripts/capture/listers/whitehouse.mjs";
import { categoryUrl, listCommons, parseCategory } from "../scripts/capture/listers/commons.mjs";
import { listDvids, publishedUrl } from "../scripts/capture/listers/dvids.mjs";
import { listVoa } from "../scripts/capture/listers/voa.mjs";
import { listNasa } from "../scripts/capture/listers/nasa.mjs";
import { listCdc } from "../scripts/capture/listers/cdc.mjs";
import { listNoaa } from "../scripts/capture/listers/noaa.mjs";
import { NotALocator, locate, locatorRefusal, readCapturedPage } from "../scripts/capture/listers/wayback.mjs";

const text = (n: string) => readFileSync(new URL(`./fixtures/capture/${n}`, import.meta.url), "utf8");
const json = (n: string, dir = "capture") => JSON.parse(readFileSync(new URL(`./fixtures/${dir}/${n}`, import.meta.url), "utf8")).response;
const NOW = new Date("2026-11-13T18:00:00Z");
const now = () => NOW;
const SHAPE = ["source", "id", "url", "title", "description", "published_at", "captured_at"];

type Answer = { status: string; text?: string; json?: unknown };
function fakeHttp(route: (url: string) => Answer | undefined) {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    return route(url) ?? { status: "not_found" };
  };
  return { http: { getText: get, getJson: get }, calls };
}

function expectShape(items: Record<string, unknown>[]) {
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    for (const k of SHAPE) expect(it).toHaveProperty(k);
    expect(String(it.url)).toMatch(/^https:\/\//);
    expect(it.captured_at).toBe("2026-11-13T18:00:00Z");
  }
}

describe("feed helpers", () => {
  it("reads RSS and Atom, and finds YouTube ids", () => {
    expect(parseFeed(text("voa-feed.xml"))).toHaveLength(3);
    expect(parseFeed(text("cdc-feed.xml"))[0].guid).toMatch(/^https:\/\/www\.cdc\.gov\/media\/releases\//);
    expect(youtubeIds('<a href="https://www.youtube.com/watch?v=VVo0xJr_7iQ">x</a> https://youtu.be/eKS-qvCmoSA')).toEqual(["VVo0xJr_7iQ", "eKS-qvCmoSA"]);
    expect(defaultSince(NOW)).toBe("2026-11-10T18:00:00Z");
  });
});

describe("White House: locators only, matched to Commons", () => {
  it("lists video pages and news as locators with no media URL", async () => {
    const { http } = fakeHttp((u) =>
      u.endsWith("/videos/feed/") ? { status: "ok", text: text("whitehouse-videos-feed.xml") } : u.endsWith("/news/feed/") ? { status: "ok", text: text("whitehouse-news-feed.xml") } : undefined,
    );
    const r = await listWhiteHouse({ http, now });
    expectShape(r.items);
    expect(r.items.every((i) => i.locator === true && i.media_url === null)).toBe(true);
    expect(r.items.some((i) => i.kind === "video-page")).toBe(true);
    expect(r.items.map((i) => i.url).join(" ")).not.toMatch(/youtube|\.mp4|\.webm/);
    const v = r.items.find((i) => i.title === "Veterans Day at Arlington National Cemetery 2026");
    expect(v).toMatchObject({ published_at: "2026-11-13T01:33:05Z", url: "https://www.whitehouse.gov/videos/veterans-day-at-arlington-national-cemetery-2026/" });
  });

  it("drops items older than the window", () => {
    const items = parseWhiteHouseFeed(text("whitehouse-videos-feed.xml"), { capturedAt: "x", since: "2026-11-12T00:00:00Z" });
    expect(items.every((i) => Date.parse(i.published_at as string) >= Date.parse("2026-11-12T00:00:00Z"))).toBe(true);
  });

  it("matches a White House video to its Commons upload by title and date, never a stranger", () => {
    const wh = parseWhiteHouseFeed(text("whitehouse-videos-feed.xml"), { capturedAt: "x" });
    const commons = parseCategory(json("commons-wh-category.json"), { category: "c", capturedAt: "x" });
    const m = Object.fromEntries(matchCommons(wh, commons).map((x) => [x.whitehouse_id, x.match]));
    expect(m["https://www.whitehouse.gov/videos/veterans-day-at-arlington-national-cemetery-2026/"]).toMatchObject({ commons_id: "File:Veterans Day at Arlington National Cemetery 2026.webm", by: "title" });
    const ceremony = wh.find((w) => /National Veterans Day Ceremony/.test(w.title as string))!;
    expect(m[ceremony.id]).toBeNull();
    expect(titleOverlap("To our veterans: We pledge you our utmost loyalty", "To our veterans - We pledge you our utmost loyalty.webm")).toBe(1);
  });

  it("matches on a shared YouTube id outright", () => {
    const wh = [{ id: "w", title: "Remarks", published_at: "2026-11-04T20:00:00Z", youtube_ids: ["VVo0xJr_7iQ"] }];
    const commons = parseCategory(json("commons-wh-category.json"), { category: "c", capturedAt: "x" });
    expect(matchCommons(wh, commons)[0].match).toMatchObject({ by: "youtube-id", youtube_id: "VVo0xJr_7iQ" });
  });
});

describe("Commons", () => {
  it("lists new uploads with their media URL cleaned and the YouTube source id", async () => {
    const { http, calls } = fakeHttp((u) => (u.startsWith("https://commons.wikimedia.org/w/api.php") ? { status: "ok", json: json("commons-wh-category.json") } : undefined));
    const r = await listCommons({ http, now, categories: ["Category:Videos by The White House posted on YouTube (Donald Trump, 2025-2029)"], maxPages: 1 });
    expectShape(r.items);
    expect(calls).toHaveLength(1);
    const f = r.items.find((i) => i.id.startsWith("File:To our veterans"))!;
    expect(f).toMatchObject({ youtube_ids: ["VVo0xJr_7iQ"], event_date: "2026-11-11", mime: "video/webm", published_at: "2026-11-12T14:12:21Z" });
    expect(f.media_url).not.toMatch(/utm_/);
    expect(categoryUrl("Category:X")).toMatch(/gcmsort=timestamp&gcmdir=desc/);
  });
});

describe("DVIDS: by publish date, key from the environment, never logged", () => {
  const KEY = "key-SECRET-1234567890";
  it("lists assets by publish date and keeps the key out of every item", async () => {
    const { http, calls } = fakeHttp((u) => (u.startsWith("https://api.dvidshub.net/search?") ? { status: "ok", json: json("dvids-search-hegseth.json", "rights"), text: "x" } : undefined));
    const r = await listDvids({ http, env: { DVIDS_API_KEY: KEY }, now: () => new Date("2026-11-07T00:00:00Z"), since: "2026-11-01T00:00:00Z" });
    expectShape(r.items.map((i) => ({ ...i, captured_at: "2026-11-13T18:00:00Z" })));
    expect(r.items[0]).toMatchObject({ source: "dvids", id: "video:1028891", url: "https://www.dvidshub.net/video/1028891", published_at: "2026-11-06T15:11:07Z" });
    expect(calls[0]).toMatch(/from_publishdate=2026-11-01T00%3A00%3A00Z/);
    expect(calls[0]).toMatch(/sort=publishdate/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("skips without a key and redacts the key from an error", async () => {
    const none = await listDvids({ http: fakeHttp(() => undefined).http, env: {}, now });
    expect(none).toMatchObject({ items: [], skipped: expect.stringMatching(/DVIDS_API_KEY is not set/) });
    const boom = { getJson: async (u: string) => { throw new Error(`${u} answered 500`); }, getText: async () => ({ status: "not_found" }) };
    const err = await listDvids({ http: boom, env: { DVIDS_API_KEY: KEY }, now }).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(String((err as Error).message)).toContain("[DVIDS_API_KEY]");
    expect(publishedUrl({ from: "2026-11-01T00:00:00Z" }, "k")).toMatch(/type%5B%5D=video&type%5B%5D=image/);
  });
});

describe("VOA, NASA, CDC, NOAA", () => {
  it("VOA: own article pages only", async () => {
    const { http } = fakeHttp(() => ({ status: "ok", text: text("voa-feed.xml") }));
    const r = await listVoa({ http, now });
    expectShape(r.items);
    expect(r.items.every((i) => /^https:\/\/www\.voanews\.com\/a\/\d+\.html$/.test(i.url))).toBe(true);
    const wired = text("voa-feed.xml").replace(/<author>[^<]*<\/author>/, "<author>webdesk@voanews.com (Associated Press)</author>");
    const r2 = await listVoa({ http: fakeHttp(() => ({ status: "ok", text: wired })).http, now });
    expect(r2.wire_dropped).toBe(1);
    expect(r2.items).toHaveLength(r.items.length - 1);
  });

  it("NASA: images-api items with NASA's own date_created", async () => {
    const { http, calls } = fakeHttp((u) => (u.includes("media_type=video") ? { status: "ok", json: json("nasa-search-video-2026.json") } : undefined));
    const r = await listNasa({ http, now, since: "2026-01-01T00:00:00Z", mediaTypes: ["video"] });
    expectShape(r.items);
    expect(r.items[0].url).toMatch(/^https:\/\/images\.nasa\.gov\/details\//);
    expect(calls[0]).toMatch(/year_start=2026/);
  });

  it("CDC: the release page is the locator, not the download redirect", async () => {
    const { http } = fakeHttp(() => ({ status: "ok", text: text("cdc-feed.xml") }));
    const r = await listCdc({ http, now, since: "2026-01-01T00:00:00Z" });
    expectShape(r.items);
    expect(r.items.every((i) => i.url.startsWith("https://www.cdc.gov/media/releases/"))).toBe(true);
  });

  it("NOAA: RSS items keep their own HTML and image credits", async () => {
    const { http } = fakeHttp(() => ({ status: "ok", text: text("noaa-feed.xml") }));
    const r = await listNoaa({ http, now, since: "2026-11-01T00:00:00Z" });
    expectShape(r.items);
    const credits = r.items.flatMap((i) => i.image_credits as string[]);
    expect(credits).toContain("NOAA");
    expect(credits.some((c) => /Getty Images/.test(c))).toBe(true);
    expect(r.items.every((i) => String(i.item_html).length > 0)).toBe(true);
  });
});

describe("wayback locator: refused hosts' pages only, never media", () => {
  const W = { from: "2026-11-02", to: "2026-11-08" };
  it("refuses media URLs, Wayback media flags, and hosts that answer us", () => {
    expect(locatorRefusal("https://www.war.gov/News/Releases/Release/Article/4000000/")).toBeNull();
    expect(locatorRefusal("https://web.archive.org/web/20261104120000/https://www.state.gov/briefings/department-press-briefing-november-4-2026/")).toBeNull();
    expect(locatorRefusal("https://media.defense.gov/2026/Nov/06/2003000000/-1/-1/0/X.JPG")).toMatch(/media file/);
    expect(locatorRefusal("https://www.war.gov/portals/1/video/clip.mp4")).toMatch(/media file/);
    expect(locatorRefusal("https://web.archive.org/web/20261104120000/https://www.war.gov/x.jpg")).toMatch(/media file/);
    expect(locatorRefusal("https://web.archive.org/web/20261104120000im_/https://www.war.gov/News/")).toMatch(/Wayback media capture/);
    expect(locatorRefusal("https://web.archive.org/web/20261104120000/https://www.whitehouse.gov/videos/x/")).toMatch(/read directly/);
    expect(locatorRefusal("https://www.dvidshub.net/video/1028785")).toMatch(/read directly/);
  });

  it("throws before any request for a media URL", async () => {
    const { http, calls } = fakeHttp(() => ({ status: "ok", text: "<html></html>", json: [] }));
    await expect(readCapturedPage("https://web.archive.org/web/20261104120000/https://www.war.gov/clip.mp4", { http })).rejects.toBeInstanceOf(NotALocator);
    await expect(locate("https://www.war.gov/video.webm", W, { http })).rejects.toThrow(/media file/);
    expect(calls).toHaveLength(0);
  });

  it("locates a refused host's page captures through CDX and reads one page for its date", async () => {
    // The CDX JSON shape (header row, then rows); the archive answered 503 when this fixture was due, so these rows are written by hand.
    const cdx = [
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["gov,war)/news/releases", "20261106151500", "https://www.war.gov/News/Releases/", "text/html", "200", "D1", "1000"],
      ["gov,war)/x.jpg", "20261106151600", "https://www.war.gov/x.jpg", "image/jpeg", "200", "D2", "1000"],
    ];
    const { http, calls } = fakeHttp((u) => (u.startsWith("https://web.archive.org/cdx/") ? { status: "ok", json: cdx } : { status: "ok", text: "<html><title>Releases</title></html>" }));
    const caps = await locate("www.war.gov/News/Releases/*", W, { http });
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ captured_at: "2026-11-06T15:15:00Z", use: expect.stringMatching(/never a media source/) });
    const page = await readCapturedPage(caps[0].capture_url, { http });
    expect(page).toMatchObject({ status: "ok", witness: { original_url: "https://www.war.gov/News/Releases/" } });
    expect(calls[1]).toBe("https://web.archive.org/web/20261106151500id_/https://www.war.gov/News/Releases/");
  });
});
