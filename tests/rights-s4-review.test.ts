// S4 review fixes (reviewer BLOCK, 2026-11-13): the reviewer's probe cases,
// each a failing test before its fix. One describe block per finding.
import { describe, expect, it } from "vitest";
import { deniedBy } from "../scripts/lib/rights/licences.mjs";
import { checkCandidate } from "../scripts/lib/rights/provenance.mjs";
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
