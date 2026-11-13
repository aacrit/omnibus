// E5d: the founder's rights policy of 2026-11-13. VOA's own material is a US
// federal work (agency material stays refused); editorial-use footage enters
// only with its captured terms, credit and restrictions; fair-use excerpts are
// bounded by blocking lints. Fixtures are small recordings (VOA pages trimmed
// to what the adapter reads, NARA records as the catalogue returns them).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as voa from "../scripts/lib/rights/adapters/voa.mjs";
import * as nara from "../scripts/lib/rights/adapters/nara.mjs";
import { isAllowedUrl } from "../scripts/lib/rights/http.mjs";
import { ALLOWED_IDS, EDITORIAL_USE, FAIR_USE, deniedBy, editorialTermsProblems, licenceProblems, licenceTerms, termsTextSha } from "../scripts/lib/rights/licences.mjs";
import { checkCandidate } from "../scripts/lib/rights/provenance.mjs";
import { fetchRequests, ledgerEntry, refineDate, windowProblem } from "../scripts/lib/rights/fetcher.mjs";
import { emptyLedger, validateLedger } from "../scripts/lib/rights/ledger.mjs";
import { lintEpisode, lintFairUse, lintLicenceAllowlist, lintLicenceEvidence, rungSide } from "../scripts/lib/rights/lints.mjs";
import { CANDIDATES_SCHEMA_ID, mergeCandidatePins, resolveRequests } from "../scripts/lib/rights/resolve.mjs";
import { buildCoverage } from "../scripts/lib/rights/coverage.mjs";

const XSS = '"><img src=x onerror=alert(1)>';
const AT = "2026-11-13T12:00:00Z";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "rights");
const text = (n: string) => readFileSync(path.join(DIR, n), "utf8");
const PAGE = text("voa-page-8218325.html");
const TERMS = text("voa-terms-5338.html");
const PAGE_URL = "https://www.voanews.com/a/8218325.html";
const parseVoa = (html = PAGE, terms: string | null = TERMS) => voa.parseVoaPage(html, { pageUrl: PAGE_URL, termsHtml: terms, capturedAt: AT });
const SHA = "a".repeat(64);
const CHECK = { ai_provenance_check: { status: "clear", method: "metadata", checked: ["title"], findings: [], vision: "pending" }, laundering_check: { status: "not_applicable", findings: [] } };

function entry(over: any = {}, request: any = { id: "e33-weight-board-clip-1", kind: "footage", for: "weight-board" }) {
  const c = {
    adapter: "gov",
    title: "A clip",
    licence: "pd-us-federal",
    evidence: { url: "https://www.whitehouse.gov/x", captured_text: "public domain (17 U.S.C. 105)", captured_at: AT },
    basis: "a federal work",
    item_url: "https://www.whitehouse.gov/x",
    media_url: "https://www.whitehouse.gov/x.mp4",
    credit: "The White House",
    date: "2026-11-06",
    published_at: "2026-11-06T22:00:00Z",
    ...over,
  };
  return ledgerEntry({ request, candidate: c, tier: 1, check: CHECK, media: { sha256: SHA, bytes: 10, mime: "video/mp4" }, file: `${request.id}.mp4`, checkedBy: "test", today: "2026-11-13" });
}

const TERMS_OK = {
  url: "https://audiovisual.ec.europa.eu/en/terms",
  captured_text: "Material is provided free of charge for information and news purposes, with the credit EC - Audiovisual Service. It may not be resold.",
  captured_at: AT,
  credit_required: "EC - Audiovisual Service",
  restrictions: ["not for resale"],
};

function clip(id: string, rung: number, counterpart: string, over: any = {}) {
  return entry(
    {
      licence: FAIR_USE,
      adapter: "gov",
      basis: "fair use (17 U.S.C. 107): a short excerpt shown as evidence of the outlet's coverage",
      evidence: { url: "https://www.whitehouse.gov/x", captured_text: "fair use excerpt; outlet page read", captured_at: AT },
      fair_use: {
        beat: "weight-board",
        outlet: `Outlet ${id}`,
        rung,
        source_duration_s: 600,
        in_s: 10,
        out_s: 18,
        audio: "own",
        on_screen_outlet: true,
        no_recut: true,
        no_youtube: true,
        rationale: "Shown beside the board as evidence of how this outlet framed the claim; eight seconds of a ten-minute report, unaltered, its outlet named on screen, no market substitute.",
        counterpart,
        ...over,
      },
    },
    { id, kind: "footage", for: "weight-board" },
  );
}
const ledgerOf = (items: any[]) => ({ ...emptyLedger(33), items });

