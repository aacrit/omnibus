// E5: the federal .gov and Wayback host extension, the NARA catalogue,
// date windows, drop records, date witnesses, the resolver and the coverage
// page. Small inline HTML and JSON fixtures only; no media, no network.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as gov from "../scripts/lib/rights/adapters/gov.mjs";
import * as nara from "../scripts/lib/rights/adapters/nara.mjs";
import * as wayback from "../scripts/lib/rights/adapters/wayback.mjs";
import { hostRefusal, isAllowedUrl } from "../scripts/lib/rights/http.mjs";
import { dateSpan, fetchRequests, windowProblem } from "../scripts/lib/rights/fetcher.mjs";
import { emptyLedger, validateLedger, validateRequests } from "../scripts/lib/rights/ledger.mjs";
import { checkCandidate } from "../scripts/lib/rights/provenance.mjs";
import { fallbackTier, resolveRequests, rssItems, stepParams, pinProblems, videoFirst } from "../scripts/lib/rights/resolve.mjs";
import { buildCoverage, cell } from "../scripts/lib/rights/coverage.mjs";
import { lintEpisode } from "../scripts/lib/rights/lints.mjs";

const XSS = '"><img src=x onerror=alert(1)>';
const AT = "2026-11-12T10:00:00Z";

const whPage = (body: string, extra = "") => `<html><head><meta property="og:site_name" content="The White House" />
<meta property="og:title" content="President Names a Chief of Staff" />
<meta property="article:published_time" content="2026-11-06T21:56:55+00:00" />${extra}</head><body><main>${body}</main></body></html>`;

