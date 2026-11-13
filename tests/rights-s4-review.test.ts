// S4 review fixes (reviewer BLOCK, 2026-11-13): the reviewer's probe cases,
// each a failing test before its fix. One describe block per finding.
import { describe, expect, it } from "vitest";
import { ALLOWED_IDS, CTA_MARK, EDITORIAL_USE, REVIEWED_TERMS_PAGES, airedSpan, deniedBy, editorialTermsProblems, isVideo, licenceProblems, marksProblems, needsMarksCheck, uncoveredWindows, unseenShots, youtubeOrigin } from "../scripts/lib/rights/licences.mjs";
import { youtubeSource } from "../scripts/lib/rights/adapters/commons.mjs";
import { readFileSync } from "node:fs";
import { checkCandidate } from "../scripts/lib/rights/provenance.mjs";
import * as nara from "../scripts/lib/rights/adapters/nara.mjs";
import { dignityHit, fetchRequests, namesDay, publishedByEdition, refineDate, titleKey } from "../scripts/lib/rights/fetcher.mjs";
import { validateRequests } from "../scripts/lib/rights/ledger.mjs";
import { resolveRequests } from "../scripts/lib/rights/resolve.mjs";
import { lintLicenceAllowlist, lintPublishedByEdition, publishRefusals } from "../scripts/lib/rights/lints.mjs";
import { declaredVideo, foreignCreditParts, pageVideos, parseVoaPage } from "../scripts/lib/rights/adapters/voa.mjs";

const AT = "2026-11-13T12:00:00Z";
const VOA_TERMS = "<p>All text, audio and video material produced exclusively by the Voice of America is in the public domain.</p>";
const voaPage = (credit: string, extra = "") =>
  `<title>VOA clip</title><p>Voice of America</p><script>{"datePublished":"2026-11-03 10:00:00Z"}</script><span class="credit">Credit: ${credit}</span>${extra}<a href="https://voa-video-ns.akamaized.net/x/a.mp4">mp4</a>`;
const voa = (credit: string, extra = "") => parseVoaPage(voaPage(credit, extra), { pageUrl: "https://www.voanews.com/a/123.html", termsHtml: VOA_TERMS, capturedAt: AT }) as any;

describe("S4 review 2: the denylist names feeds, pools and agencies", () => {
  it("refuses C-SPAN, APTN, AP Archive, AP Newsroom, Ruptly, Storyful, Bloomberg, Xinhua, CCTV, a pool and EPA as a credit", () => {
    for (const c of ["C-SPAN", "Video: C-SPAN", "CSPAN", "APTN", "AP Archive", "AP Newsroom", "AP", "Ruptly", "Storyful", "Bloomberg", "Xinhua", "CCTV", "White House Pool", "EPA", "EPA-EFE", "Jim Lo Scalzo/EPA", "EPA/Shutterstock", "© EPA"]) {
      expect(deniedBy({ credits: [c] }), c).not.toEqual([]);
    }
  });

  it("refuses their hosts", () => {
    for (const u of ["https://www.c-span.org/video/?1", "https://www.aparchive.com/x", "https://newsroom.ap.org/x", "https://www.ruptly.tv/x", "https://storyful.com/x", "https://www.bloomberg.com/x", "https://english.news.cn/x", "https://www.xinhuanet.com/x", "https://tv.cctv.com/x"]) {
      expect(deniedBy({ urls: [u] }), u).not.toEqual([]);
    }
  });

  it("does not refuse the US Environmental Protection Agency, or Bloomberg, CCTV or a pool named as a subject", () => {
    expect(deniedBy({ credits: ["U.S. Environmental Protection Agency"] })).toEqual([]);
    expect(deniedBy({ texts: ["Administrator Lee Zeldin at the EPA headquarters"] })).toEqual([]);
    expect(deniedBy({ texts: ["Michael Bloomberg speaks", "CCTV footage released by police", "the pool at the YMCA"] })).toEqual([]);
  });

  it("a VOA credit is split on / , ; & and 'and': every part must be VOA", () => {
    expect(foreignCreditParts("VOA / C-SPAN")).toEqual(["C-SPAN"]);
    expect(foreignCreditParts("VOA, Ruptly")).toEqual(["Ruptly"]);
    expect(foreignCreditParts("VOA and Reuters")).toEqual(["Reuters"]);
    expect(foreignCreditParts("VOA & CNN")).toEqual(["CNN"]);
    expect(foreignCreditParts("Video: VOA; Voice of America")).toEqual([]);
    for (const c of ["VOA / C-SPAN", "VOA, Ruptly", "VOA / CNN", "VOA and Storyful"]) {
      const r = voa(c);
      expect(r.candidate.licence, c).toBeNull();
      expect(checkCandidate({ ...r.candidate, kind: "footage" }).ok, c).toBe(false);
    }
    expect(voa("VOA").candidate.licence).toBe("pd-us-federal");
  });
});