describe("VOA (founder ruling 2026-11-13): own-crew material is a US federal work", () => {
  it("is no longer a denied host or outlet credit; agencies stay denied", () => {
    expect(deniedBy({ urls: [PAGE_URL], credits: ["Voice of America", "Photo: VOA"] })).toEqual([]);
    for (const c of ["AP Photo/Evan Vucci", "Reuters", "AFP", "Getty Images"]) expect(deniedBy({ credits: [c] }), c).not.toEqual([]);
    expect(isAllowedUrl(PAGE_URL)).toBe(true);
    expect(isAllowedUrl("https://voa-video-ns.akamaized.net/pangeavideo/2026/11/a/a5/x.mp4")).toBe(true);
  });

  it("reads the recorded page: VOA named, no outside credit, the full-size mp4, the publication time, the terms statement", () => {
    const r = parseVoa();
    expect(r.status).toBe("ok");
    const c = r.candidate;
    expect(c).toMatchObject({ adapter: "voa", licence: "pd-us-federal", kind_hint: "footage", published_at: "2026-11-03T17:44:36Z", date: "2026-11-03" });
    expect(c.media_url).toBe("https://voa-video-ns.akamaized.net/pangeavideo/2026/11/a/a5/a593565c-d47e-4060-3e64-08df13be6539.mp4");
    expect(c.evidence.captured_text).toContain(voa.PD_STATEMENT);
    expect(c.credit).toMatch(/^Voice of America/);
    // Until a frame reader exists a VOA item needs a reviewed marks check (S4 review).
    expect(checkCandidate({ ...c, kind: "footage" }).reasons.join()).toMatch(/marks_checked/);
    expect(checkCandidate({ ...c, kind: "footage", marks_checked: { marks: ["VOA lower third"], reviewed: { by: "t", at: AT, frames_checked: 12 } } }).reasons).toEqual([]);
  });

  it("refuses an item crediting an agency, a page without the terms statement, and a page with no file of its own", () => {
    const ap = parseVoa(PAGE.replace("<footer>", "<figcaption>Video: Reuters</figcaption><footer>")).candidate;
    expect(ap.licence).toBeNull();
    expect(ap.licence_note).toMatch(/Reuters/);
    expect(parseVoa(PAGE, null).candidate.licence).toBeNull();
    expect(parseVoa(PAGE.replace(/https:\/\/voa-video-ns\.akamaized\.net/g, "https://cdn.example.com")).candidate.licence_note).toMatch(/no mp4 of its own/);
    expect(voa.parseVoaPage(PAGE, { pageUrl: "https://www.voanews.com/z/599", termsHtml: TERMS, capturedAt: AT }).status).toBe("not_found");
  });

  it("keeps an injected title as text, never markup", () => {
    const c = parseVoa(PAGE.replace(/<title>[\s\S]*?<\/title>/, `<title>${XSS.replace(/</g, "&lt;")}</title>`)).candidate;
    expect(c.title).not.toMatch(/<img/i);
  });
});

