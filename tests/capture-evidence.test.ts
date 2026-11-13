// C4: fetch-time evidence for captured items (page and governing terms by sha256, the source's own times, the
// adapter's verdict), the lint that refuses media without it, and the DVIDS key never reaching stored evidence.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { captureEvidence, lintIndex, lintMedia, NASA_TERMS, readBlob, sha256, SOURCES, verdictOf } from "../scripts/capture/evidence.mjs";
import { isAllowedUrl } from "../scripts/lib/rights/http.mjs";

const text = (n: string) => readFileSync(new URL(`./fixtures/rights/${n}`, import.meta.url), "utf8");
const json = (n: string) => JSON.parse(text(n)).response;
const NOW = () => new Date("2026-11-06T21:41:00Z");
const KEY = "dvids-K3Y-never-stored-7f3a";

type Answer = { status: string; text?: string; json?: unknown; url?: string; contentType?: string };
function fakeHttp(routes: Record<string, () => Answer>) {
  const asked: string[] = [];
  const answer = (url: string) => {
    asked.push(url);
    for (const [prefix, fn] of Object.entries(routes)) if (url.startsWith(prefix)) return { url, ...fn() };
    return { status: "not_found" };
  };
  return { asked, getText: async (url: string) => answer(url), getJson: async (url: string) => answer(url) };
}

const dvidsItem = {
  source: "dvids",
  id: "video:1028785",
  url: "https://www.dvidshub.net/video/1028785",
  title: "Hegseth",
  published_at: "2026-11-05T20:09:54Z",
  captured_at: "2026-11-05T21:41:00Z",
  event_date: "2026-11-05",
};