describe("S4 review 3: editorial-use is closed; a terms page must be on the reviewed list", () => {
  const base = { url: "https://x.org/terms", captured_at: AT, credit_required: "X", restrictions: [] };
  const WORDINGS = [
    "Editorial use is prohibited.",
    "Free for news use. Fees may apply.",
    "News use requires a licence from us.",
    "News outlets: permission is required before use.",
    "For news use; a royalty is payable.",
    "Not for use online. News use welcome.",
    "Free for editorial use. Contact us for permission before broadcast.",
  ];
  it("refuses each of the reviewer's seven wordings", () => {
    for (const t of WORDINGS) expect(editorialTermsProblems({ ...base, captured_text: t }, "X").length, t).toBeGreaterThan(0);
  });
  it("is not on the allowlist, and licenceProblems refuses it whatever its terms", () => {
    expect(ALLOWED_IDS.has(EDITORIAL_USE)).toBe(false);
    expect(REVIEWED_TERMS_PAGES).toEqual([]);
    for (const t of WORDINGS) expect(licenceProblems({ licence: EDITORIAL_USE, basis: "b", credit: "X", terms: { ...base, captured_text: t } }).join(), t).toMatch(/closed/);
  });
});

describe("S4 review 4: NARA's flagged path needs a maker from the explicit agency list", () => {
  const rec = (heading: string, { status = "Restricted - Possibly", year = 1952 as number | null } = {}) => ({
    body: { hits: { hits: [{ _source: { record: { naId: 1, title: "Film", useRestriction: { status, specificUseRestrictions: ["Copyright"] }, creators: [{ heading }], ancestors: [{ levelOfDescription: "recordGroup", recordGroupNumber: 200, title: "Motion Picture Films" }], productionDates: year ? [{ year }] : [], digitalObjects: [] } } }] } },
  });
  const lic = (heading: string, o?: any) => (nara.parseNara(rec(heading, o), { ref: 1, capturedAt: AT }) as any).candidate.licence;
  it("refuses NBC, NETRC, US Steel, National Geographic and the Truman Library as makers", () => {
    for (const h of ["National Broadcasting Company", "National Educational Television and Radio Center", "United States Steel Corporation", "National Geographic Society (1888 - )", "National Archives and Records Administration. Office of Presidential Libraries. Truman Library."]) {
      expect(lic(h), h).toBeNull();
    }
  });
  it("refuses an undated heading and a flagged record with no production year", () => {
    expect(lic("Department of Defense. Department of the Army. Office of the Chief Signal Officer.")).toBeNull();
    expect(lic("Department of Defense. Department of the Army. Office of the Chief Signal Officer. (09/18/1947 - 03/01/1964)", { year: null })).toBeNull();
    expect(lic("Department of Defense. Department of the Army. Office of the Chief Signal Officer. (09/18/1947 - 03/01/1964)")).toBe("pd-us-federal");
    expect(lic("Executive Office of the President. White House Naval Photographic Unit. (1956 - 1961)", { year: 1958 })).toBe("pd-us-federal");
    expect(lic("Executive Office of the President. White House Naval Photographic Unit. (1956 - 1961)")).toBeNull(); // began 1956, after the 1952 film
  });
  it("the Chief Signal Officer's film 22399 still passes", () => {
    const j = JSON.parse(readFileSync(new URL("./fixtures/rights/nara-video-22399.json", import.meta.url), "utf8"));
    expect((nara.parseNara(j, { ref: "22399", capturedAt: AT, kind: "footage" }) as any).candidate.licence).toBe("pd-us-federal");
    expect(nara.flaggedFederalMaker("Department of Defense. Department of the Navy. Naval Photographic Center. (12/01/1959 - ca. 1998)")).toBe(true);
    expect(nara.flaggedFederalMaker("United States Information Agency. (08/01/1953 - 10/01/1999)")).toBe(true);
  });
});

