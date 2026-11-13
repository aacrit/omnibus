// S4 review fixes (reviewer BLOCK, 2026-11-13): the reviewer's probe cases,
// each a failing test before its fix. One describe block per finding.
import { describe, expect, it } from "vitest";
import { ALLOWED_IDS, EDITORIAL_USE, REVIEWED_TERMS_PAGES, deniedBy, editorialTermsProblems, licenceProblems } from "../scripts/lib/rights/licences.mjs";
import { readFileSync } from "node:fs";
import { checkCandidate } from "../scripts/lib/rights/provenance.mjs";
import * as nara from "../scripts/lib/rights/adapters/nara.mjs";
import { refineDate } from "../scripts/lib/rights/fetcher.mjs";
import { foreignCreditParts, parseVoaPage } from "../scripts/lib/rights/adapters/voa.mjs";

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
    expect(lic("Executive Office of the President. White House Naval Photographic Unit. (1956 - 1961)")).toBe("pd-us-federal");
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