describe("editorial-use (founder ruling 2026-11-13; closed by the S4 review)", () => {
  const REVIEWED = [{ url: TERMS_OK.url, text_sha256: termsTextSha(TERMS_OK.captured_text), institution: "European Commission", reviewed: { by: "test", at: AT } }];
  it("is off the allowlist until an adapter fetches the terms page: every editorial-use item is refused", () => {
    expect(ALLOWED_IDS.has(EDITORIAL_USE)).toBe(false);
    const it1 = entry({ licence: EDITORIAL_USE, credit: "EC - Audiovisual Service", basis: "free for news use under the publisher's terms", terms: TERMS_OK, evidence: { url: TERMS_OK.url, captured_text: TERMS_OK.captured_text, captured_at: AT } });
    expect(lintLicenceAllowlist(ledgerOf([it1])).map((x) => x.message).join()).toMatch(/closed/);
    expect(licenceTerms(EDITORIAL_USE, it1).terms).toMatch(/not for resale/);
  });

  it("passes the terms check only for a reviewed terms page with its reviewed text, the required credit and its restrictions", () => {
    expect(editorialTermsProblems(TERMS_OK, "EC - Audiovisual Service", { reviewed: REVIEWED })).toEqual([]);
    expect(editorialTermsProblems(TERMS_OK, "EC - Audiovisual Service").join()).toMatch(/not on the reviewed list/);
    expect(editorialTermsProblems({ ...TERMS_OK, captured_text: "Free for news use." }, "EC - Audiovisual Service", { reviewed: REVIEWED }).join()).toMatch(/differs from the reviewed text/);
    expect(editorialTermsProblems(TERMS_OK, "Someone else", { reviewed: REVIEWED }).join()).toMatch(/required credit/);
    expect(editorialTermsProblems({ ...TERMS_OK, restrictions: undefined }, "EC - Audiovisual Service", { reviewed: REVIEWED }).join()).toMatch(/restrictions/);
    expect(licenceProblems({ licence: EDITORIAL_USE, basis: "x", credit: "x" }).join()).toMatch(/terms record/);
  });
});

describe("fair-use excerpts: the blocking lints", () => {
  const pair = () => [clip("e33-weight-fu-1", 1, "e33-weight-fu-2"), clip("e33-weight-fu-2", 5, "e33-weight-fu-1")];

  it("passes a balanced pair inside every bound, outlets allowed for this class only", () => {
    expect(validateLedger(ledgerOf(pair()))).toEqual([]);
    expect(lintFairUse(ledgerOf(pair()))).toEqual([]);
    expect(deniedBy({ urls: ["https://www.aljazeera.com/video/x"], credits: ["Al Jazeera"], allowOutlets: true })).toEqual([]);
    expect(deniedBy({ urls: ["https://www.aljazeera.com/video/x"], credits: ["Al Jazeera"] })).not.toEqual([]);
    expect(deniedBy({ credits: ["Reuters"], allowOutlets: true })).not.toEqual([]);
    expect(rungSide(3)).toBe("centre");
  });

  it("refuses an agency clip under the fair-use class", () => {
    const [a, b] = pair();
    a.credit = "Reuters";
    expect(lintLicenceAllowlist(ledgerOf([a, b])).some((x) => /Reuters/.test(x.message))).toBe(true);
  });

  const cases: [string, any, RegExp][] = [
    ["outside The Weight", { beat: "week-day-3" }, /only in The Weight/],
    ["over 10 s", { in_s: 0, out_s: 10.5 }, /over 10 s/],
    ["over 2% of its source", { source_duration_s: 300 }, /over 2%/],
    ["the outlet not on screen", { on_screen_outlet: false }, /named on screen/],
    ["muted", { audio: "muted" }, /own sound/],
    ["recut", { no_recut: false }, /recut/],
    ["no rationale", { rationale: "short" }, /rationale/],
    ["not flagged no_youtube", { no_youtube: false }, /YouTube/],
  ];
  for (const [name, over, re] of cases) {
    it(`refuses a clip ${name}`, () => {
      const items = [clip("e33-weight-fu-1", 1, "e33-weight-fu-2", over), clip("e33-weight-fu-2", 5, "e33-weight-fu-1")];
      expect(lintFairUse(ledgerOf(items)).map((x) => x.message).join("\n")).toMatch(re);
    });
  }

  it("refuses an unbalanced set, a counterpart on the same side, more than 4 clips and more than 45 s in all", () => {
    expect(lintFairUse(ledgerOf([clip("a1", 0, "")])).map((x) => x.message).join()).toMatch(/counterpart|unbalanced/);
    expect(lintFairUse(ledgerOf([clip("a1", 0, "a2"), clip("a2", 1, "a1")])).map((x) => x.message).join()).toMatch(/same side/);
    const six = [0, 1, 2].flatMap((i) => [clip(`l${i}`, 1, `r${i}`, { in_s: 0, out_s: 9 }), clip(`r${i}`, 5, `l${i}`, { in_s: 0, out_s: 9 })]);
    const msgs = lintFairUse(ledgerOf(six)).map((x) => x.message).join("\n");
    expect(msgs).toMatch(/over 4 per episode/);
    expect(msgs).toMatch(/over 45 s per episode/);
  });

  it("runs in the episode lint", () => {
    const items = [clip("e33-weight-fu-1", 1, "e33-weight-fu-2", { no_youtube: false }), clip("e33-weight-fu-2", 5, "e33-weight-fu-1")];
    const l = ledgerOf(items);
    expect(lintEpisode({ ledger: l, ledgerText: JSON.stringify(l), disputesText: null, now: new Date("2026-11-14"), shots: [] }).some((x) => x.rule === "fair-use-excerpt")).toBe(true);
  });
});