describe("S4 review 6: a date record refines a stated date and names an identifier the source states", () => {
  // The Truman Library's page for 73-3881 (trimmed fixture) names NAID 338959044; Commons's copy names NLT-AVC-PHT-(73)3881.
  const truman = readFileSync(new URL("./fixtures/rights/truman-photo-73-3881.html", import.meta.url), "utf8");
  const rec = (naid: string, local: string) => ({ date: "1952-03-29", record_ids: [naid, local], title: "Truman at the dinner", item_url: `https://catalog.archives.gov/id/${naid}`, evidence: { url: `https://catalog.archives.gov/id/${naid}`, captured_text: `naId: ${naid}` } });
  const commonsCopy = (n: string) => ({ ref: "File:Photograph... - NARA - 2003xx.jpg", title: "Photograph", source_text: `| ARC = 2003xx\n| Variant control numbers = NAIL Control Number: NLT-AVC-PHT-(73)${n}` });

  it("the trimmed Truman fixture is the record block, naming the accession and the NAID", () => {
    expect(truman.length).toBeLessThan(20_000);
    expect(truman).toMatch(/73-3881/);
    expect(truman).toMatch(/338959044/);
  });

  it("refuses a null source date (a record sets nothing)", () => {
    expect(refineDate(null, rec("338959044", "73-3881"), { capturedAt: AT, source: commonsCopy("3881") }).problem).toMatch(/states no date of its own/);
  });

  it("refuses a record whose identifiers the source does not state", () => {
    expect(refineDate("1952", rec("338959044", "73-3881"), { capturedAt: AT, source: commonsCopy("3872") }).problem).toMatch(/not shown to be a record of this item/);
    expect(refineDate("1952", { ...rec("338959044", "73-3881"), record_ids: undefined, ref: "1" }, { capturedAt: AT, source: { title: "1952 photo 1" } }).problem).toMatch(/not shown/);
  });

  it("Truman 73-3881, 73-3872, 73-3883 and 73-3866 still pass", () => {
    for (const [naid, n] of [["338959044", "3881"], ["338959024", "3872"], ["338959048", "3883"], ["338959010", "3866"]]) {
      const r = refineDate("1952", rec(naid, `73-${n}`), { capturedAt: AT, source: commonsCopy(n) });
      expect(r.date, n).toBe("1952-03-29");
    }
    // A page naming the NAID itself (the Truman Library's own) passes on the NAID.
    expect(refineDate("1952", rec("338959044", "73-3881"), { capturedAt: AT, source: { source_text: truman } }).date).toBe("1952-03-29");
  });
});

