// E5b: void news's own pages (own_property), honest 403 refusals, and DVIDS
// read by its documented fields. Inline fixtures only; no browser, no network.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as voidnews from "../scripts/lib/rights/adapters/voidnews.mjs";
import * as dvids from "../scripts/lib/rights/adapters/dvids.mjs";
import { captureProblems, chooseRegion, editionCheck, editionOf, picturesOnPage, targetBox } from "../scripts/lib/rights/own-pages.mjs";
import { getText, isOwnUrl, isAllowedUrl, refusalKind } from "../scripts/lib/rights/http.mjs";
import { fetchRequests } from "../scripts/lib/rights/fetcher.mjs";
import { emptyLedger, validateLedger } from "../scripts/lib/rights/ledger.mjs";
import { licenceProblems } from "../scripts/lib/rights/licences.mjs";
import { lintEpisode } from "../scripts/lib/rights/lints.mjs";
import { buildDisputePacket, serialisePacket } from "../scripts/lib/rights/disputes.mjs";
import { buildCoverage } from "../scripts/lib/rights/coverage.mjs";
import { pinProblems } from "../scripts/lib/rights/resolve.mjs";

const XSS = '"><img src=x onerror=alert(1)>';
const AT = "2026-11-12T10:00:00Z";
const rows = [
  { id: "r1", pos: 1, title: "Lead Story Here", cluster: "c1", created_at: "2026-11-02T00:59:28.821707+00:00" },
  { id: "r2", pos: 2, title: "Second Story", cluster: "c2", created_at: "2026-11-02T00:59:28.9+00:00" },
  { id: "r3", pos: 3, title: "Third Story", cluster: "c3", created_at: "2026-11-02T00:59:29+00:00" },
];
const h2 = (text: string, y: number) => ({ tag: "h2", cls: "np-article__headline", text, href: null, box: { x: 100, y, w: 800, h: 40 } });
const paperHeads = [{ tag: "h1", cls: "", text: "Paper", href: null, box: { x: 0, y: 10, w: 200, h: 40 } }, h2("Lead Story Here", 200), h2("Second Story", 900), h2("Third Story", 1600)];

function record(over: Record<string, unknown> = {}) {
  return {
    publication: "void news",
    repo: "https://github.com/aacrit/void--news",
    edition: "2026-11-02",
    printed_at: "2026-11-02T00:59:28Z",
    next_edition_at: "2026-11-03T19:39:27Z",
    data_commit: "f".repeat(40),
    deployment: { id: "25edd2e7-0000-0000-0000-000000000000", url: "https://25edd2e7.void-news.pages.dev", created_at: "2026-11-02T01:21:29Z", source_commit: "f".repeat(40), environment: "production" },
    next_edition_from: { commit: "e".repeat(40), edition_is_latest: false },
    no_tour: [],
    page_url: "https://25edd2e7.void-news.pages.dev/paper/",
    page: { width: 1920, height: 2400, color_scheme: "light", title: "Paper | Void News", overlays_hidden: 2 },
    edition_check: { kind: "paper", headlines: 3, matched: 3, in_order: true, first_position: 1 },
    tour_target: { row_id: "r1", position: 1, headline: "Lead Story Here", box: { x: 100, y: 200, w: 800, h: 40 } },
    region: { x: 0, y: 0, w: 1920, h: 2400 },
    pictures_excluded: [],
    ...over,
  };
}