describe("NARA moving images", () => {
  const json = (n: string) => JSON.parse(text(n));
  it("takes the MP4 for a footage request; NARA's possibly-copyright flag on a Signal Corps film passes only on its proven federal maker", () => {
    // S3 ruling (coordinator, 2026-11-13): the flag is a series caution; the record names the Office of the Chief Signal Officer (1947 to 1964) as maker.
    const r = nara.parseNara(json("nara-video-23327.json"), { ref: "23327", capturedAt: AT, kind: "footage" });
    expect(r.candidate.kind_hint).toBe("footage");
    expect(r.candidate.media_url).toMatch(/\.mp4$/);
    expect(r.candidate.licence).toBe("pd-us-federal");
    expect(r.candidate.basis).toMatch(/Restricted - Possibly \(Copyright\)/);
    expect(r.candidate.evidence.captured_text).toMatch(/Office of the Chief Signal Officer/);
    expect(nara.parseNara(json("nara-video-22399.json"), { ref: "22399", capturedAt: AT, kind: "footage" }).candidate.licence).toBe("pd-us-federal");
  });
  it("keeps the flag standing on a Universal Newsreel item: a donated collection, a commercial newsreel, no federal maker", () => {
    const r = nara.parseNara(json("nara-video-503129862.json"), { ref: "503129862", capturedAt: AT, kind: "footage" });
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/collection, not a federal record group/);
    expect(r.candidate.licence_note).toMatch(/commercial newsreel or studio/);
    expect(r.candidate.licence_note).toMatch(/no federal maker is proven/);
  });
  it("never passes Undetermined, and a Navy film whose named maker began in 1959 is held, not made, by it", () => {
    const r = nara.parseNara(json("nara-video-80338.json"), { ref: "80338", capturedAt: AT, kind: "footage" });
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/"Undetermined", not Unrestricted/);
    expect(r.candidate.licence_note).toMatch(/began after the record was made/);
  });
  it("refuses the flag with another specific restriction beside Copyright", () => {
    const j = json("nara-video-23327.json");
    j.body.hits.hits[0]._source.record.useRestriction.specificUseRestrictions = ["Copyright", "Trademark"];
    expect(nara.parseNara(j, { ref: "23327", capturedAt: AT, kind: "footage" }).candidate.licence).toBeNull();
  });
  it("refuses a library named as creator that began after the film was made: it holds the film, it did not make it", () => {
    const r = nara.parseNara(json("nara-video-353712960.json"), { ref: "353712960", capturedAt: AT, kind: "footage" });
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/began after the record was made/);
    expect(nara.custodianOnly("Dwight D. Eisenhower Library. (07/31/2011 - )", 1952)).toBe(true);
    expect(nara.custodianOnly("Department of the Army. Office of the Chief Signal Officer. (09/18/1947 - 03/01/1964)", 1951)).toBe(false);
  });
});