describe("host policy: federal hosts and Wayback captures", () => {
  it("allows federal hosts and their subdomains, https only", () => {
    for (const u of ["https://www.whitehouse.gov/x", "https://www.slotkin.senate.gov/feed/", "https://wwwn.cdc.gov/phil/", "https://catalog.archives.gov/id/1", "https://www.govinfo.gov/a.pdf", "https://www.centcom.mil/", "https://www.trumanlibrary.gov/library/"]) {
      expect(isAllowedUrl(u), u).toBe(true);
    }
    expect(isAllowedUrl("http://www.whitehouse.gov/")).toBe(false);
    expect(isAllowedUrl("https://whitehouse.gov.evil.com/")).toBe(false);
    expect(isAllowedUrl("https://notwhitehouse.gov/")).toBe(false);
    expect(isAllowedUrl("https://dsns.gov.ua/")).toBe(false);
    expect(isAllowedUrl("https://www.gov.uk/")).toBe(false);
  });

  it("allows only dated captures and the CDX index on web.archive.org", () => {
    expect(hostRefusal("https://web.archive.org/web/20261104155039/https://x.com/JDVance/status/1")).toBeNull();
    expect(hostRefusal("https://web.archive.org/web/20261104155039id_/https://x.com/JDVance/status/1")).toBeNull();
    expect(hostRefusal("https://web.archive.org/cdx/search/cdx?url=x.com")).toBeNull();
    expect(hostRefusal("https://web.archive.org/save/https://x.com/")).toMatch(/only dated captures/);
    expect(hostRefusal("https://web.archive.org/web/2026/https://x.com/")).toMatch(/only dated captures/);
    expect(hostRefusal("https://archive.org/download/x.pdf")).toMatch(/not on the fetcher's domain allowlist/);
  });
});

describe("federal page adapter", () => {
  const pageUrl = "https://www.whitehouse.gov/releases/2026/11/chief-of-staff/";
  it("takes a page as a federal document when it names its body and credits no one outside it", () => {
    const r = gov.parseFederalPage(whPage("<p>Today the President announced a new Chief of Staff.</p>"), { pageUrl, kind: "document", capturedAt: AT });
    const c = r.candidate;
    expect(c).toMatchObject({ licence: "pd-us-federal", media_url: pageUrl, ext: ".html", credit: "The White House", published_at: "2026-11-06T21:56:55Z" });
    expect(c.evidence.captured_text).toMatch(/17 U\.S\.C\. 105/);
    expect(checkCandidate({ ...c, kind: "document" }).reasons).toEqual([]);
  });

  it("refuses a page that credits a third party, and one that does not name its body", () => {
    const credited = gov.parseFederalPage(whPage("<figure><img src='/a.jpg'><figcaption>Photo by Jane Doe, Reuters</figcaption></figure>"), { pageUrl, kind: "document", capturedAt: AT }).candidate;
    expect(credited.licence).toBeNull();
    expect(credited.licence_note).toMatch(/credits a party outside The White House/);
    expect(checkCandidate({ ...credited, kind: "document" }).ok).toBe(false);
    const ok = gov.parseFederalPage(whPage("<p>Official White House Photo by Daniel Torok</p>"), { pageUrl, kind: "document", capturedAt: AT }).candidate;
    expect(ok.licence).toBe("pd-us-federal");
    const anon = gov.parseFederalPage("<html><body><p>Hello</p></body></html>", { pageUrl, kind: "document", capturedAt: AT }).candidate;
    expect(anon.licence_note).toMatch(/does not name The White House/);
  });

  it("review: refuses agency, stock and pool credits in any common form, read to the end of their element", () => {
    for (const credit of ["(AP Photo/Evan Vucci)", "Photo: Reuters/Kevin Lamarque", "Image: Getty Images", "(Andrew Harnik/Getty Images)", "Photo by Reuters", "The President speaks. (Reuters)"]) {
      const html = whPage(`<p>The President spoke at the White House.</p><figure><img src="/a.jpg"><figcaption>The President speaks. ${credit}</figcaption></figure>`);
      const c = gov.parseFederalPage(html, { pageUrl, kind: "document", capturedAt: AT }).candidate;
      expect(c.licence, credit).toBeNull();
      expect(c.licence_note, credit).toMatch(/credits a party outside The White House/);
    }
    // a credit is read only to its element's end, not cut at a full stop ("Photo by J. Smith/Reuters")
    expect(gov.pageCredits("<figcaption>Photo by J. Smith/Reuters</figcaption><p>Next.</p>")).toContain("Photo by J. Smith/Reuters");
    // a federal office does not launder an agency named in the same credit
    expect(gov.isFederalCredit("Official White House Photo by AP", gov.agencyFor("www.whitehouse.gov"))).toBe(false);
    expect(gov.isFederalCredit("Official White House Photo by Emily J. Higgins", gov.agencyFor("www.whitehouse.gov"))).toBe(true);
  });

  it("review: takes a still only with a positive federal credit", () => {
    const og = '<meta property="og:image" content="https://www.whitehouse.gov/wp-content/uploads/2026/11/P20261106.jpg" />';
    const bare = gov.parseFederalPage(whPage("<p>Text.</p>", og), { pageUrl, kind: "still", capturedAt: AT }).candidate;
    expect(bare.licence_note).toMatch(/no captioned figure of its own/);
    const uncredited = gov.parseFederalPage(whPage(`<figure><img src="/wp-content/uploads/2026/11/P20261106.jpg" /><figcaption>The President.</figcaption></figure>`, og), { pageUrl, kind: "still", capturedAt: AT }).candidate;
    expect(uncredited.licence_note).toMatch(/own caption states no federal credit/);
    const img = '<img src="/wp-content/uploads/2026/11/P20261106.jpg" />';
    const credited = gov.parseFederalPage(whPage(`<figure>${img}<figcaption>Official White House Photo by Daniel Torok</figcaption></figure>`, og), { pageUrl, kind: "still", capturedAt: AT }).candidate;
    expect(credited).toMatchObject({ licence: "pd-us-federal", media_url: "https://www.whitehouse.gov/wp-content/uploads/2026/11/P20261106.jpg" });
  });

  it("re-review: only the picture's own figure speaks for it; a federal credit elsewhere on the page does not", () => {
    const og = '<meta property="og:image" content="https://www.whitehouse.gov/wp-content/uploads/2026/11/P20261106.jpg" />';
    const fed = '<figure><img src="/wp-content/uploads/2026/11/other.jpg" /><figcaption>(Official White House Photo by Daniel Torok)</figcaption></figure>';
    for (const caption of ["Credit: Jane Doe/The New York Times", "Doug Mills/The New York Times", "Jane Doe for The Washington Post"]) {
      const html = whPage(`${fed}<figure><img src="https://www.whitehouse.gov/wp-content/uploads/2026/11/P20261106.jpg" /><figcaption>The President at the lectern. ${caption}</figcaption></figure>`, og);
      const c = gov.parseFederalPage(html, { pageUrl, kind: "still", capturedAt: AT }).candidate;
      expect(c.licence, caption).toBeNull();
      expect(c.licence_note, caption).toMatch(/own caption credits a party outside The White House/);
    }
    // the picture in no figure at all, with a federal caption elsewhere: refused
    const loose = gov.parseFederalPage(whPage(`${fed}<img src="/wp-content/uploads/2026/11/P20261106.jpg" />`, og), { pageUrl, kind: "still", capturedAt: AT }).candidate;
    expect(loose.licence_note).toMatch(/no captioned figure of its own/);
    expect(gov.pageCredits("<p>Credit: Jane Doe</p>")).toContain("Credit: Jane Doe");
  });

  it("refuses a third-party video embed and a social share card", () => {
    const yt = gov.parseFederalPage(whPage('<iframe src="https://www.youtube.com/embed/abc"></iframe><iframe src="https://www.googletagmanager.com/ns.html"></iframe>'), { pageUrl, kind: "footage", capturedAt: AT }).candidate;
    expect(yt.licence).toBeNull();
    expect(yt.licence_note).toMatch(/third-party embed \(www\.youtube\.com\)/);
    expect(yt.related_urls).toEqual(["https://www.youtube.com/embed/abc"]);
    const card = gov.parseFederalPage(whPage("", '<meta property="og:image" content="https://www.whitehouse.gov/wp-content/uploads/2025/03/WH47-Social-Share-Card.jpg" />'), { pageUrl, kind: "still", capturedAt: AT }).candidate;
    expect(card.licence_note).toMatch(/share card/);
  });

  it("takes an explicit media file only from the same body's host", () => {
    const html = whPage('<a href="https://www.whitehouse.gov/wp-content/uploads/a.pdf">PDF</a>');
    expect(gov.parseFederalPage(html, { pageUrl, kind: "document", media: "https://www.whitehouse.gov/wp-content/uploads/a.pdf", capturedAt: AT }).candidate.licence).toBe("pd-us-federal");
    expect(gov.parseFederalPage(html, { pageUrl, kind: "document", media: "https://www.senate.gov/a.pdf", capturedAt: AT }).candidate.licence_note).toMatch(/not on whitehouse\.gov/);
    expect(gov.parseFederalPage(html, { pageUrl, kind: "document", media: "https://www.whitehouse.gov/other.pdf", capturedAt: AT }).candidate.licence_note).toMatch(/not named on the page/);
  });

  it("keeps markup out of every stored field", () => {
    const c = gov.parseFederalPage(whPage(`<p>&lt;img src=x onerror=alert(1)&gt; ${XSS}</p>`).replace("President Names a Chief of Staff", XSS.replace(/"/g, "&quot;")), { pageUrl, kind: "document", capturedAt: AT }).candidate;
    expect(c.evidence.captured_text).not.toMatch(/<img/);
  });
});

describe("National Archives catalogue adapter", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    body: {
      hits: {
        hits: [
          {
            _source: {
              record: {
                naId: 542283,
                title: "COMBAT CARGO, KOREA -- A helicopter",
                localIdentifier: "342-AF-86335AC",
                useRestriction: { status: "Unrestricted" },
                productionDates: [{ month: 6, year: 1952, logicalDate: "1952-06-01" }],
                digitalObjects: [
                  { objectType: "Image (GIF)", objectUrl: "https://catalog.archives.gov/medialz/a.gif" },
                  { objectType: "Image (TIFF)", objectUrl: "https://catalog.archives.gov/medialz/a.TIF" },
                ],
                ancestors: [
                  { levelOfDescription: "recordGroup", recordGroupNumber: 342, title: "Records of U.S. Air Force Commands" },
                  { levelOfDescription: "series", title: "Photographs of Activities", creators: [{ heading: "Department of Defense. Department of the Air Force. (09/26/1947 - )" }] },
                ],
                ...over,
              },
            },
          },
        ],
      },
    },
  });
  it("builds its catalogue URL", () => expect(nara.searchUrl(542283)).toBe("https://catalog.archives.gov/proxy/records/search?naId=542283"));
  it("passes an unrestricted record of a federal agency, with its TIFF and month", () => {
    const c = nara.parseNara(rec(), { ref: "542283", capturedAt: AT }).candidate;
    expect(c).toMatchObject({ licence: "pd-us-federal", media_url: "https://catalog.archives.gov/medialz/a.TIF", date: "1952-06", item_url: "https://catalog.archives.gov/id/542283" });
    expect(checkCandidate({ ...c, kind: "still" }).reasons).toEqual([]);
  });
  it("refuses a restricted use, a record with no federal creator, and donated material", () => {
    expect(nara.parseNara(rec({ useRestriction: { status: "Restricted - Fully" } }), { ref: "542283", capturedAt: AT }).candidate.licence).toBeNull();
    expect(nara.parseNara(rec({ ancestors: [{ levelOfDescription: "series", title: "X", creators: [{ heading: "Smith, John" }] }] }), { ref: "542283", capturedAt: AT }).candidate.licence).toBeNull();
    expect(nara.parseNara(rec({ scopeAndContentNote: "Donated by the family." }), { ref: "542283", capturedAt: AT }).candidate.licence).toBeNull();
    expect(nara.parseNara(rec(), { ref: "999", capturedAt: AT }).status).toBe("not_found");
  });
});

describe("Wayback date witness", () => {
  const cap = "https://web.archive.org/web/20261104155039/https://x.com/JDVance/status/2118004988433641835";
  it("reads a capture address into a witness", () => {
    expect(wayback.witnessOf(cap)).toEqual({
      service: "Internet Archive Wayback Machine",
      capture_url: cap,
      raw_url: "https://web.archive.org/web/20261104155039id_/https://x.com/JDVance/status/2118004988433641835",
      captured_at: "2026-11-04T15:50:39Z",
      original_url: "https://x.com/JDVance/status/2118004988433641835",
    });
    expect(wayback.isoToTs("2026-11-04T19:39:06.061256+00:00")).toBe("20261104193906");
    expect(wayback.isoToTs("2026-11-04", { end: true })).toBe("20261104235959");
  });
  it("lists CDX captures inside the window only", () => {
    const rows = [["urlkey", "timestamp", "original"], ["k", "20261104155039", "https://x.com/a"], ["k", "20261105000000", "https://x.com/b"], ["k", "20261102000000", "https://x.com/c"]];
    expect(wayback.parseCdx(rows, { from: "2026-11-03", to: "2026-11-04T19:39:06Z" }).map((c: { original: string }) => c.original)).toEqual(["https://x.com/a"]);
  });
  it("never licenses a non-federal original, and keeps the capture time in the reason", () => {
    const c = wayback.parseCapturePage('<meta property="og:description" content="A post." />', { ref: cap, kind: "document", capturedAt: AT }).candidate;
    expect(c.licence).toBeNull();
    expect(c.licence_note).toMatch(/date witness, never a licence/);
    expect(c.licence_note).toMatch(/2026-11-04T15:50:39Z/);
    expect(c.description).toBe("A post.");
  });
  it("reads a capture of a federal page as that page, the capture as its witness", () => {
    const fed = "https://web.archive.org/web/20261106220000/https://www.whitehouse.gov/releases/x/";
    const c = wayback.parseCapturePage(whPage("<p>text</p>"), { ref: fed, kind: "document", capturedAt: AT }).candidate;
    expect(c).toMatchObject({ adapter: "wayback", licence: "pd-us-federal", item_url: "https://www.whitehouse.gov/releases/x/", media_url: "https://web.archive.org/web/20261106220000id_/https://www.whitehouse.gov/releases/x/", date: "2026-11-06" });
    expect(c.basis).toMatch(/date witness only, never its licence/);
  });
});

describe("date windows", () => {
  it("spans dates of every precision", () => {
    expect(dateSpan("1952-06")).toEqual(["1952-06-01", "1952-06-30"]);
    expect(dateSpan("2026")).toEqual(["2026-01-01", "2026-12-31"]);
    expect(dateSpan(null)).toBeNull();
  });
  it("refuses dates outside, too coarse, or missing, unless pinned", () => {
    const w = { from: "2026-11-01", to: "2026-11-08T11:51:04Z" };
    expect(windowProblem("2026-11-02", w)).toBeNull();
    expect(windowProblem("2026-07-20", w)).toMatch(/outside its window/);
    expect(windowProblem("2026", w)).toMatch(/too coarse/);
    expect(windowProblem(null, w)).toMatch(/no date/);
    expect(windowProblem(null, w, { pinned: true })).toBeNull();
    expect(windowProblem("1952-06", { from: "1952-06", to: "1952-11-05T12:00:00-05:00" })).toBeNull();
  });
  it("review: a news picture must be published by the window's end (Komyshuvakha: taken 2 Nov, uploaded 5 Nov)", () => {
    const w = { from: "2026-11-02", to: "2026-11-03T19:39:27.128203+00:00" };
    expect(windowProblem("2026-11-02", w, { publishedAt: "2026-11-05T09:12:00Z", requirePublished: true })).toMatch(/published 2026-11-05T09:12:00Z, after its window ends/);
    expect(windowProblem("2026-11-02", w, { publishedAt: null, requirePublished: true })).toMatch(/no publication time/);
    expect(windowProblem("2026-11-02", w, { publishedAt: "2026-11-03T08:00:00Z", requirePublished: true })).toBeNull();
    // pinned or not, an upload after the horizon fails
    expect(windowProblem("2026-03-25", w, { pinned: true, publishedAt: "2026-11-05T00:00:00Z", requirePublished: true })).toMatch(/after its window ends/);
  });
});

describe("fetcher: drops, sha256 pins and witnesses", () => {
  const tmp = () => mkdtempSync(path.join(os.tmpdir(), "omnibus-e5-"));
  const fedHtml = whPage("<p>Announcement.</p>");
  const http = (sha = "a".repeat(64)) => ({
    getJson: async () => ({ status: "not_found" }),
    getText: async (url: string) => ({ status: "ok", text: url.includes("web.archive.org") ? '<meta property="og:description" content="post" />' : fedHtml, url }),
    getMedia: async (_url: string, dest: string) => {
      writeFileSync(dest, "x");
      return { status: "ok", sha256: sha, sha1: "b".repeat(40), bytes: 1, mime: "text/html", generator_tags: [] };
    },
  });
  const ADAPTERS = { gov, wayback, nara } as any;

  it("records a request no candidate filled with its fallback and every reason", async () => {
    const doc = {
      schema: "omnibus.asset-requests/1",
      issue: 33,
      requests: [{ id: "r1", kind: "document", fallback: { tier: null, text: "no desk item" }, candidates: [], not_fetched: [{ tier: 5, host: "dsns.gov.ua", reason: "outside the allowlist" }] }],
    };
    expect(validateRequests(doc)).toEqual([]);
    const { ledger } = await fetchRequests(doc, emptyLedger(33), { adapters: ADAPTERS, http: http(), mediaDir: tmp(), checkedBy: "t", now: () => new Date(AT) });
    expect(ledger.dropped).toEqual([{ request_id: "r1", kind: "document", fallback_tier: null, fallback: "no desk item", reasons: ["tier 5 dsns.gov.ua: outside the allowlist"] }]);
    expect(validateLedger(ledger)).toEqual([]);
  });

  it("refuses a download whose sha256 differs from the pinned one, and takes it when it matches", async () => {
    const dir = tmp();
    const req = (sha: string) => ({ schema: "omnibus.asset-requests/1", issue: 33, requests: [{ id: "r2", kind: "document", candidates: [{ adapter: "gov", ref: "https://www.whitehouse.gov/x/", tier: 5, pinned: true, sha256: sha }] }] });
    const bad = await fetchRequests(req("c".repeat(64)), emptyLedger(33), { adapters: ADAPTERS, http: http(), mediaDir: dir, checkedBy: "t", now: () => new Date(AT) });
    expect(bad.ledger.items).toEqual([]);
    expect(bad.ledger.rejected[0].reasons.join(" ")).toMatch(/differs from the c+ the request pins/);
    const good = await fetchRequests(req("a".repeat(64)), emptyLedger(33), { adapters: ADAPTERS, http: http(), mediaDir: dir, checkedBy: "t", now: () => new Date(AT) });
    expect(good.ledger.items[0]).toMatchObject({ adapter: "gov", file: "r2.html", licence: "pd-us-federal" });
    expect(validateLedger(good.ledger)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a refused Wayback capture as a hashed date witness, not an item", async () => {
    const doc = { schema: "omnibus.asset-requests/1", issue: 33, requests: [{ id: "r3", kind: "document", fallback: { tier: null, text: "no desk item" }, candidates: [{ adapter: "wayback", ref: "https://web.archive.org/web/20261104155039/https://x.com/a/status/1", tier: 5, pinned: true }] }] };
    const { ledger } = await fetchRequests(doc, emptyLedger(33), { adapters: ADAPTERS, http: http(), mediaDir: tmp(), checkedBy: "t", now: () => new Date(AT) });
    expect(ledger.items).toEqual([]);
    expect(ledger.witnesses).toHaveLength(1);
    expect(ledger.witnesses[0]).toMatchObject({ request_id: "r3", captured_at: "2026-11-04T15:50:39Z", used: false, sha256: "a".repeat(64), file: "r3.20261104155039.witness.html", text: "post" });
    expect(validateLedger(ledger)).toEqual([]);
    expect(lintEpisode({ ledger, ledgerText: "{}", disputesText: null, now: new Date(AT) }).filter((f: { rule: string }) => f.rule !== "disputes-generated")).toEqual([]);
  });
});

describe("resolver", () => {
  it("reads step parameters and fallback tiers", () => {
    expect(stepParams('q="Explorer 1" teletype; media_type=video; year_start=1958')).toEqual({ q: '"Explorer 1" teletype', media_type: "video", year_start: "1958" });
    expect(fallbackTier("tier 4 locator map")).toBe(4);
    expect(fallbackTier("tier 5: typeset page")).toBe(5);
    expect(fallbackTier("the DRAWN typed-paper macro runs")).toBe(4);
    expect(fallbackTier("no desk item; the narrator says only what was printed")).toBeNull();
  });

  it("filters an RSS feed to the window and the title pattern", () => {
    const xml = `<rss><item><title>Names a Chief of Staff</title><link>https://www.whitehouse.gov/a/</link><pubDate>Fri, 06 Nov 2026 21:56:55 +0000</pubDate></item>
<item><title>Chief of Staff later</title><link>https://www.whitehouse.gov/b/</link><pubDate>Mon, 09 Nov 2026 10:00:00 +0000</pubDate></item>
<item><title>Other</title><description>Chief of Staff</description><link>https://www.whitehouse.gov/c/</link><pubDate>Fri, 06 Nov 2026 10:00:00 +0000</pubDate></item></rss>`;
    expect(rssItems(xml, { match: "Chief of Staff", window: { from: "2026-11-06", to: "2026-11-07T17:30:11Z" } }).map((i: { link: string }) => i.link)).toEqual(["https://www.whitehouse.gov/a/"]);
  });

  it("puts a footage request's videos first", () => {
    expect(videoFirst([{ ref: "File:a.webp" }, { ref: "File:b.webm" }]).map((c: { ref: string }) => c.ref)).toEqual(["File:b.webm", "File:a.webp"]);
  });

  it("refuses pins that name a host the fetcher may not reach", () => {
    expect(pinProblems({ x: [{ ref: "https://dsns.gov.ua/a" }] })[0]).toMatch(/dsns\.gov\.ua/);
    expect(pinProblems({ x: [{ ref: "https://www.whitehouse.gov/a" }] })).toEqual([]);
  });

  it("resolves pinned names, searches, pins, exclusions and unfetchable steps", async () => {
    const rundown = {
      issue: 33,
      asset_requests: [
        {
          id: "a1",
          kind: "still",
          for: "echo",
          purpose: "p",
          fallback: "tier 4 locator map",
          ladder: [
            { tier: 2, adapter: "commons", host: "commons.wikimedia.org", query: "kefauver", window: { from: "1952-01-01", to: "1952-03-11" } },
            { tier: 3, adapter: "commons", host: "commons.wikimedia.org", ref: "File:Pinned.jpg", window: { from: "1952-01-01", to: "1952-03-11" } },
            { tier: 3, adapter: "gov-federal (allowlist extension, E5)", host: "catalog.archives.gov", query: "NAID 1" },
            { tier: 4, adapter: "e6-graphics", host: "naturalearthdata.com", query: "map" },
            { tier: 5, adapter: null, host: "dsns.gov.ua", query: "report" },
          ],
        },
      ],
    };
    const pins = { a1: [{ tier: 3, adapter: "nara", ref: "1" }, { tier: 2, exclude: "File:Bad.jpg", why: "a magazine page" }] };
    const http = { getJson: async () => ({ status: "ok", json: { query: { search: [{ title: "File:Good.jpg" }, { title: "File:Bad.jpg" }] } } }), getText: async () => ({ status: "not_found" }) };
    const doc = await resolveRequests(rundown, { pins, http });
    expect(validateRequests(doc)).toEqual([]);
    const r = doc.requests[0];
    expect(r.candidates.map((c: { adapter: string; ref: string; pinned?: boolean }) => `${c.adapter}:${c.ref}${c.pinned ? ":pin" : ""}`)).toEqual(["commons:File:Good.jpg", "commons:File:Pinned.jpg:pin", "nara:1:pin"]);
    expect(r.fallback).toEqual({ tier: 4, text: "tier 4 locator map" });
    expect(r.not_fetched.map((n: { reason: string }) => n.reason).join(" | ")).toMatch(/drawn by E6.*\| dsns\.gov\.ua is outside.*\| excluded on review: File:Bad\.jpg: a magazine page/);
  });
});

describe("coverage page", () => {
  it("escapes every cell, attributes included, and says what was satisfied and dropped", () => {
    expect(cell(`a|b ${XSS}\nc`)).toBe("a\\|b \"&gt;&lt;img src=x onerror=alert(1)&gt; c");
    const assets = {
      requests: [
        { id: "r1", kind: "footage", for: "title", fallback: { tier: 4, text: "drawn" }, candidates: [] },
        { id: "r2", kind: "still", for: "week-day-1", fallback: { tier: 4, text: XSS }, candidates: [] },
      ],
    };
    const ledger = {
      issue: 33,
      items: [{ request_id: "r1", id: "r1", kind: "footage", title: XSS, adapter: "commons", source_tier: 2, licence: "pd-us-federal", file: "r1.webm" }],
      dropped: [{ request_id: "r2", kind: "still", fallback_tier: 4, fallback: XSS, reasons: [XSS] }],
      witnesses: [{ request_id: "r3", original_url: "https://x.com/a", captured_at: "2026-11-04T15:50:39Z", capture_url: "https://web.archive.org/web/20261104155039/https://x.com/a", text: XSS, used: false, sha256: "a".repeat(64), file: "w.html" }],
    };
    const md = buildCoverage({ assets, ledger, durations: { "r1.webm": 7.2 }, mediaDir: "D:/m/33" });
    expect(md).not.toContain("<img");
    expect(md).toMatch(/2 requests: 1 satisfied \(tier 2 1\), 1 dropped to their fallback \(tier 4 1\)/);
    expect(md).toMatch(/\| Title \| 1 \| 1 \| 1 \| 0 \| 7\.2 s \|/);
    expect(md).toMatch(/Thin pictures .*The Week \(0 of 1\)/);
    expect(md).toMatch(/captured 2026-11-04T15:50:39Z, sha256 a{64}/);
  });
});