describe("own pages: the edition, the region, the capture record", () => {
  it("reads the next edition from a later record, never from the one the page was built from", () => {
    const built = rows.map((r) => ({ id: r.id, printed_on: "2026-11-02", edition_position: r.pos, title: r.title, source_cluster_id: r.cluster, created_at: r.created_at }));
    const later = [...built, { id: "n1", printed_on: "2026-11-03", edition_position: 1, title: "Next", source_cluster_id: "x", created_at: "2026-11-03T19:39:27.12+00:00" }];
    // The record at the build commit cannot hold a later edition: read alone, it calls this edition the latest.
    expect(editionOf(built, "2026-11-02")).toMatchObject({ next_edition_at: null, edition_is_latest: true });
    expect(editionOf(built, "2026-11-02", later)).toMatchObject({ printed_at: "2026-11-02T00:59:28Z", next_edition_at: "2026-11-03T19:39:27Z", edition_is_latest: false });
    expect(captureProblems(record({ next_edition_at: null })).join()).toMatch(/not the latest/);
    expect(captureProblems(record({ next_edition_at: null, next_edition_from: { commit: "e".repeat(40), edition_is_latest: true } }))).toEqual([]);
    expect(captureProblems(record({ next_edition_from: null })).join()).toMatch(/no later printed-edition record/);
  });

  it("refuses a deployment over an hour late, from another commit, in preview, or at an alias", () => {
    const dep = record().deployment;
    expect(captureProblems(record({ deployment: { ...dep, created_at: "2026-11-02T02:00:00Z" } })).join()).toMatch(/more than an hour/);
    expect(captureProblems(record({ deployment: { ...dep, source_commit: "a".repeat(40) } })).join()).toMatch(/not the edition.s commit/);
    expect(captureProblems(record({ deployment: { ...dep, environment: "preview" } })).join()).toMatch(/not production/);
    const alias = { ...dep, url: "https://main.void-news.pages.dev" };
    expect(captureProblems(record({ deployment: alias, page_url: "https://main.void-news.pages.dev/paper/" })).join()).toMatch(/alias/);
  });

  it("refuses a tour that rests on the Brief", () => {
    expect(captureProblems(record({ no_tour: [{ why: "the Brief", box: { x: 0, y: 150, w: 1920, h: 200 } }] })).join()).toMatch(/no tour may rest/);
    expect(captureProblems(record({ no_tour: [{ why: "the Brief", box: { x: 0, y: 600, w: 1920, h: 200 } }] }))).toEqual([]);
  });

  it("reads an edition from the printed-edition record, with its print time and the next one's", () => {
    const archive = [...rows.map((r) => ({ id: r.id, printed_on: "2026-11-02", edition_position: r.pos, title: r.title, source_cluster_id: r.cluster, created_at: r.created_at })), { id: "n1", printed_on: "2026-11-03", edition_position: 1, title: "Next", source_cluster_id: "x", created_at: "2026-11-03T19:39:27.12+00:00" }];
    const ed = editionOf(archive, "2026-11-02");
    expect(ed).toMatchObject({ printed_at: "2026-11-02T00:59:28Z", next_edition_at: "2026-11-03T19:39:27Z" });
    expect(ed!.rows.map((r: { id: string }) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(editionOf(archive, "2026-11-09")).toBeNull();
  });

  it("passes a Paper page whose headlines are the edition's rows in order, and refuses one out of order or with a stranger", () => {
    expect(editionCheck({ kind: "paper", heads: paperHeads, rows, targetId: "r1" })).toMatchObject({ headlines: 3, matched: 3, in_order: true, problems: [] });
    const swapped = [paperHeads[0], h2("Second Story", 200), h2("Lead Story Here", 900)];
    expect(editionCheck({ kind: "paper", heads: swapped, rows, targetId: "r1" }).problems.join()).toMatch(/order/);
    const stranger = [...paperHeads, h2(XSS, 2000)];
    expect(editionCheck({ kind: "paper", heads: stranger, rows, targetId: "r1" }).problems.join()).toMatch(/not rows of the edition/);
  });

  it("checks a story page's one headline against its target row", () => {
    const heads = [{ tag: "h1", cls: "", text: "Third Story", href: null, box: { x: 0, y: 100, w: 900, h: 60 } }];
    expect(editionCheck({ kind: "story", heads, rows, targetId: "r3" }).problems).toEqual([]);
    expect(editionCheck({ kind: "story", heads, rows, targetId: "r1" }).problems.join()).toMatch(/target row/);
  });

  it("holds a page with no pictures whole, and otherwise the band with the target and no picture", () => {
    const target = targetBox({ kind: "paper", heads: paperHeads, title: "Lead Story Here" });
    expect(chooseRegion({ width: 1920, height: 2400, pictures: [], target })).toEqual({ x: 0, y: 0, w: 1920, h: 2400 });
    const pictures = picturesOnPage([{ tag: "img", src: "/logos/outlet.png", box: { x: 400, y: 1200, w: 16, h: 16 } }, { tag: "img", src: "/hidden.png", box: { x: 0, y: 0, w: 0, h: 0 } }]);
    expect(pictures).toHaveLength(1);
    const region = chooseRegion({ width: 1920, height: 2400, pictures, target });
    expect(region).toEqual({ x: 0, y: 0, w: 1920, h: 1192 });
    // A target beside a picture, in no clear band, gives no region at all.
    expect(chooseRegion({ width: 1920, height: 2400, pictures: picturesOnPage([{ tag: "img", src: "x", box: { x: 1000, y: 210, w: 16, h: 16 } }]), target })).toBeNull();
  });

  it("finds a sound record sound, and names each fault in a bad one", () => {
    expect(captureProblems(record())).toEqual([]);
    expect(captureProblems(record({ deployment: { ...record().deployment, created_at: "2026-11-01T00:00:00Z" } })).join()).toMatch(/before the edition was printed/);
    expect(captureProblems(record({ deployment: { ...record().deployment, created_at: "2026-11-04T00:00:00Z" } })).join()).toMatch(/next edition/);
    expect(captureProblems(record({ pictures_excluded: [{ tag: "img", src: "/logos/x.png", box: { x: 10, y: 10, w: 16, h: 16 } }] })).join()).toMatch(/picture that is not ours/);
    expect(captureProblems(record({ deployment: { ...record().deployment, url: "https://evil.example" }, page_url: "https://evil.example/paper/" })).join()).toMatch(/own hosts/);
    expect(captureProblems(record({ edition_check: { kind: "paper", headlines: 3, matched: 2, in_order: true, first_position: 1 } })).join()).toMatch(/edition's rows/);
    expect(captureProblems(record({ region: { x: 0, y: 0, w: 1920, h: 100 } })).join()).toMatch(/tour target/);
    expect(captureProblems(null)).toEqual(["no capture record"]);
  });

  it("knows void news's own hosts, and keeps them off the fetcher's allowlist", () => {
    expect(isOwnUrl("https://25edd2e7.void-news.pages.dev/paper/")).toBe(true);
    expect(isOwnUrl("https://news.voidvision.org/paper/")).toBe(true);
    expect(isOwnUrl("http://news.voidvision.org/")).toBe(false);
    expect(isOwnUrl("https://void-news.pages.dev.evil.com/")).toBe(false);
    expect(isAllowedUrl("https://25edd2e7.void-news.pages.dev/paper/")).toBe(false);
    expect(pinProblems({ a: [{ adapter: "voidnews", ref: "https://evil.example/paper/#r1", deployment: { url: "https://evil.example" } }] }).join()).toMatch(/own hosts/);
  });

  it("lets only the voidnews adapter claim own-property", () => {
    expect(licenceProblems({ licence: "own-property", basis: "same owner", credit: "void news", adapter: "voidnews" })).toEqual([]);
    expect(licenceProblems({ licence: "own-property", basis: "same owner", credit: "x", adapter: "commons" }).join()).toMatch(/only by void news's own pages/);
  });
});

describe("the voidnews adapter, the fetcher and the lints", () => {
  const capture = (over: Record<string, unknown> = {}) => ({ ref: "https://25edd2e7.void-news.pages.dev/paper/#r1", request_id: "e33-day1-page", file: "e33-day1-page.png", captured_at: AT, own_property: record(), ...over });

  it("turns a capture record into an own-property candidate whose evidence states the basis", () => {
    const c = voidnews.parseCapture(capture(), { capturedAt: AT }).candidate;
    expect(c).toMatchObject({ adapter: "voidnews", licence: "own-property", local_file: "e33-day1-page.png", date: "2026-11-02", published_at: "2026-11-02T01:21:29Z", own_problems: [] });
    expect(c.evidence.captured_text).toMatch(/own property/);
    expect(c.evidence.captured_text).toMatch(/same owner/);
    expect(voidnews.parseCapture({ ref: "x" }, { capturedAt: AT }).status).toBe("not_found");
  });

  it("enters a captured still in the ledger by hashing it in place, and the ledger lints clean", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "e5b-"));
    try {
      writeFileSync(path.join(dir, "e33-day1-page.png"), Buffer.from("PNG still bytes"));
      writeFileSync(path.join(dir, voidnews.MANIFEST), JSON.stringify({ captures: [capture()] }));
      const requests = {
        schema: "omnibus.asset-requests/1",
        issue: 33,
        requests: [{ id: "e33-day1-page", kind: "still", for: "week-day-1", candidates: [{ adapter: "voidnews", ref: capture().ref, tier: 3, pinned: true, window: { from: "2026-11-02", to: "2026-11-02T00:59:28.821707+00:00" } }] }],
      };
      const http = { getMedia: async () => Promise.reject(new Error("an own page is never downloaded")) };
      const { ledger } = await fetchRequests(requests, emptyLedger(33), { adapters: { voidnews }, http, mediaDir: dir, checkedBy: "test", now: () => new Date(AT) });
      expect(ledger.rejected).toEqual([]);
      expect(ledger.items[0]).toMatchObject({ adapter: "voidnews", licence: "own-property", file: "e33-day1-page.png", bytes: 15 });
      expect(validateLedger(ledger)).toEqual([]);
      const text = JSON.stringify(ledger);
      expect(lintEpisode({ ledger, ledgerText: text, disputesText: serialisePacket(buildDisputePacket(ledger, text)), now: new Date(AT) })).toEqual([]);
      // The lint re-reads the capture record: a picture inside the region fails it, whatever was recorded before.
      const bad = structuredClone(ledger);
      bad.items[0].own_property.pictures_excluded = [{ tag: "img", src: "/logos/x.png", box: { x: 0, y: 0, w: 16, h: 16 } }];
      const badText = JSON.stringify(bad);
      expect(lintEpisode({ ledger: bad, ledgerText: badText, disputesText: serialisePacket(buildDisputePacket(bad, badText)), now: new Date(AT) }).map((f) => f.rule)).toContain("licence-allowlist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a capture whose record fails its rules, and a stored file that does not match its hash", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "e5b-"));
    try {
      writeFileSync(path.join(dir, "e33-day1-page.png"), Buffer.from("PNG still bytes"));
      const late = capture({ own_property: record({ deployment: { ...record().deployment, created_at: "2026-11-04T00:00:00Z" } }) });
      const wrongHash = capture({ ref: "b", sha256: "0".repeat(64) });
      writeFileSync(path.join(dir, voidnews.MANIFEST), JSON.stringify({ captures: [late, wrongHash] }));
      const req = (ref: string) => ({ id: "e33-day1-page", kind: "still", for: "week-day-1", candidates: [{ adapter: "voidnews", ref, tier: 3 }] });
      for (const ref of [late.ref, "b"]) {
        const { ledger } = await fetchRequests({ schema: "omnibus.asset-requests/1", issue: 33, requests: [req(ref)] }, emptyLedger(33), { adapters: { voidnews }, http: {}, mediaDir: dir, checkedBy: "t", now: () => new Date(AT) });
        expect(ledger.items).toEqual([]);
        expect(ledger.rejected[0].reasons.join()).toMatch(ref === "b" ? /differs from/ : /next edition/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escapes a hostile headline in the coverage page", () => {
    const c = voidnews.parseCapture(capture({ own_property: record({ tour_target: { ...record().tour_target, headline: XSS } }) }), { capturedAt: AT }).candidate;
    const ledger = { ...emptyLedger(33), items: [{ id: "e33-day1-page", request_id: "e33-day1-page", kind: "still", adapter: "voidnews", title: c.title, licence: "own-property", file: "e33-day1-page.png", source_tier: 3, mime: "image/png" }] };
    const md = buildCoverage({ assets: { requests: [{ id: "e33-day1-page", kind: "still", for: "week-day-1", candidates: [] }] }, ledger, mediaDir: "D:/m" });
    expect(md).not.toMatch(/<img/);
    expect(md).toMatch(/&lt;img/);
  });
});

describe("honest refusals", () => {
  it("names a Cloudflare challenge and an Akamai denial, and never retries a 403", async () => {
    expect(refusalKind("cloudflare", "<title>Just a moment...</title>")).toMatch(/Cloudflare bot challenge/);
    expect(refusalKind("AkamaiGHost", "Access Denied")).toMatch(/Akamai/);
    expect(refusalKind("nginx", "Error 403")).toBe("");
    let calls = 0;
    const seen: Record<string, string>[] = [];
    const fetchImpl = async (_u: string, init: { headers: Record<string, string> }) => {
      calls++;
      seen.push(init.headers);
      return new Response("Access Denied errors.edgesuite.net", { status: 403, headers: { server: "AkamaiGHost" } });
    };
    await expect(getText("https://www.centcom.mil/", { fetchImpl: fetchImpl as never, sleep: async () => {} })).rejects.toThrow(/403 \(Akamai "Access Denied"\).*not retried/);
    expect(calls).toBe(1);
    expect(seen[0]["user-agent"]).toMatch(/^void-omnibus-rights\/1 \(\+https:\/\/omnibus\.voidvision\.org/);
    expect(seen[0]["accept-language"]).toBe("en-US,en;q=0.9");
  });
});

describe("DVIDS by its documented fields (fixtures from api.dvidshub.net/docs, no key)", () => {
  const asset = {
    results: {
      id: "image:366678",
      title: "Tanks",
      description: "A U.S. Marine Corps M1A1 Abrams Tank provides over watch.",
      keywords: "26th MEU, joint operations",
      date_published: "2026-11-03T11:18:00-05:00",
      date: "2026-11-02T00:00:00-05:00",
      unit_name: "26th Marine Expeditionary Unit",
      branch: "Marines",
      image: "https://d34w7g4gy10iej.cloudfront.net/photos/1102/366678.jpg",
      url: "https://www.dvidshub.net/image/366678/tanks",
      credit: [{ id: 1046562, name: "Christopher Matt", rank: "Master Sgt.", url: "https://www.dvidshub.net/portfolio/1046562" }],
    },
  };

  it("passes a DoD record with a named credit on DVIDS's own statement, with its media on DVIDS's documented CDN", () => {
    const c = dvids.parseDvids(asset, { ref: "image:366678", capturedAt: AT }).candidate;
    expect(c).toMatchObject({ licence: "pd-us-federal", credit: "Master Sgt. Christopher Matt, 26th Marine Expeditionary Unit, DVIDS", published_at: "2026-11-03T16:18:00Z", date: "2026-11-02" });
    expect(c.api_evidence.captured_text).toMatch(/public domain unless other copyright status is indicated/);
    expect(isAllowedUrl(c.media_url)).toBe(true);
  });

  it("takes a video's largest mp4", () => {
    const v = { results: { ...asset.results, id: "video:1", image: "https://d34w7g4gy10iej.cloudfront.net/frame.jpg", files: [{ src: "https://d34w7g4gy10iej.cloudfront.net/video/a-486.mp4", type: "video/mp4", height: 274, bitrate: 300 }, { src: "https://d34w7g4gy10iej.cloudfront.net/video/a.mp4", type: "video/mp4", height: 720, bitrate: 9173 }] } };
    expect(dvids.parseDvids({ results: { ...asset.results, branch: "Joint", credit: [{ name: "Jane Roe", rank: "" }] } }, { ref: "image:1", capturedAt: AT }).candidate.licence).toBeNull();
    expect(dvids.parseDvids({ results: { ...asset.results, branch: "Joint" } }, { ref: "image:1", capturedAt: AT }).candidate.licence).toBe("pd-us-federal");
    for (const k of ["copyright", "restrictions", "license"]) expect(dvids.parseDvids({ results: { ...asset.results, [k]: "Public Domain" } }, { ref: "image:1", capturedAt: AT }).candidate.licence, k).toBeNull();
    expect(dvids.parseDvids({ results: { ...asset.results, branch: "Coast Guard" } }, { ref: "image:1", capturedAt: AT }).candidate.basis).toMatch(/US federal government work/);
    expect(dvids.parseDvids(v, { ref: "video:1", capturedAt: AT }).candidate.media_url).toBe("https://d34w7g4gy10iej.cloudfront.net/video/a.mp4");
  });

  it("searches inside the window, keeps hits published by its end, and redacts the key", () => {
    const url = dvids.searchUrl({ q: '"Vice President Vance"', type: "image OR video" }, { from: "2026-10-26", to: "2026-11-04T19:39:06.061256+00:00" }, "sekret");
    expect(url).toMatch(/type%5B%5D=image&type%5B%5D=video/);
    expect(url).toMatch(/to_publishdate=2026-11-04T19%3A39%3A06Z/);
    const hits = dvids.searchHits({ results: [{ id: "image:1", date_published: "2026-11-04T10:00:00Z" }, { id: "image:2", date_published: "2026-11-05T10:00:00Z" }, { id: "news:3", date_published: "2026-11-01T00:00:00Z" }] }, { from: "2026-10-26", to: "2026-11-04T19:39:06Z" });
    expect(hits).toEqual(["image:1"]);
    expect(dvids.redact(url, "sekret")).not.toMatch(/sekret/);
  });
});