describe("candidate-pin files from the sourcing passes", () => {
  const ids = new Set(["e33-day6-pic"]);
  const doc = (pins: any, over: any = {}) => ({ name: "commons.json", doc: { schema: CANDIDATES_SCHEMA_ID, issue: 33, source: "commons", pins, ...over } });
  const pin = { tier: 2, adapter: "commons", ref: "File:White House Chief of Staff, Stephen Miller.webm", fit: { beat: "week-day-6", why: "the named chief of staff himself, published the day he was named", in_s: 0, out_s: 33, horizon: "2026-11-07T17:30:11Z" } };

  it("merges after the hand pins, and refuses a pin with no fit, an unknown request, another issue or schema", () => {
    const { pins, problems } = mergeCandidatePins({ "e33-day6-pic": [{ tier: 1, finder: "probe", url: "https://www.whitehouse.gov/" }] }, [doc({ "e33-day6-pic": [pin] })], { issue: 33, requestIds: ids });
    expect(problems).toEqual([]);
    expect(pins["e33-day6-pic"]).toHaveLength(2);
    expect(pins["e33-day6-pic"][1]).toMatchObject({ ref: pin.ref, from_file: "commons.json" });
    expect(mergeCandidatePins({}, [doc({ "e33-day6-pic": [{ ...pin, fit: undefined }] })], { issue: 33, requestIds: ids }).problems.join()).toMatch(/states no fit/);
    expect(mergeCandidatePins({}, [doc({ nope: [pin] })], { issue: 33, requestIds: ids }).problems.join()).toMatch(/not a request/);
    expect(mergeCandidatePins({}, [doc({}, { issue: 34 })], { issue: 33, requestIds: ids }).problems.join()).toMatch(/issue 34/);
    expect(mergeCandidatePins({}, [doc({}, { schema: "x" })], { issue: 33, requestIds: ids }).problems.join()).toMatch(/schema/);
  });

  it("carries the fit through the resolver into the ledger entry", async () => {
    const rundown = { issue: 33, asset_requests: [{ id: "e33-day6-pic", for: "week-day-6", kind: "footage", purpose: "p", ladder: [{ tier: 2, host: "commons.wikimedia.org", adapter: "commons", query: "x", window: { from: "2026-11-06", to: "2026-11-07T17:30:11Z" } }], fallback: "tier 4" }] };
    const http = { getJson: async () => ({ status: "ok", json: { query: { search: [] } } }), getText: async () => ({ status: "not_found" }) };
    const doc1 = await resolveRequests(rundown, { pins: { "e33-day6-pic": [pin] }, http, env: {} });
    const cand = doc1.requests[0].candidates[0];
    expect(cand.fit).toEqual(pin.fit);
    const e = entry({ fit: cand.fit }, { id: "e33-day6-pic", kind: "footage", for: "week-day-6" });
    expect(e.fit).toEqual({ beat: "week-day-6", why: pin.fit.why, in_s: 0, out_s: 33, horizon: "2026-11-07T17:30:11Z" });
    expect(validateLedger(ledgerOf([e]))).toEqual([]);
  });

  it("a pin on an adapter outside the ladder joins at its stated tier, before later tiers, and must state tier and window", async () => {
    const rundown = { issue: 33, asset_requests: [{ id: "e33-echo-req-12", for: "echo-x1", kind: "footage", purpose: "p", ladder: [{ tier: 2, host: "commons.wikimedia.org", adapter: "commons", query: "File:A.webm", window: { from: "1951-01-01", to: "1952-11-05" } }], fallback: "stills" }] };
    const http = { getJson: async () => ({ status: "not_found" }), getText: async () => ({ status: "not_found" }) };
    const nPin = { adapter: "nara", ref: "22399", tier: 1, window: { from: "1951-01-01", to: "1952-11-05T12:00:00-05:00" }, fit: { beat: "echo-x1", why: "refugees, 2 Jan 1951" }, from_file: "echo-film.json" };
    const d = await resolveRequests(rundown, { pins: { "e33-echo-req-12": [nPin] }, http, env: {} });
    expect(d.requests[0].candidates.map((c: any) => `${c.adapter}:${c.tier}`)).toEqual(["nara:1", "commons:2"]);
    expect(d.requests[0].candidates[0]).toMatchObject({ pinned: true, window: nPin.window, fit: nPin.fit });
    await expect(resolveRequests(rundown, { pins: { "e33-echo-req-12": [{ ...nPin, window: undefined }] }, http, env: {} })).rejects.toThrow(/tier and window/);
    // A hand pin (no from_file) on an adapter outside the ladder stays out, as before.
    const hand = await resolveRequests(rundown, { pins: { "e33-echo-req-12": [{ ...nPin, from_file: undefined }] }, http, env: {} });
    expect(hand.requests[0].candidates.map((c: any) => c.adapter)).toEqual(["commons"]);
  });

  it("a date record refines a year to its day, never moves it, and a fit pin keeps no undated exemption", () => {
    const src = { title: "Photograph of the President", source_text: "| Variant control numbers = NAIL Control Number: NLT-AVC-PHT-(73)3881" };
    const rec = { date: "1952-03-29", record_ids: ["338959044", "73-3881"], title: "President and Bess Truman at Jefferson-Jackson Day Dinner", item_url: "https://catalog.archives.gov/id/338959044", evidence: { url: "https://catalog.archives.gov/id/338959044", captured_text: "naId: 338959044" } };
    const ok = refineDate("1952", rec, { capturedAt: AT, source: src });
    expect(ok.date).toBe("1952-03-29");
    expect(ok.evidence.captured_text).toMatch(/production date 1952-03-29/);
    expect(refineDate("1951", rec, { capturedAt: AT, source: src }).problem).toMatch(/outside the source's own date 1951/);
    expect(refineDate("1952", { ...rec, date: "1952" }, { capturedAt: AT, source: src }).problem).toMatch(/no full day/);
    expect(windowProblem(null, { from: "1951-01-01", to: "1952-11-05" }, { pinned: true })).toBeNull();
    expect(windowProblem(null, { from: "1951-01-01", to: "1952-11-05" }, { pinned: false })).toMatch(/no date/);
  });

  it("the fetcher dates a pinned Commons still from its NARA record and refuses an undated fit pin", async () => {
    const still = (date: string | null) => ({ status: "ok", candidate: { adapter: "commons", ref: "File:A.jpg", kind_hint: "still", title: "A", source_text: "NAIL Control Number: NLT-AVC-PHT-(73)3881", item_url: "https://commons.wikimedia.org/wiki/File:A.jpg", media_url: "https://upload.wikimedia.org/a.jpg", licence: "pd-us-federal", basis: "PD US Government (17 U.S.C. 105)", credit: "NARA", evidence: { url: "https://commons.wikimedia.org/wiki/File:A.jpg", captured_text: "public domain, PD US Government", captured_at: AT }, date, published_at: "2011-10-21T10:10:59Z", categories: [], keywords: [], own_work: false, ai_fields_checked: ["title"] } });
    const naraRec = { status: "ok", candidate: { date: "1952-03-29", record_ids: ["338959044", "73-3881"], title: "Dinner", item_url: "https://catalog.archives.gov/id/338959044", evidence: { url: "https://catalog.archives.gov/id/338959044", captured_text: "naId 338959044" } } };
    const adapters = { commons: { lookup: async () => still("1952") }, nara: { lookup: async () => naraRec } };
    const fit = { beat: "echo-x6", why: "the dinner" };
    const req = (cand: any) => ({ schema: "x", issue: 33, requests: [{ id: "e33-echo-01", kind: "still", for: "echo", title: "t", fallback: { tier: 5, text: "typeset" }, candidates: [cand] }] });
    const opts = { adapters, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, now: () => new Date(AT) };
    const window = { from: "1952-03-29", to: "1952-11-05T12:00:00-05:00" };
    const dated = await fetchRequests(req({ adapter: "commons", ref: "File:A.jpg", tier: 3, pinned: true, window, fit, date_record: { adapter: "nara", ref: "338959044" } }), null, opts);
    expect(dated.report[0].outcome).toBe("would take");
    const coarse = await fetchRequests(req({ adapter: "commons", ref: "File:A.jpg", tier: 3, pinned: true, window, fit }), null, opts);
    expect(JSON.stringify(coarse.ledger.rejected)).toMatch(/too coarse/);
    adapters.commons.lookup = async () => still(null);
    const undated = await fetchRequests(req({ adapter: "commons", ref: "File:A.jpg", tier: 3, pinned: true, window, fit }), null, opts);
    expect(JSON.stringify(undated.ledger.rejected)).toMatch(/no date on the item/);
  });

  it("prints each item's fit on the coverage page, escaped", () => {
    const e = entry({ fit: { beat: "week-day-6", why: XSS, in_s: 0, out_s: 33 } }, { id: "e33-day6-pic", kind: "footage", for: "week-day-6" });
    const md = buildCoverage({ assets: { requests: [{ id: "e33-day6-pic", kind: "footage", for: "week-day-6", fallback: { tier: 4, text: "x" } }] }, ledger: ledgerOf([e]), durations: { [e.file]: 38 }, mediaDir: "D:/m/33" });
    expect(md).toMatch(/## Footage fit/);
    expect(md).toMatch(/0\.0 to 33\.0 s/);
    expect(md).not.toContain("<img");
  });
});