describe("capture evidence", () => {
  it("every declared page and terms address is one the fetcher may contact", () => {
    for (const [name, s] of Object.entries(SOURCES)) {
      if (s.terms) expect(isAllowedUrl(s.terms), name).toBe(true);
      else expect((s as { terms_missing?: string }).terms_missing, name).toBeTruthy();
    }
    expect(isAllowedUrl(SOURCES.dvids.page(dvidsItem))).toBe(true);
  });

  it("stores the page and the terms by sha256, the source's times, and the adapter's verdict", async () => {
    const page = text("dvids-page-video-1028785.html");
    const terms = "<html><body><h1>Copyright</h1><p>All media on the site is produced by U.S. DoD or Federal Agency and is in the public domain unless other copyright status is indicated.</p></body></html>";
    const http = fakeHttp({
      "https://api.dvidshub.net/": () => ({ status: "ok", json: json("dvids-asset-video-1028785.json") }),
      "https://www.dvidshub.net/video/1028785": () => ({ status: "ok", text: page, contentType: "text/html" }),
      "https://www.dvidshub.net/about/copyright": () => ({ status: "ok", text: terms }),
    });
    const { record, blobs } = await captureEvidence(dvidsItem, { http, env: { DVIDS_API_KEY: KEY }, now: NOW });
    expect(record.schema).toBe("omnibus.capture-evidence/1");
    expect(record.page.sha256).toBe(sha256(Buffer.from(page)));
    expect(record.terms.sha256).toBe(sha256(Buffer.from(terms)));
    expect(record.terms.url).toBe("https://www.dvidshub.net/about/copyright");
    expect(record.captured_at).toBe("2026-11-06T21:41:00Z");
    expect(record.published_at).toBe("2026-11-05T20:09:54Z");
    expect(record.source_time).toBe("2026-11-05");
    expect(record.verdict.adapter).toBe("dvids");
    expect(record.verdict.status).toBe("ok");
    expect(record.verdict.licence).toBe("pd-us-federal");
    expect(record.verdict.basis).toBeTruthy();
    expect(blobs.map((b) => b.kind).sort()).toEqual(["page", "terms"]);
    for (const b of blobs) expect(sha256(Buffer.from(readBlob(b.gz)))).toBe(b.sha256);
    // The page read for evidence is the public page, never the API address.
    expect(http.asked.filter((u) => u.startsWith("https://api.dvidshub.net/")).every((u) => !blobs.some((b) => b.url === u))).toBe(true);
  });

  it("the DVIDS key never appears in stored evidence, even when an answer echoes it", async () => {
    const asset = structuredClone(json("dvids-asset-video-1028785.json"));
    asset.results.hls_url = `https://api.dvidshub.net/hls?api_key=${KEY}`;
    asset.results.description = `${asset.results.description} key=${KEY}`;
    const http = fakeHttp({
      "https://api.dvidshub.net/": () => ({ status: "ok", json: asset }),
      "https://www.dvidshub.net/video/1028785": () => ({ status: "ok", text: `${text("dvids-page-video-1028785.html")}<script>var k="${KEY}";var e="${encodeURIComponent(KEY)}"</script>` }),
      "https://www.dvidshub.net/about/copyright": () => ({ status: "ok", text: `<p>terms ${KEY}</p>` }),
    });
    const { record, blobs } = await captureEvidence(dvidsItem, { http, env: { DVIDS_API_KEY: KEY }, now: NOW });
    // The key did go into the API request, and nowhere stored.
    expect(http.asked.some((u) => u.includes(KEY))).toBe(true);
    const stored = [JSON.stringify(record), ...blobs.map((b) => readBlob(b.gz)), ...blobs.map((b) => b.url)].join("\n");
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain(encodeURIComponent(KEY));
    // An error that carries the key is scrubbed too.
    const failing = { ...http, getJson: async () => { throw new Error(`https://api.dvidshub.net/asset?api_key=${KEY} answered 500`); } };
    const f = await captureEvidence(dvidsItem, { http: failing, env: { DVIDS_API_KEY: KEY }, now: NOW });
    expect(f.record.verdict.status).toBe("error");
    expect(JSON.stringify(f.record)).not.toContain(KEY);
  });

  it("dedupes an identical terms page across items and fetches it once a run", async () => {
    const http = fakeHttp({
      "https://www.voanews.com/a/8218325.html": () => ({ status: "ok", text: text("voa-page-8218325.html") }),
      "https://www.voanews.com/p/5338.html": () => ({ status: "ok", text: text("voa-terms-5338.html") }),
    });
    const termsCache = new Map();
    const item = { source: "voa", id: "https://www.voanews.com/a/8218325.html", url: "https://www.voanews.com/a/8218325.html", published_at: "2026-11-04T10:00:00Z", captured_at: "2026-11-04T13:11:00Z" };
    const a = await captureEvidence(item, { http, env: {}, now: NOW, termsCache });
    const b = await captureEvidence({ ...item, id: `${item.id}#2` }, { http, env: {}, now: NOW, termsCache });
    expect(a.record.terms.sha256).toBe(b.record.terms.sha256);
    // The adapter reads the terms page itself; the evidence step adds at most one read of it a run.
    expect(http.asked.filter((u) => u === "https://www.voanews.com/p/5338.html").length).toBeLessThanOrEqual(3);
    expect(a.record.verdict.adapter).toBe("voa");
  });

  it("keeps a White House item as a locator with its page, and states a missing terms page", async () => {
    const http = fakeHttp({ "https://www.whitehouse.gov/": () => ({ status: "ok", text: "<html>remarks</html>" }) });
    const { record } = await captureEvidence(
      { source: "whitehouse", id: "https://www.whitehouse.gov/videos/x/", url: "https://www.whitehouse.gov/videos/x/", published_at: "2026-11-04T21:00:00Z", captured_at: "x" },
      { http, env: {}, now: NOW },
    );
    expect(record.verdict.status).toBe("locator");
    expect(record.page.sha256).toMatch(/^[0-9a-f]{64}$/);
    // NASA's media usage guidelines (www.nasa.gov, allowlisted in C6) are its governing terms page.
    const nasaItem = { source: "nasa", id: "art002e000192", url: "https://images.nasa.gov/details/art002e000192", published_at: "2026-11-04T00:00:00Z" };
    const nasa = await captureEvidence(nasaItem, { http: fakeHttp({ [NASA_TERMS]: () => ({ status: "ok", text: "<html>NASA content is generally not subject to copyright</html>" }) }), env: {}, now: NOW });
    expect(nasa.record.terms).toMatchObject({ url: NASA_TERMS, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const unread = await captureEvidence(nasaItem, { http: fakeHttp({}), env: {}, now: NOW });
    expect(unread.record.terms.sha256).toBeNull();
  });

  it("verdictOf takes the adapter's candidate through checkCandidate, never its own rules", () => {
    const v = verdictOf({ status: "ok", candidate: { adapter: "commons", licence: null, licence_raw: "All rights reserved", title: "x" } }, "commons");
    expect(v.status).toBe("refused");
    expect(v.reasons.join()).toMatch(/not on the allowlist/);
    expect(verdictOf({ status: "skipped", reason: "no key" }, "dvids")).toMatchObject({ status: "skipped", reasons: ["no key"] });
  });
});

describe("lint: no captured media without evidence", () => {
  const sha = "a".repeat(64);
  const good = {
    source: "dvids",
    id: "video:1",
    media: { sha256: "b".repeat(64), ext: "mp4", bytes: 10 },
    evidence: { page: { sha256: sha }, terms: { sha256: sha }, captured_at: "2026-11-06T21:41:00Z", published_at: "2026-11-06T15:11:07Z", verdict: { status: "ok" } },
  };

  it("passes complete evidence and metadata-only entries", () => {
    expect(lintMedia(good)).toEqual([]);
    expect(lintMedia({ ...good, media: null, evidence: {} })).toEqual([]);
  });

  it("refuses media lacking page evidence, terms, times or an ok verdict", () => {
    const cases: [string, object, RegExp][] = [
      ["page", { page: { sha256: null, missing: "403" } }, /page evidence/],
      ["terms", { terms: {} }, /terms page/],
      ["captured_at", { captured_at: null }, /captured_at/],
      ["published_at", { published_at: undefined }, /published_at/],
      ["verdict", { verdict: { status: "refused" } }, /verdict/],
    ];
    for (const [name, patch, re] of cases) {
      const e = { ...good, evidence: { ...good.evidence, ...patch } };
      expect(lintMedia(e).join(), name).toMatch(re);
    }
    expect(lintIndex({ items: { a: good, b: { ...good, evidence: {} } } }).length).toBeGreaterThanOrEqual(4);
  });
});