describe("S4 review 5: ruling A needs the day's own event, evidenced apart from the upload", () => {
  const CUTOFF = "2026-11-08T22:16:50.309638+00:00";
  const DAY5 = { from: "2026-11-06", to: "2026-11-06T19:18:18.407444+00:00" };
  const DAY3 = { from: "2026-11-04", to: "2026-11-04T19:39:06.061256+00:00" };
  const yt = 'category "Uploaded with video2commons"';
  it("names a day in the forms titles use", () => {
    expect(namesDay("President Trump Delivers Remarks, Nov. 4, 2026", "2026-11-04")).toBe("Nov. 4, 2026");
    expect(namesDay("Destructions in Komyshuvakha after Russian attack, 2026-11-02 (001)", "2026-11-02")).toBe("2026-11-02");
    expect(namesDay("on 4 November 2026 at the White House", "2026-11-04")).toBeTruthy();
    expect(namesDay("Nov. 14, 2026", "2026-11-04")).toBeNull();
    expect(namesDay("Secretary of War Pete Hegseth is delivering a stronger military, a safer America", "2026-11-06")).toBeNull();
  });
  it("refuses e33-day5-pic2: its date is the upload day of a YouTube copy and nothing names the day", () => {
    const r = publishedByEdition({ date: "2026-11-06", publishedAt: "2026-11-06T22:53:09Z", window: DAY5, editionCutoff: CUTOFF, event: { shows_days_event: true, texts: ["Secretary of War Pete Hegseth is delivering a stronger military, a safer America"], youtube_source: yt } });
    expect(r?.problem).toMatch(/upload day of a YouTube copy/);
  });
  it("refuses a picture whose fit does not state shows_days_event", () => {
    const r = publishedByEdition({ date: "2026-11-04", publishedAt: "2026-11-04T21:27:34Z", window: DAY3, editionCutoff: CUTOFF, event: { texts: ["President Trump Delivers Remarks, Nov. 4, 2026"] } });
    expect(r?.problem).toMatch(/shows_days_event/);
  });
  it("admits e33-day3-pic2 on its title naming 4 Nov, and records the evidence and the window start", () => {
    const r = publishedByEdition({ date: "2026-11-04", publishedAt: "2026-11-04T21:27:34Z", window: DAY3, editionCutoff: CUTOFF, event: { shows_days_event: true, texts: ["President Trump Delivers Remarks, Nov. 4, 2026"], youtube_source: yt } });
    expect(r?.record).toMatchObject({ event_date: "2026-11-04", day_from: "2026-11-04" });
    expect(r?.record?.event_evidence).toMatch(/Nov\. 4, 2026/);
  });
  it("admits a day dated by the event's own record", () => {
    const r = publishedByEdition({ date: "2026-11-04", publishedAt: "2026-11-05T01:00:00Z", window: DAY3, editionCutoff: CUTOFF, event: { shows_days_event: true, texts: [], record_date: "2026-11-04", record_url: "https://catalog.archives.gov/id/1" } });
    expect(r?.record?.event_evidence).toMatch(/own record/);
  });
  it("the ledger lint refuses a ruling A item without the flag, the evidence, or inside the window", () => {
    const item = (pbe: any, fit: any = { beat: "week-day-3", why: "w", shows_days_event: true }) => ({ id: "x", fit, published_by_edition: { rule: "picture_published_by_edition", event_date: "2026-11-04", published_at: "2026-11-04T21:27:34Z", day_horizon: DAY3.to, edition_cutoff: CUTOFF, dot_label: "d", day_from: "2026-11-04", event_evidence: "title", ...pbe } });
    expect(lintPublishedByEdition({ items: [item({})] } as any)).toEqual([]);
    expect(lintPublishedByEdition({ items: [item({}, { beat: "b", why: "w" })] } as any).map((x: any) => x.message).join()).toMatch(/shows_days_event/);
    expect(lintPublishedByEdition({ items: [item({ event_evidence: undefined })] } as any).map((x: any) => x.message).join()).toMatch(/independent/);
    expect(lintPublishedByEdition({ items: [item({ day_from: "2026-11-05" })] } as any).map((x: any) => x.message).join()).toMatch(/before the day's window/);
  });
});

describe("S4 review 1: on-screen marks", () => {
  const reviewed = { by: "verifier", at: AT, frames: [0, 25, 50], contact_sheet: { path: "sheets/x.jpg", sha256: "a".repeat(64) }, duration_s: 60, cuts: { times: [], threshold: 0.3, method: "ffmpeg select=gt(scene,0.3)", ffmpeg: "ffmpeg version 9.0.1" } };
  it("a VOA item and a YouTube copy need a reviewed marks_checked record", () => {
    expect(marksProblems({ adapter: "voa", kind: "footage" }).join()).toMatch(/VOA item needs a reviewed marks_checked/);
    expect(marksProblems({ adapter: "commons", kind: "footage", youtube_source: 'category "Uploaded with video2commons"' }).join()).toMatch(/YouTube copy/);
    expect(marksProblems({ adapter: "commons", kind: "footage" })).toEqual([]);
    expect(marksProblems({ adapter: "voa", kind: "footage", marks_checked: { marks: [], reviewed } })).toEqual([]);
    expect(marksProblems({ adapter: "voa", kind: "footage", marks_checked: { marks: [], reviewed: { by: "verifier", at: AT } } }).join()).toMatch(/frames must list/);
  });
  it("refuses any item whose marks name a denied party or C-SPAN", () => {
    for (const mk of ["C-SPAN bug, top right", "CNN lower third", "Reuters watermark", "APTN slate", "POOL"]) {
      expect(marksProblems({ adapter: "commons", kind: "footage", marks_checked: { marks: [mk], reviewed } }).join(), mk).toMatch(/denied party/);
    }
    expect(marksProblems({ adapter: "commons", kind: "footage", marks_checked: { marks: ["The White House logo, lower left"], reviewed } })).toEqual([]);
  });
  it("the fetcher refuses a YouTube copy with no marks check, and takes it with one; the lint holds the ledger to it", async () => {
    const cand = (marks?: any) => ({ status: "ok", candidate: { adapter: "commons", ref: "File:Y.webm", kind_hint: "footage", title: "Remarks", item_url: "https://commons.wikimedia.org/wiki/File:Y.webm", media_url: "https://upload.wikimedia.org/y.webm", licence: "pd-us-federal", basis: "PD-USGov", credit: "The White House", evidence: { url: "https://commons.wikimedia.org/wiki/File:Y.webm", captured_text: "Public domain", captured_at: AT }, date: "2026-11-04", published_at: "2026-11-04T10:00:00Z", categories: ["Uploaded with video2commons"], keywords: [], own_work: false, ai_fields_checked: ["title"], youtube_source: 'category "Uploaded with video2commons"' } });
    const doc = (mc?: any) => ({ schema: "omnibus.asset-requests/1", issue: 33, requests: [{ id: "e33-x", kind: "footage", for: "echo", title: "t", fallback: { tier: 4, text: "map" }, candidates: [{ adapter: "commons", ref: "File:Y.webm", tier: 2, ...(mc ? { marks_checked: mc } : {}) }] }] });
    const opts = { adapters: { commons: { lookup: async () => cand() } }, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, now: () => new Date(AT) };
    const no = await fetchRequests(doc(), null, opts);
    expect(JSON.stringify(no.ledger.rejected)).toMatch(/marks_checked/);
    const yes = await fetchRequests(doc({ marks: [], reviewed }), null, opts);
    expect(yes.report[0].outcome).toBe("would take");
    const bad = await fetchRequests(doc({ marks: ["C-SPAN"], reviewed }), null, opts);
    expect(JSON.stringify(bad.ledger.rejected)).toMatch(/C-SPAN/);
    const item = { id: "e33-x", adapter: "commons", kind: "footage", youtube_source: "x", licence: "pd-us-federal", basis: "b", credit: "c", item_url: "https://commons.wikimedia.org/wiki/File:Y.webm", media_url: "https://upload.wikimedia.org/y.webm", licence_evidence: { url: "https://commons.wikimedia.org/wiki/File:Y.webm" } };
    expect(lintLicenceAllowlist({ items: [item] } as any).map((x: any) => x.message).join()).toMatch(/marks_checked/);
    expect(lintLicenceAllowlist({ items: [{ ...item, marks_checked: { marks: [], reviewed } }] } as any)).toEqual([]);
  });
  it("Commons names a YouTube copy by its category or its wikitext", () => {
    expect(youtubeSource(["Videos from YouTube"])).toMatch(/category/);
    expect(youtubeSource([], "{{From YouTube|1=LHT-znOQXkA|2=Remarks}}")).toMatch(/From YouTube/);
    expect(youtubeSource(["PD-USGov"], "")).toBeNull();
  });
});

describe("S4 review, non-blocking", () => {
  it("the dignity list refuses a picture episode-wide by normalised title or sha1", async () => {
    const list = [{ ref: "File:Destructions in Komyshuvakha after Russian attack, 2026-11-02 (000).webm", title_key: titleKey("File:Destructions in Komyshuvakha after Russian attack, 2026-11-02 (000).webm"), sha1: "b9fb7a464751fd83c368826e0b3a4d5c76a73af5", why: "a death on camera (dignity)" }];
    expect(dignityHit({ ref: "File:Destructions_in_Komyshuvakha_after_Russian_attack,_2026-11-02_(000).webm" }, list)).toBeTruthy();
    expect(dignityHit({ ref: "File:Renamed.webm", sha1: "b9fb7a464751fd83c368826e0b3a4d5c76a73af5" }, list)).toBeTruthy();
    expect(dignityHit({ ref: "File:Destructions in Komyshuvakha after Russian attack, 2026-11-02 (001).webm", sha1: "x" }, list)).toBeNull();
    const cand = { status: "ok", candidate: { adapter: "commons", ref: "File:Other name.webm", kind_hint: "footage", title: "Other name", sha1: list[0].sha1, item_url: "https://commons.wikimedia.org/wiki/File:O.webm", media_url: "https://upload.wikimedia.org/o.webm", licence: "cc-by-4.0", basis: "CC BY 4.0", credit: "SES", evidence: { url: "https://commons.wikimedia.org/wiki/File:O.webm", captured_text: "Creative Commons Attribution 4.0", captured_at: AT }, date: "2026-11-02", published_at: "2026-11-02T10:00:00Z", categories: [], keywords: [], own_work: false, ai_fields_checked: ["title"] } };
    const doc = { schema: "omnibus.asset-requests/1", issue: 33, dignity: list, requests: [{ id: "e33-other", kind: "footage", for: "echo", title: "t", fallback: { tier: 4, text: "map" }, candidates: [{ adapter: "commons", ref: "File:Other name.webm", tier: 2 }] }] };
    const r = await fetchRequests(doc, null, { adapters: { commons: { lookup: async () => cand } }, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, now: () => new Date(AT) });
    expect(JSON.stringify(r.ledger.rejected)).toMatch(/dignity list/);
    expect(validateRequests(doc)).toEqual([]);
  });

  it("the episode's dignity list is resolved from every dignity exclude pin", async () => {
    const out = await resolveRequests({ issue: 33, asset_requests: [] }, { pins: { a: [{ adapter: "commons", exclude: "File:X (000).webm", dignity: true, sha1: "b9fb7a464751fd83c368826e0b3a4d5c76a73af5", why: "dignity" }] }, http: {}, env: {} });
    expect(out.dignity).toEqual([{ ref: "File:X (000).webm", title_key: "x 000", sha1: "b9fb7a464751fd83c368826e0b3a4d5c76a73af5", why: "dignity" }]);
  });

  it("VOA takes the video the page declares (og:video or JSON-LD contentUrl), not a related clip", () => {
    const own = "https://voa-video-ns.akamaized.net/p/own_720p.mp4";
    const html = `<meta property="og:video" content="${own}"><a href="https://voa-video-ns.akamaized.net/p/related_1080p.mp4">x</a><a href="https://voa-video-ns.akamaized.net/p/own_1080p.mp4">y</a>`;
    expect(pageVideos(html)[0].url).toBe("https://voa-video-ns.akamaized.net/p/own_1080p.mp4");
    expect(declaredVideo(`<script>{"contentUrl":"${own}"}</script>`)).toBe(own);
    expect(pageVideos(`<a href="https://voa-video-ns.akamaized.net/p/a_240p.mp4">x</a><a href="https://voa-video-ns.akamaized.net/p/a.mp4">y</a>`)[0].url).toMatch(/a\.mp4$/);
  });

  it("a publish to YouTube is refused for an episode carrying a fair-use excerpt", () => {
    expect(publishRefusals({ items: [{ id: "f", licence: "fair-use-excerpt", fair_use: { no_youtube: true } }] }, "youtube")).toHaveLength(1);
    expect(publishRefusals({ items: [{ id: "f", licence: "fair-use-excerpt" }] }, "site")).toEqual([]);
    expect(publishRefusals({ items: [{ id: "p", licence: "pd-us-federal" }] }, "youtube")).toEqual([]);
  });
});

describe("S4 review round 2: who checks marks, which frames, and calls to action", () => {
  const sheet = { path: "sheets/e33-day6-pic.jpg", sha256: "b".repeat(64) };
  const rv = (o: any = {}) => ({ by: "verifier", at: AT, frames: [0, 12, 24, 33], contact_sheet: sheet, cuts: { times: [], threshold: 0.3, method: "ffmpeg select=gt(scene,0.3)", ffmpeg: "ffmpeg version 9.0.1" }, ...o });
  const item = (mc: any, fit: any = { beat: "week-day-6", why: "w", in_s: 0, out_s: 33 }) => ({ adapter: "commons", kind: "footage", youtube_source: "x", fit, marks_checked: mc });
  it("refuses a review by the builder, the sourcer, or no named role", () => {
    for (const by of ["Forge builder (Claude Opus 5.5)", "sourcer", "t", "E10 test", "verifier and builder", ""]) {
      expect(marksProblems(item({ marks: [], reviewed: rv({ by }) })).join(), by).toMatch(/checking role/);
    }
    for (const by of ["verifier", "verifier: Claude Sonnet, contact sheet at 640 px", "CoS", "cos (founder delegation)", "founder"]) {
      expect(marksProblems(item({ marks: [], reviewed: rv({ by }) })), by).toEqual([]);
    }
  });
  it("needs one frame in every 30 s of the aired span (fit in_s..out_s, else the whole file) and a contact sheet", () => {
    expect(airedSpan(item({}))).toEqual([0, 33]);
    expect(uncoveredWindows([10], [0, 33])).toEqual([[16.5, 33]]);
    expect(uncoveredWindows([10, 20], [0, 33])).toEqual([]);
    expect(marksProblems(item({ marks: [], reviewed: rv({ frames: [5] }) })).join()).toMatch(/none in 16.5..33 s/);
    expect(marksProblems(item({ marks: [], reviewed: rv({ frames: undefined, frames_checked: 8 }) })).join()).toMatch(/frames must list/);
    expect(marksProblems(item({ marks: [], reviewed: rv({ contact_sheet: undefined }) })).join()).toMatch(/contact_sheet/);
    expect(marksProblems(item({ marks: [], reviewed: rv({ contact_sheet: { path: "x.jpg", sha256: "nope" } }) })).join()).toMatch(/contact_sheet/);
    const whole = (r: any) => marksProblems(item({ marks: [], reviewed: r }, { beat: "b", why: "w" })).join();
    expect(whole(rv())).toMatch(/duration_s must state/);
    expect(whole(rv({ frames: [0, 14.5, 30], duration_s: 61 }))).toMatch(/none in 40.67..61 s/);
    expect(whole(rv({ frames: [0, 14.5, 30, 45.8, 60], duration_s: 61 }))).toBe("");
  });
  it("refuses a call to action (a QR code, TEXT ... TO 45470) unless a mask covers it", () => {
    const cta = 'The White House lower third throughout: TEXT "POTUS" TO 45470 FOR WHITE HOUSE UPDATES, a QR code and APP.GOV';
    for (const mk of [cta, "QR code, lower right", "Scan this to donate", "text JOIN to 88022"]) {
      expect(CTA_MARK.test(mk), mk).toBe(true);
      expect(marksProblems(item({ marks: [mk], reviewed: rv() })).join(), mk).toMatch(/call to action/);
    }
    expect(marksProblems(item({ marks: ["THE WHITE HOUSE end card (final seconds)"], reviewed: rv() }))).toEqual([]);
    const mask = { covers: [cta], region: { x: 0, y: 0.8, w: 1, h: 0.2 } };
    expect(marksProblems(item({ marks: [cta], reviewed: rv(), mask }))).toEqual([]);
    expect(marksProblems(item({ marks: [cta], reviewed: rv(), mask: { covers: [cta] } })).join()).toMatch(/call to action/);
  });
  it("a YouTube copy is read from |source=, {{YouTube CC-BY}}, the credit, or the ledger's captured Credit line", () => {
    expect(youtubeSource([], "{{Information|source=https://www.youtube.com/watch?v=abc123|author=SES}}")).toMatch(/youtube\.com/);
    expect(youtubeSource([], "|source=https://youtu.be/abc123\n")).toMatch(/youtu\.be/);
    expect(youtubeSource([], "{{YouTube CC-BY|SES}}")).toMatch(/YouTube CC-BY/);
    expect(youtubeSource([], "", ["Росіяни вдарили по школі (on Youtube)"])).toMatch(/on Youtube/);
    expect(youtubeSource([], "", ["YouTube: White House Chief of Staff, Stephen Miller"])).toMatch(/YouTube/);
    expect(youtubeSource([], "{{Information|source=Own work}}", ["State Emergency Service of Ukraine"])).toBeNull();
    // e33-day2-pic as the ledger held it before round 2 (no youtube_source): its captured Credit line names YouTube.
    const day2 = { kind: "footage", adapter: "commons", credit: "State Emergency Service of Ukraine, via Wikimedia Commons", licence_evidence: { captured_text: "LicenseShortName: CC BY 4.0\nArtist: State Emergency Service of Ukraine\nCredit: Росіяни вдарили по школі в селищі Комишуваха Запорізької області: є жертви (оновлено) (on Youtube)" } };
    expect(youtubeOrigin(day2)).toMatch(/on Youtube/);
    expect(needsMarksCheck(day2)).toBe(true);
    const capt = { kind: "footage", adapter: "commons", licence_evidence: { captured_text: "LicenseShortName: CC BY 4.0\nArtist: SES\nCredit: Video title (on Youtube)" } };
    expect(youtubeOrigin(capt)).toMatch(/on Youtube/);
    expect(needsMarksCheck({ ...capt, licence_evidence: { captured_text: "Credit: SES" } })).toBe(false);
  });
  it("NARA: a year-only start makes a later body a custodian, and a custodian never makes a record, restricted or not", () => {
    const rec = (heading: string, status: string, year = 1945) => ({ body: { hits: { hits: [{ _source: { record: { naId: 1, title: "Film", useRestriction: { status, specificUseRestrictions: status === "Unrestricted" ? [] : ["Copyright"] }, creators: [{ heading }], ancestors: [{ levelOfDescription: "recordGroup", recordGroupNumber: 111, title: "Records" }], productionDates: [{ year }], digitalObjects: [] } } }] } } });
    const lic = (h: string, s: string, y?: number) => (nara.parseNara(rec(h, s, y), { ref: 1, capturedAt: AT }) as any).candidate.licence;
    expect(lic("National Archives and Records Administration. Office of Presidential Libraries. Truman Library.", "Unrestricted", 1952)).toBeNull();
    expect(lic("Department of Defense. Department of the Army. Office of the Chief Signal Officer. (1947 - 1964)", "Restricted - Possibly")).toBeNull();
    expect(lic("Department of Defense. Department of the Army. Office of the Chief Signal Officer. (09/18/1947 - 03/01/1964)", "Restricted - Possibly")).toBeNull();
    expect(lic("War Department. Office of the Chief Signal Officer. (1860 - 09/18/1947)", "Restricted - Possibly")).toBe("pd-us-federal");
    expect(nara.custodianOnly("Department of the Army. (1947 - 1964)", 1945)).toBe(true);
    expect(nara.custodianOnly("Department of the Army. (1947 - 1964)", 1950)).toBe(false);
  });
});

describe("S4 review round 3: a video's marks review covers every shot of the aired span", () => {
  const sheet = { path: "sheets/e33-day6-pic.jpg", sha256: "c".repeat(64) };
  const METHOD = "ffmpeg select=gt(scene,0.3)";
  const rv = (times: any, o: any = {}, c: any = {}) => ({ by: "verifier", at: AT, contact_sheet: sheet, cuts: { times, threshold: 0.3, method: METHOD, ffmpeg: "ffmpeg version 9.0.1", ...c }, ...o });
  const clip = (r: any, fit: any = { beat: "week-day-6", why: "w", in_s: 0, out_s: 33 }) => ({ adapter: "commons", kind: "footage", youtube_source: "x", fit, marks_checked: { marks: [], reviewed: r } });
  // A 33 s montage of 13 shots: 12 cuts.
  const cuts = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30];
  it("refuses a 13-shot montage looked at in 5 frames", () => {
    const msg = marksProblems(clip(rv(cuts, { frames: [0, 1.3, 12, 24.1, 33] }))).join();
    expect(msg).toMatch(/every shot of the aired span 0..33 s \(12 cuts at threshold 0.3\); 9 shot\(s\) unseen: 2.5..5 s/);
  });
  it("passes a montage with a frame in every shot (a frame at a cut is the next shot's first)", () => {
    const frames = [0, ...cuts.map((c) => c + 1)];
    expect(unseenShots(frames, cuts, [0, 33])).toEqual([]);
    expect(marksProblems(clip(rv(cuts, { frames })))).toEqual([]);
    expect(unseenShots([0, 2.5], [2.5], [0, 10])).toEqual([]);
    expect(unseenShots([2.5], [2.5], [0, 10])).toEqual([[0, 2.5]]);
  });
  it("passes the verifier's per-shot record of e33-day6-pic (13 shots, 13 frames)", () => {
    const r = { by: "verifier: claude-sonnet-5", at: "2026-11-13T19:34:09Z", frames: [0.647, 3.608, 7.487, 11.011, 13.764, 15.703, 18.665, 21.376, 23.211, 25.901, 28.696, 30.51, 32.141], cuts: { times: [1.293, 5.923, 9.051, 12.971, 14.556, 16.85, 20.479, 22.272, 24.149, 27.653, 29.738, 31.281], threshold: 0.3, method: METHOD, ffmpeg: "ffmpeg version 9.0.1" }, contact_sheet: sheet, duration_s: 38.021 };
    expect(marksProblems(clip(r))).toEqual([]);
    expect(marksProblems(clip({ ...r, frames: [0, 1.3, 12, 24.1, 33] })).join()).toMatch(/8 shot\(s\) unseen/);
  });
  it("passes a single long shot with a frame every 30 s, and still holds the 30 s floor", () => {
    const whole = { beat: "b", why: "w" };
    expect(marksProblems(clip(rv([], { frames: [0, 30, 60, 90, 120], duration_s: 120 }), whole))).toEqual([]);
    expect(marksProblems(clip(rv([], { frames: [0, 120], duration_s: 120 }), whole)).join()).toMatch(/one frame in every 30 s/);
  });
  it("refuses a video review without cuts, threshold or method; a still needs none", () => {
    const frames = [0, 12, 24, 33];
    expect(marksProblems(clip({ ...rv([], { frames }), cuts: undefined })).join()).toMatch(/cuts must be \{ times, threshold, method \}/);
    expect(marksProblems(clip({ ...rv([], { frames }), cuts: [1.2] })).join()).toMatch(/cuts must be/);
    for (const c of [{ threshold: undefined }, { method: "" }, { times: "none" }, { threshold: 30 }]) {
      expect(marksProblems(clip(rv([], { frames }, c))).join(), JSON.stringify(c)).toMatch(/cuts must be/);
    }
    expect(isVideo({ kind: "still", mime: "video/webm" })).toBe(true);
    const still = { adapter: "voa", kind: "still", marks_checked: { marks: [], reviewed: { by: "verifier", at: AT, frames: [0], contact_sheet: sheet, duration_s: 1 } } };
    expect(marksProblems(still)).toEqual([]);
  });
  it("only cuts inside the aired span divide it", () => {
    expect(unseenShots([5, 20], [1, 10, 40], [3, 30])).toEqual([]);
    expect(unseenShots([5], [1, 10, 40], [3, 30])).toEqual([[10, 30]]);
  });
});
