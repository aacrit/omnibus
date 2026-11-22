// T5, the rights adapters (show bible v2 sections e and n): kremlin.ru, Ukraine's
// state bodies through Commons, kantei.go.jp, OGL v3, record_kind, the refused
// sources (C-SPAN, Kanal13, VTV), the party label and the transcript class.
// Fixtures are small HTML and JSON recorded on 2026-11-21 (no media); each
// Commons fixture carries the URL it was recorded from, which the adapter's own
// URL builder must produce. Every refusal has a test that it refuses.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as commons from "../scripts/lib/rights/adapters/commons.mjs";
import * as kremlin from "../scripts/lib/rights/adapters/kremlin.mjs";
import * as kantei from "../scripts/lib/rights/adapters/kantei.mjs";
import * as uastate from "../scripts/lib/rights/adapters/uastate.mjs";
import { STATE_TERMS, readTerms } from "../scripts/lib/rights/state-terms.mjs";
import { OGL, OGL_STATEMENT, licenceProblems, readLicence } from "../scripts/lib/rights/licences.mjs";
import { checkCandidate, launderingCheck } from "../scripts/lib/rights/provenance.mjs";
import { hostRefusal, isAllowedUrl } from "../scripts/lib/rights/http.mjs";
import { sourceRefusals } from "../scripts/lib/rights/sources.mjs";
import {
  AGREEMENT_MIN, ledgerTranscriptProblems, ourTranscript, partyLabel, partyLabelProblems, recordKindFromTitle, recordKindProblems,
  recordKindReviewProblems, resolveRecordKind, textSha, transcriptProblems, wordAgreement,
} from "../scripts/lib/rights/records.mjs";
import { applyRecordKind, fetchRequests } from "../scripts/lib/rights/fetcher.mjs";
import { emptyLedger, validateLedger, validateRequests } from "../scripts/lib/rights/ledger.mjs";
import { evidenceMarker, lintLicenceAllowlist, lintLicenceEvidence, lintPartyLabelRecorded, lintRecordKind, lintTranscripts, stateTermsProblems } from "../scripts/lib/rights/lints.mjs";
import { resolveRequests } from "../scripts/lib/rights/resolve.mjs";
import { runTranscript } from "../scripts/rights.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = path.join(root, "tests", "fixtures", "rights");
const AT = "2026-11-21T16:00:00Z";
const now = () => new Date(AT);
const html = (name: string) => readFileSync(path.join(FX, name), "utf8");
type Fixture = { _recorded: { url: string }; response: any };
const fx = (name: string): Fixture => JSON.parse(readFileSync(path.join(FX, `${name}.json`), "utf8"));

/** An http double answering only the URLs the Commons fixtures were recorded from (imageinfo and the file page). */
function commonsHttp(...names: string[]) {
  const byUrl = new Map<string, any>();
  for (const n of names) for (const f of [fx(n), fx(`${n}-wikitext`)]) byUrl.set(f._recorded.url, f.response);
  const asked: string[] = [];
  return {
    asked,
    getJson: async (url: string) => {
      asked.push(url);
      if (!byUrl.has(url)) throw new Error(`no fixture for ${url}`);
      return { status: "ok", json: byUrl.get(url), url };
    },
  };
}
const TITLES: Record<string, string> = {
  "t5-ua-ssu-kerch-photo": "File:KerchBridgeCollapse.jpg",
  "t5-ua-ssu-strike-video": "File:Video 2026-11-17 13-25-19.webm",
  "t5-ua-op-flamingo-x": "File:FlamingoKerch.jpg",
  "t5-ua-kcsa-shelter": "File:Air raid shelter in Kyiv, 2026-11-13.jpg",
  "t5-ua-ses-komyshuvakha-video": "File:Destructions in Komyshuvakha after Russian attack, 2026-11-02 (001).webm",
  "t5-kanal13-shenzhen": "File:Trump, Putin arrive in Shenzhen ahead of landmark summit with Chinese President Xi Jinping.webm",
  "t5-cspan-duckworth": 'File:Sen. Tammy Duckworth (D-IL) Calls Navy Secretary Nominee Hung Cao A "Yes Man".webm',
  "t5-vtv-delcy-hegseth": "File:Presidenta Delcy Rodríguez sostiene reunión con el Secretario de Guerra de EE.UU. Pete Hegseth.webm",
  "t5-ogl-number10": "File:Prime Minister Andy Burnham with Spanish Prime Minister Pedro Sanchez at UNGA.jpg",
};
const viaCommons = (name: string) => commons.lookup(TITLES[name], { http: commonsHttp(name), now });
const viaUa = (name: string) => uastate.lookup(TITLES[name], { http: commonsHttp(name), now });

/** A signed copy of the terms list (the kantei entries are pending the CoS in the real one). */
const SIGNED = STATE_TERMS.map((t) => ({ ...t, reviewed: { by: "cos", at: "2026-11-21", note: "test" } }));

describe("the fixtures match the requests the adapters make", () => {
  it("each Commons fixture was recorded from the adapter's own URL", () => {
    for (const [name, title] of Object.entries(TITLES)) {
      expect(fx(name)._recorded.url, name).toBe(commons.infoUrl(title));
      expect(fx(`${name}-wikitext`)._recorded.url, name).toBe(commons.wikitextUrl(title));
    }
  });
});

describe("reviewed terms pages (state-terms.mjs)", () => {
  it("reads kremlin.ru's terms as reviewed and signed", () => {
    const r = readTerms("kremlin-en", html("t5-kremlin-copyrights-en.html"));
    expect(r.problems).toEqual([]);
    expect(r.text).toContain(kremlin.CC_STATEMENT);
    expect(r.text).toMatch(/RIA Novosti photographs/);
  });

  it("refuses terms whose text changed since the review", () => {
    const changed = html("t5-kremlin-copyrights-en.html").replace("Attribution 4.0 International", "Attribution-NonCommercial 4.0 International");
    expect(readTerms("kremlin-en", changed).problems.join()).toMatch(/differ from the reviewed text/);
  });

  it("refuses a terms page that cannot be read, or whose block is gone", () => {
    expect(readTerms("kremlin-en", null).problems.join()).toMatch(/could not be read/);
    expect(readTerms("kremlin-en", "<html><body>Access denied</body></html>").problems.join()).toMatch(/could not be read/);
  });

  it("refuses terms nobody with a checking role signed: kantei is pending the CoS", () => {
    for (const id of ["kantei-en", "kantei-jp", "pdl-1.0"]) {
      const file = { "kantei-en": "t5-kantei-terms-e.html", "kantei-jp": "t5-kantei-terms-jp.html", "pdl-1.0": "t5-digital-pdl-1.0.html" }[id]!;
      const r = readTerms(id, html(file));
      expect(r.problems.join(), id).toMatch(/not signed by a checking role/);
      expect(readTerms(id, html(file), { terms: SIGNED }).problems, id).toEqual([]);
    }
  });

  it("refuses a builder's or sourcer's signature", () => {
    const t = STATE_TERMS.map((x) => (x.id === "kremlin-en" ? { ...x, reviewed: { by: "builder", at: "2026-11-21" } } : x));
    expect(readTerms("kremlin-en", html("t5-kremlin-copyrights-en.html"), { terms: t }).problems.join()).toMatch(/not signed by a checking role/);
  });
});

describe("the kremlin.ru adapter", () => {
  const terms = html("t5-kremlin-copyrights-en.html");
  const PC = "http://en.kremlin.ru/events/president/news/81305";
  const TRI = "http://en.kremlin.ru/events/president/news/81303";
  const pc = (o: any = {}) => kremlin.parseKremlinPage(html("t5-kremlin-81305-press-conference.html"), { pageUrl: PC, termsHtml: terms, kind: "footage", capturedAt: AT, ...o });
  const tri = (o: any = {}) => kremlin.parseKremlinPage(html("t5-kremlin-81303-trilateral-photos.html"), { pageUrl: TRI, termsHtml: terms, kind: "still", capturedAt: AT, ...o });
  const OWN = "http://static.kremlin.ru/media/events/photos/big/8MkczSdKuqApn1Z3IDqMsZ7yeKL5HwhC.jpg";
  const RIA = "http://static.kremlin.ru/media/events/photos/big/U19U63aPh8B5szj4BVvbSULLmoQS42VU.jpg";

  it("takes the press conference's own high-quality video under CC BY 4.0, a news conference, released by the Kremlin", () => {
    const r: any = pc();
    expect(r.status).toBe("ok");
    const c = r.candidate;
    expect(c).toMatchObject({
      adapter: "kremlin",
      licence: "cc-by-4.0",
      media_url: "http://static.kremlin.ru/media/events/video/en/video_high/VAWWNXlVSaDA3eACazVbthdDV67lWqnG.mp4",
      proxy_url: "http://static.kremlin.ru/media/events/video/en/video_low/1eXUmAvdfR05Y48vMZaczjTAcBh512Fq.mp4",
      date: "2026-11-19",
      published_at: "2026-11-19T23:59:59Z",
      released_by: "the Kremlin",
      party_label: "RELEASED BY THE KREMLIN",
      record_kind: "news_conference",
    });
    expect(c.credit).toMatch(/^Kremlin\.ru .*CC BY 4\.0, http:\/\/en\.kremlin\.ru\/events\/president\/news\/81305$/);
    expect(c.evidence.captured_text).toContain("77eee66a9826923de33cb8f818a3194582a4a7ccc065f417b57345100d6a1fde");
    expect(evidenceMarker("cc-by-4.0").test(c.evidence.captured_text)).toBe(true);
    // A TASS or RIA journalist's question in the transcript is not an agency photograph: the video stands.
    expect(html("t5-kremlin-81305-press-conference.html")).toMatch(/TASS News Agency/);
    expect(checkCandidate({ ...c, kind: "footage" }).reasons).toEqual([]);
  });

  it("refuses footage the page's own player does not list", () => {
    const r: any = pc({ media: "http://static.kremlin.ru/media/events/video/en/video_high/other.mp4" });
    expect(r.candidate.licence).toBeNull();
    expect(checkCandidate({ ...r.candidate, kind: "footage" }).reasons.join()).toMatch(/not one of the page's own video files/);
    const none: any = kremlin.parseKremlinPage(html("t5-kremlin-81303-trilateral-photos.html"), { pageUrl: TRI, termsHtml: terms, kind: "footage", capturedAt: AT });
    expect(none.candidate.licence).toBeNull();
    expect(none.candidate.licence_note).toMatch(/lists no mp4/);
  });

  it("refuses everything when the terms cannot be read or changed", () => {
    for (const termsHtml of [null, terms.replace("Creative Commons Attribution 4.0 International", "all rights reserved")]) {
      const r: any = pc({ termsHtml });
      expect(r.candidate.licence).toBeNull();
      expect(checkCandidate({ ...r.candidate, kind: "footage" }).ok).toBe(false);
    }
  });

  it("takes an uncredited Kremlin photograph from its slide", () => {
    const r: any = tri({ media: OWN });
    expect(r.candidate).toMatchObject({ licence: "cc-by-4.0", media_url: OWN, released_by: "the Kremlin", party_label: "RELEASED BY THE KREMLIN" });
    expect(r.candidate.evidence.captured_text).toMatch(/credit none \(the Kremlin's own\)/);
    expect(r.candidate.record_kind).toBeUndefined();
    expect(checkCandidate({ ...r.candidate, kind: "still" }).reasons).toEqual([]);
  });

  it("refuses a RIA Novosti photograph, which the terms exclude", () => {
    const r: any = tri({ media: RIA });
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/RIA Novosti or TASS photograph/);
    expect(r.candidate.credit_fields).toEqual(["Sergei Bobylev, RIA Novosti"]);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(false);
  });

  it("refuses a TASS photograph and any other credited photograph", () => {
    const page = html("t5-kremlin-81303-trilateral-photos.html");
    const tass = page.replace("Photo: Sergei Bobylev, RIA Novosti", "Photo: Mikhail Metzel, TASS");
    expect((kremlin.parseKremlinPage(tass, { pageUrl: TRI, termsHtml: terms, kind: "still", media: RIA, capturedAt: AT }) as any).candidate.licence_note).toMatch(/RIA Novosti or TASS/);
    const other = page.replace("Photo: Sergei Bobylev, RIA Novosti", "Photo: Jane Roe");
    expect((kremlin.parseKremlinPage(other, { pageUrl: TRI, termsHtml: terms, kind: "still", media: RIA, capturedAt: AT }) as any).candidate.licence_note).toMatch(/photographer outside the Kremlin/);
  });

  it("refuses a still with no named photograph, one off the page, or one off static.kremlin.ru", () => {
    expect((tri() as any).candidate.licence_note).toMatch(/names the photograph it takes/);
    expect((tri({ media: "http://static.kremlin.ru/media/events/photos/big/notonpage.jpg" }) as any).candidate.licence_note).toMatch(/no captioned slide/);
    expect((tri({ media: "https://upload.wikimedia.org/x/8MkczSdKuqApn1Z3IDqMsZ7yeKL5HwhC.jpg" }) as any).candidate.licence_note).toMatch(/not one of the page's photographs/);
  });

  it("is not_found for any page that is not a kremlin.ru event page", () => {
    expect(kremlin.parseKremlinPage("", { pageUrl: "http://en.kremlin.ru/about/copyrights", termsHtml: terms, kind: "footage", capturedAt: AT }).status).toBe("not_found");
    expect(kremlin.parseKremlinPage("", { pageUrl: "http://evil.example/events/president/news/1", termsHtml: terms, kind: "footage", capturedAt: AT }).status).toBe("not_found");
  });

  it("reads the page's official English transcript, translated from Russian", () => {
    const t: any = kremlin.pageTranscript(html("t5-kremlin-81305-press-conference.html"), { pageUrl: PC, id: "tr-putin-pc", itemId: "lead-sot-1", capturedAt: AT });
    expect(t).toMatchObject({ source: "official", lang: "en", translated_from: "ru", url: PC, publisher: kremlin.PUBLISHER });
    expect(t.text).toMatch(/Anastasia Savinykh, TASS News Agency/);
    expect(t.text_sha256).toBe(textSha(t.text));
    expect(transcriptProblems(t, [{ id: "lead-sot-1" }])).toEqual([]);
  });

  it("reaches kremlin.ru over plain http, and no other host", () => {
    expect(hostRefusal("http://static.kremlin.ru/media/events/video/en/video_high/x.mp4")).toBeNull();
    expect(hostRefusal("http://en.kremlin.ru/events/president/news/81305")).toBeNull();
    expect(hostRefusal("https://en.kremlin.ru/events/president/news/81305")).toBeNull();
    expect(hostRefusal("http://www.kremlin.ru/")).toMatch(/https only/);
    expect(hostRefusal("http://commons.wikimedia.org/wiki/File:X.jpg")).toMatch(/https only/);
    expect(hostRefusal("http://kremlin.ru.evil.example/x")).toMatch(/https only/);
    expect(isAllowedUrl("ftp://static.kremlin.ru/x")).toBe(false);
  });

  it("fetches into a ledger item that passes every rights lint, and the lint refuses one whose terms sha is missing", async () => {
    const http = {
      getText: async (u: string) => ({ status: "ok", text: u === kremlin.TERMS_URL ? terms : html("t5-kremlin-81305-press-conference.html") }),
      getMedia: async (_u: string, dest: string) => { writeFileSync(dest, "x"); return { status: "ok", sha256: "a".repeat(64), sha1: "b".repeat(40), bytes: 1, mime: "video/mp4", generator_tags: [] }; },
    };
    const doc = { schema: "omnibus.asset-requests/1", issue: 35, requests: [{ id: "lead-sot-1", kind: "footage", for: "lead", title: "Putin", candidates: [{ adapter: "kremlin", ref: PC, tier: 1 }] }] };
    expect(validateRequests(doc)).toEqual([]);
    const { ledger } = await fetchRequests(doc, emptyLedger(35), { adapters: { kremlin }, http, mediaDir: mkdtempSync(path.join(os.tmpdir(), "omnibus-t5-")), checkedBy: "t", now });
    expect(ledger.rejected).toEqual([]);
    const it0 = ledger.items[0];
    expect(it0).toMatchObject({ adapter: "kremlin", record_kind: "news_conference", record_kind_evidence: { source: "adapter" }, released_by: "the Kremlin", party_label: "RELEASED BY THE KREMLIN" });
    expect(it0.audio).toBeUndefined();
    expect(validateLedger(ledger)).toEqual([]);
    expect([...lintLicenceAllowlist(ledger), ...lintLicenceEvidence(ledger, { now: now() }), ...lintRecordKind(ledger), ...lintPartyLabelRecorded(ledger)]).toEqual([]);
    const stale = { ...ledger, items: [{ ...it0, licence_evidence: { ...it0.licence_evidence, captured_text: it0.licence_evidence.captured_text.replace(/77eee66a\w+/, "(not read)") } }] };
    expect(lintLicenceEvidence(stale, { now: now() }).map((x) => x.message).join()).toMatch(/does not name the reviewed sha256/);
  });
});

describe("Ukraine's state bodies through Commons (uastate)", () => {
  it("takes the SSU's Kerch photograph: CC BY 4.0 on ssu.gov.ua, released by the SSU", async () => {
    const r: any = await viaUa("t5-ua-ssu-kerch-photo");
    const c = r.candidate;
    expect(c).toMatchObject({ adapter: "uastate", licence: "cc-by-4.0", released_by: "the Security Service of Ukraine", party_label: "RELEASED BY THE SECURITY SERVICE OF UKRAINE", adapter_problems: [] });
    expect(c.uploader).toMatchObject({ name: "Lacanic" });
    expect(c.basis).toMatch(/ssu\.gov\.ua/);
    expect(checkCandidate({ ...c, kind: "still" }).reasons).toEqual([]);
  });

  it("takes the Kyiv City State Administration's shelter photograph", async () => {
    const r: any = await viaUa("t5-ua-kcsa-shelter");
    expect(r.candidate).toMatchObject({ released_by: "the Kyiv City State Administration", adapter_problems: [] });
    expect(checkCandidate({ ...r.candidate, kind: "still" }).reasons).toEqual([]);
  });

  it("reads the SSU strike video as the SSU's, and still holds it to the video2commons marks review", async () => {
    const r: any = await viaUa("t5-ua-ssu-strike-video");
    expect(r.candidate.adapter_problems).toEqual([]);
    expect(r.candidate.youtube_source).toMatch(/video2commons/);
    expect(checkCandidate({ ...r.candidate, kind: "footage" }).reasons.join()).toMatch(/marks_checked/);
  });

  it("reads the SES video's own dsns.gov.ua source beside its YouTube copy", async () => {
    const r: any = await viaUa("t5-ua-ses-komyshuvakha-video");
    expect(r.candidate).toMatchObject({ released_by: "the State Emergency Service of Ukraine", adapter_problems: [] });
    expect(checkCandidate({ ...r.candidate, kind: "footage" }).reasons.join()).toMatch(/marks_checked/);
  });

  it("refuses the Office of the President's Flamingo picture, whose source is an X post, not president.gov.ua", async () => {
    const r: any = await viaUa("t5-ua-op-flamingo-x");
    expect(r.candidate.released_by).toBe("the Office of the President of Ukraine");
    expect(r.candidate.adapter_problems.join()).toMatch(/not a page on the Office of the President of Ukraine's own site .*x\.com/);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(false);
  });

  it("refuses a Commons file with no state body's licence template", async () => {
    const r: any = await uastate.lookup(TITLES["t5-ogl-number10"], { http: commonsHttp("t5-ogl-number10"), now });
    expect(r.candidate.adapter_problems.join()).toMatch(/none of the Ukrainian state bodies' licence templates/);
    expect(r.candidate.released_by).toBeNull();
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(false);
  });

  it("refuses a body's template when the licence or the author is not the body's", async () => {
    const base: any = await viaUa("t5-ua-ssu-kerch-photo");
    const raw: any = await viaCommons("t5-ua-ssu-kerch-photo");
    const notCc = uastate.asStateRelease({ status: "ok", candidate: { ...raw.candidate, licence: "cc-by-sa-4.0", licence_raw: "CC BY-SA 4.0" } }) as any;
    expect(notCc.candidate.adapter_problems.join()).toMatch(/not CC BY 4\.0/);
    const author = uastate.asStateRelease({ status: "ok", candidate: { ...raw.candidate, credit_fields: ["Some Blogger"], source_text: raw.candidate.source_text.replace("|author=Security Service Ukraine", "|author=Some Blogger") } }) as any;
    expect(author.candidate.adapter_problems.join()).toMatch(/its author is not the Security Service of Ukraine/);
    expect(base.candidate.adapter_problems).toEqual([]);
  });

  it("the uploader check is mandatory for every Commons transfer", async () => {
    const r: any = await viaUa("t5-ua-ssu-kerch-photo");
    const l = launderingCheck({ ...r.candidate, uploader: null });
    expect(l.status).toBe("suspect");
    expect(l.findings.join()).toMatch(/uploader could not be read/);
    const c: any = await viaCommons("t5-ogl-number10");
    expect(launderingCheck({ ...c.candidate, uploader: { name: "" } }).status).toBe("suspect");
    expect(launderingCheck(c.candidate).status).toBe("clear");
  });
});

describe("refused sources: C-SPAN, Kanal13, VTV", () => {
  it("refuses Kanal13's CC BY Shenzhen arrival video (looks like agency pool)", async () => {
    const r: any = await viaCommons("t5-kanal13-shenzhen");
    expect(r.candidate.licence).toBe("cc-by-4.0");
    const reasons = checkCandidate({ ...r.candidate, kind: "footage" }).reasons.join("\n");
    expect(reasons).toMatch(/refused source Kanal13/);
  });

  it("refuses C-SPAN's committee video that Commons marks PD-CSPAN", async () => {
    const r: any = await viaCommons("t5-cspan-duckworth");
    const reasons = checkCandidate({ ...r.candidate, kind: "footage" }).reasons.join("\n");
    expect(reasons).toMatch(/refused source C-SPAN/);
    expect(reasons).toMatch(/not on the allowlist/);
    expect(r.candidate.licence).toBeNull();
  });

  it("refuses a C-SPAN item even when it claims a floor feed and a federal licence", () => {
    expect(sourceRefusals({ credits: ["C-SPAN"], wikitext: "|description=House floor proceedings, the chamber's own feed" }).join()).toMatch(/refused source C-SPAN/);
    const c = { adapter: "commons", kind: "footage", licence: "pd-us-federal", basis: "floor", credit: "U.S. Senate", credit_fields: ["U.S. Senate"], source_text: "|author=[https://www.youtube.com/@CSPAN U.S. Senate]", categories: [], title: "Floor speech", item_url: "https://commons.wikimedia.org/wiki/File:F.webm", media_url: "https://upload.wikimedia.org/f.webm", evidence: { url: "https://commons.wikimedia.org/wiki/File:F.webm", captured_text: "Public domain", captured_at: AT }, uploader: { name: "U" } };
    expect(checkCandidate(c).reasons.join()).toMatch(/refused source C-SPAN/);
  });

  it("refuses VTV's video that Commons marks public domain, and any foreign state's PD mark", async () => {
    const r: any = await viaCommons("t5-vtv-delcy-hegseth");
    const reasons = checkCandidate({ ...r.candidate, kind: "footage" }).reasons.join("\n");
    expect(reasons).toMatch(/refused source VTV/);
    expect(reasons).toMatch(/foreign state's official-works mark/);
    expect(sourceRefusals({ categories: ["PD-RU-exempt"] }).join()).toMatch(/foreign state's/);
    expect(sourceRefusals({ categories: ["PD-USGov-POTUS", "PD-NASA", "PD-old-70", "PD-self"] })).toEqual([]);
  });

  it("refuses a denied host named only in the file page's |source=", async () => {
    const raw: any = await viaCommons("t5-ogl-number10");
    const c = { ...raw.candidate, source_urls: ["https://www.reuters.com/video/x"], kind: "still" };
    expect(checkCandidate(c).reasons.join()).toMatch(/denied source host www\.reuters\.com/);
  });

  it("the rights lint finds a refused source in a ledger item's stored evidence", () => {
    const item = { id: "x", adapter: "commons", kind: "still", licence: "cc-by-4.0", credit: "Kanal13, via Wikimedia Commons", item_url: "https://commons.wikimedia.org/wiki/File:X.webm", media_url: "https://upload.wikimedia.org/x.webm", licence_evidence: { url: "https://commons.wikimedia.org/wiki/File:X.webm", captured_text: "LicenseShortName: CC BY 4.0\nArtist: Kanal13", captured_at: AT } };
    expect(lintLicenceAllowlist({ items: [item] } as any).map((x) => x.message).join()).toMatch(/refused source Kanal13/);
  });
});

describe("OGL v3", () => {
  it("reads OGL v3 and nothing older", () => {
    for (const s of ["OGL 3", "OGL v3.0", "Open Government Licence v3.0", "Open Government License version 3", "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"]) expect(readLicence(s).id, s).toBe(OGL);
    for (const s of ["OGL 2", "OGL v1.0", "Open Government Licence v2.0", "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/2/"]) expect(readLicence(s).id, s).toBeNull();
  });

  it("takes a Number 10 photograph with the attribution statement in its credit", async () => {
    const r: any = await viaCommons("t5-ogl-number10");
    expect(r.candidate.licence).toBe(OGL);
    expect(r.candidate.credit).toBe(`Number 10, via Wikimedia Commons. ${OGL_STATEMENT}`);
    expect(evidenceMarker(OGL).test(r.candidate.evidence.captured_text)).toBe(true);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).reasons).toEqual([]);
  });

  it("refuses an OGL item whose credit lacks the statement", () => {
    expect(licenceProblems({ licence: OGL, credit: "Number 10" }).join()).toMatch(/attribution statement/);
    expect(licenceProblems({ licence: OGL, credit: `Number 10. ${OGL_STATEMENT}` })).toEqual([]);
  });

  it("refuses what OGL v3 never covers (a crest, the Royal Arms, insignia)", async () => {
    const r: any = await viaCommons("t5-ogl-number10");
    for (const title of ["Royal Arms of the United Kingdom", "Crest of the Home Office", "RAF insignia"]) {
      expect(checkCandidate({ ...r.candidate, title, kind: "still" }).reasons.join(), title).toMatch(/OGL v3 never licenses/);
    }
  });
});

describe("kantei.go.jp", () => {
  const PAGE = "https://japan.kantei.go.jp/105/actions/202611/19apec.html";
  const PIC = "https://japan.kantei.go.jp/contents/topics/32011_ext_8_1.jpg";
  const termsHtml = { en: html("t5-kantei-terms-e.html"), jp: html("t5-kantei-terms-jp.html"), pdl: html("t5-digital-pdl-1.0.html") };
  const parse = (o: any = {}) => kantei.parseKanteiPage(html("t5-kantei-19apec.html"), { pageUrl: PAGE, termsHtml, kind: "still", media: PIC, capturedAt: AT, ...o }) as any;

  it("refuses every kantei item while its terms await the CoS's signature", () => {
    const r = parse();
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/not signed by a checking role/);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(false);
  });

  it("with signed terms, takes the PMO's own picture under PDL1.0's CC BY grant, credited as edited", () => {
    const c = parse({ terms: SIGNED }).candidate;
    expect(c).toMatchObject({ adapter: "kantei", licence: "cc-by-4.0", media_url: PIC, date: "2026-11-19", released_by: "the Prime Minister's Office of Japan", party_label: "RELEASED BY THE PRIME MINISTER'S OFFICE OF JAPAN" });
    expect(c.credit).toBe(`Created by editing "APEC Economic Leaders’ Meeting and Other Events (2)" (Official Website of the Prime Minister's Office of Japan) (${PAGE}), CC BY 4.0 under PDL1.0`);
    expect(c.title).toMatch(/Prime Minister Takaichi being welcomed by President Xi Jinping \(1\)/);
    expect(checkCandidate({ ...c, kind: "still" }).reasons).toEqual([]);
    expect(stateTermsProblems({ adapter: "kantei", licence_evidence: c.evidence }, { terms: SIGNED })).toEqual([]);
    expect(stateTermsProblems({ adapter: "kantei", licence_evidence: c.evidence }).join()).toMatch(/not signed by a checking role/);
  });

  it("refuses a picture whose caption states another party's rights, a logo, or one not on the page", () => {
    const page = html("t5-kantei-19apec.html").replace('alt="Prime Minister Takaichi being welcomed by President Xi Jinping (1)"', 'alt="Prime Minister Takaichi being welcomed (Photo: Kyodo)"');
    expect((kantei.parseKanteiPage(page, { pageUrl: PAGE, termsHtml, kind: "still", media: PIC, capturedAt: AT, terms: SIGNED }) as any).candidate.licence_note).toMatch(/another party's rights/);
    const logo = html("t5-kantei-19apec.html").replace('alt="Prime Minister Takaichi being welcomed by President Xi Jinping (1)"', 'alt="Cabinet logo"');
    expect((kantei.parseKanteiPage(logo, { pageUrl: PAGE, termsHtml, kind: "still", media: PIC, capturedAt: AT, terms: SIGNED }) as any).candidate.licence_note).toMatch(/logo/);
    expect(parse({ terms: SIGNED, media: "https://japan.kantei.go.jp/contents/topics/nothere.jpg" }).candidate.licence_note).toMatch(/not one of the page's own pictures/);
    expect(parse({ terms: SIGNED, media: null }).candidate.licence_note).toMatch(/names the picture it takes/);
  });

  it("refuses footage: kantei's video is YouTube, never taken", () => {
    expect(parse({ terms: SIGNED, kind: "footage", media: null }).candidate.licence_note).toMatch(/no video file of its own/);
  });

  it("refuses when PDL1.0's CC BY grant is gone (the text no longer matches the review)", () => {
    const pdl = termsHtml.pdl.replace("利用者がCC BYに従って利用することを許諾します", "利用を許諾しません");
    expect(parse({ terms: SIGNED, termsHtml: { ...termsHtml, pdl } }).candidate.licence_note).toMatch(/differ from the reviewed text/);
  });
});

describe("record_kind (sot-raw-source on the ledger side)", () => {
  it("reads a record's kind only from an unmistakable title", () => {
    expect(recordKindFromTitle("Press conference following visit to China")?.kind).toBe("news_conference");
    expect(recordKindFromTitle("Remarks by President Trump Before Marine One Departure")?.kind).toBe("remarks");
    expect(recordKindFromTitle("Press Briefing by Press Secretary Karoline Leavitt")?.kind).toBe("briefing");
    expect(recordKindFromTitle("Address to the Nation")?.kind).toBe("address");
    for (const t of ["Meeting with US President Donald Trump", "Vladimir Putin's interview with film director Emir Kusturica", "Trilateral Talks in China", "Addresses Historic Trilateral Meeting"]) expect(recordKindFromTitle(t), t).toBeNull();
  });

  it("takes a review only from a checking role, with a reason", () => {
    expect(recordKindReviewProblems({ kind: "remarks", by: "cos", at: "2026-11-21", why: "the whole public part of the event, one camera, no music" })).toEqual([]);
    for (const by of ["builder", "sourcer", "", "analyst"]) expect(recordKindReviewProblems({ kind: "remarks", by, at: "2026-11-21", why: "the whole public part of the event, one camera" }).join(), by).toMatch(/only a checking role/);
    expect(recordKindReviewProblems({ kind: "speech", by: "cos", at: "2026-11-21", why: "the whole public part of the event, one camera" }).join()).toMatch(/must be one of/);
    expect(recordKindReviewProblems({ kind: "remarks", by: "cos", at: "2026-11-21", why: "ok" }).join()).toMatch(/in a sentence/);
    expect(recordKindReviewProblems(null).join()).toMatch(/signed by a checking role/);
  });

  it("refuses a review that contradicts the source's own record, and defaults to unknown", () => {
    const review = { kind: "remarks", by: "verifier", at: "2026-11-21", why: "the reviewer watched it through, no cutaway or music" };
    expect(resolveRecordKind({ adapterKind: "news_conference", adapterEvidence: "title", review }).problem).toMatch(/contradicts/);
    expect(resolveRecordKind({ adapterKind: null, review })).toMatchObject({ kind: "remarks", evidence: { source: "review", by: "verifier" } });
    expect(resolveRecordKind({})).toMatchObject({ kind: "unknown", evidence: { source: "adapter" } });
  });

  it("mutes footage that may not feed SOT, unless its pin already mutes it", () => {
    const c: any = {};
    expect(applyRecordKind(c, {}, "footage")).toBeNull();
    expect(c).toMatchObject({ record_kind: "unknown", audio: { mode: "muted" } });
    expect(c.audio.reason).toMatch(/sot-raw-source/);
    const pinned: any = { audio: { mode: "muted", reason: "a music bed" } };
    applyRecordKind(pinned, {}, "footage");
    expect(pinned.audio.reason).toBe("a music bed");
    const still: any = {};
    expect(applyRecordKind(still, {}, "still")).toBeNull();
    expect(still.record_kind).toBeUndefined();
    const bad: any = { record_kind: "news_conference", record_kind_note: "title" };
    expect(applyRecordKind(bad, { record_kind: { kind: "promo", by: "cos", at: "2026-11-21", why: "a montage with a music bed, edited" } }, "footage")).toMatch(/contradicts/);
  });

  it("the lint blocks footage with no kind, a produced item that is not muted, and an unsigned review; issue 33 is frozen", () => {
    const base = { id: "a", kind: "footage", adapter: "commons" };
    expect(recordKindProblems(base, { issue: 35 }).join()).toMatch(/states its record_kind/);
    expect(recordKindProblems(base, { issue: 33 })).toEqual([]);
    expect(recordKindProblems({ ...base, record_kind: "produced", record_kind_evidence: { source: "adapter", text: "x" } }, { issue: 35 }).join()).toMatch(/airs muted/);
    expect(recordKindProblems({ ...base, record_kind: "produced", record_kind_evidence: { source: "adapter", text: "x" }, audio: { mode: "muted", reason: "r" } }, { issue: 35 })).toEqual([]);
    expect(recordKindProblems({ ...base, record_kind: "remarks", record_kind_evidence: { source: "review", by: "builder", text: "x" } }, { issue: 35 }).join()).toMatch(/signed by a checking role/);
    expect(recordKindProblems({ ...base, record_kind: "remarks" }, { issue: 35 }).join()).toMatch(/record_kind_evidence/);
    expect(lintRecordKind({ issue: 35, items: [base] } as any)[0]).toMatchObject({ rule: "record-kind", item: "a" });
  });

  it("a pin may carry only a signed review", async () => {
    const rundown = { issue: 35, asset_requests: [{ id: "r1", kind: "footage", for: "lead", purpose: "p", ladder: [{ tier: 1, adapter: "kremlin", host: "en.kremlin.ru" }] }] };
    const good = { adapter: "kremlin", ref: "http://en.kremlin.ru/events/president/news/81303", tier: 1, record_kind: { kind: "remarks", by: "CoS", at: "2026-11-21", why: "the opening remarks of the meeting, unedited, one camera" } };
    const out = await resolveRequests(rundown, { pins: { r1: [good] }, http: {} as any });
    expect(out.requests[0].candidates[0].record_kind).toMatchObject({ kind: "remarks", by: "cos" });
    await expect(resolveRequests(rundown, { pins: { r1: [{ ...good, record_kind: { ...good.record_kind, by: "builder" } }] }, http: {} as any })).rejects.toThrow(/only a checking role/);
    const doc = { schema: "omnibus.asset-requests/1", issue: 35, requests: [{ id: "r1", kind: "footage", candidates: [{ adapter: "kremlin", ref: good.ref, tier: 1, record_kind: { kind: "remarks", by: "sourcer", at: "2026-11-21", why: "x y z a b c" } }] }] };
    expect(validateRequests(doc).join()).toMatch(/only a checking role/);
    const none = await resolveRequests(rundown, { pins: {}, http: {} as any });
    expect(none.requests[0].not_fetched[0].reason).toMatch(/kremlin has no search/);
  });

  it("an unknown kind from the fetcher airs muted and passes the lint", async () => {
    const raw: any = await viaUa("t5-ua-ssu-kerch-photo");
    const cand = { status: "ok", candidate: { ...raw.candidate, media_url: "https://upload.wikimedia.org/v.webm" } };
    const http = { getMedia: async (_u: string, dest: string) => { writeFileSync(dest, "x"); return { status: "ok", sha256: "a".repeat(64), sha1: raw.candidate.sha1, bytes: raw.candidate.bytes_expected, mime: "video/webm", generator_tags: [] }; } };
    const doc = { schema: "omnibus.asset-requests/1", issue: 35, requests: [{ id: "p2-strike", kind: "footage", for: "package", title: "t", candidates: [{ adapter: "uastate", ref: "File:K.webm", tier: 1 }] }] };
    const { ledger } = await fetchRequests(doc, emptyLedger(35), { adapters: { uastate: { lookup: async () => cand } }, http, mediaDir: mkdtempSync(path.join(os.tmpdir(), "omnibus-t5-")), checkedBy: "t", now });
    expect(ledger.rejected).toEqual([]);
    expect(ledger.items[0]).toMatchObject({ adapter: "uastate", record_kind: "unknown", audio: { mode: "muted" }, party_label: "RELEASED BY THE SECURITY SERVICE OF UKRAINE" });
    expect(validateLedger(ledger)).toEqual([]);
    expect([...lintRecordKind(ledger), ...lintPartyLabelRecorded(ledger)]).toEqual([]);
  });
});

describe("the party label", () => {
  it("is RELEASED BY <body> in capitals", () => {
    expect(partyLabel("the Kremlin")).toBe("RELEASED BY THE KREMLIN");
    expect(partyLabel("")).toBeNull();
  });

  it("the lint blocks a state channel's item with no releasing body, and any label that is not the body's", () => {
    expect(partyLabelProblems({ adapter: "kremlin" }).join()).toMatch(/names the body that released it/);
    expect(partyLabelProblems({ adapter: "kremlin", released_by: "the Kremlin", party_label: "RELEASED BY RUSSIA" }).join()).toMatch(/must read "RELEASED BY THE KREMLIN"/);
    expect(partyLabelProblems({ adapter: "gov", released_by: "The White House" }).join()).toMatch(/RELEASED BY THE WHITE HOUSE/);
    expect(partyLabelProblems({ adapter: "commons" })).toEqual([]);
    expect(lintPartyLabelRecorded({ items: [{ id: "k", adapter: "uastate" }] } as any)[0]).toMatchObject({ rule: "party-label-recorded" });
  });
});

describe("the transcript ledger class", () => {
  const items = [{ id: "sot-1", record_kind: "news_conference" }, { id: "promo-1", record_kind: "promo" }];
  const fifty = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
  const ours = (a: string, b: string, o: any = {}) => ({ ...ourTranscript({ id: "tr-1", item_id: "sot-1", lang: "en", span: { in_s: 10, out_s: 24 }, engines: [{ engine: "whisper", model: "large-v3", text: a }, { engine: "parakeet", model: "tdt-0.6b", text: b }], capturedAt: AT }), ...o });

  it("measures word agreement by word edit distance", () => {
    expect(wordAgreement("We will meet again.", "we will meet again")).toBe(1);
    expect(wordAgreement(fifty, fifty.replace("word7", "word77"))).toBeCloseTo(0.98, 10);
    expect(wordAgreement(fifty, fifty.replace("word7 ", ""))).toBeCloseTo(0.98, 10);
    expect(wordAgreement("", "")).toBe(0);
  });

  it("admits our transcript at 98% between two different engines", () => {
    const t = ours(fifty, fifty.replace("word7", "word77"));
    expect(t.agreement).toBeGreaterThanOrEqual(AGREEMENT_MIN);
    expect(transcriptProblems(t, items)).toEqual([]);
  });

  it("refuses our transcript below 98%", () => {
    const t = ours(fifty, fifty.replace("word7", "x").replace("word8", "y"));
    expect(transcriptProblems(t, items).join()).toMatch(/96\.0% of words, below the 98% bar/);
  });

  it("refuses two passes of one engine, a stored agreement its texts do not give, and text that is not the first engine's", () => {
    const same = ours(fifty, fifty, { engines: [{ engine: "whisper", model: "large-v3", text: fifty }, { engine: "Whisper", model: "medium", text: fifty }] });
    expect(transcriptProblems(same, items).join()).toMatch(/come from one engine/);
    const low = ours(fifty, fifty.replace("word7", "x").replace("word8", "y"), { agreement: 0.99 });
    expect(transcriptProblems(low, items).join()).toMatch(/stored agreement 0\.99 is not the 0\.9600/);
    const t = ours(fifty, fifty);
    const swapped = { ...t, text: "a different text", text_sha256: textSha("a different text") };
    expect(transcriptProblems(swapped, items).join()).toMatch(/first engine's text, verbatim/);
    expect(transcriptProblems({ ...t, engines: [t.engines[0]] }, items).join()).toMatch(/exactly two ASR engines/);
  });

  it("refuses our transcript of a record that may not feed SOT, or of no ledger item", () => {
    expect(transcriptProblems(ours(fifty, fifty, { item_id: "promo-1" }), items).join()).toMatch(/record_kind may feed SOT/);
    expect(transcriptProblems(ours(fifty, fifty, { item_id: "nope" }), items).join()).toMatch(/no item of the ledger/);
  });

  it("refuses an official transcript off the organ's own host, a wrong sha, or one carrying engines", () => {
    const text = "Thank you. We have agreed.";
    const off = { id: "tr-o", source: "official", item_id: "sot-1", lang: "en", url: "http://en.kremlin.ru/events/president/news/81305", publisher: "kremlin.ru", text, text_sha256: textSha(text), captured_at: AT };
    expect(transcriptProblems(off, items)).toEqual([]);
    expect(transcriptProblems({ ...off, url: "https://www.whitehouse.gov/remarks/2026/11/x/" }, items)).toEqual([]);
    expect(transcriptProblems({ ...off, url: "https://commons.wikimedia.org/wiki/File:T.pdf" }, items).join()).toMatch(/state organ's own published text/);
    expect(transcriptProblems({ ...off, url: "https://www.rev.com/transcripts/x" }, items).join()).toMatch(/state organ's own published text/);
    expect(transcriptProblems({ ...off, text_sha256: "0".repeat(64) }, items).join()).toMatch(/not the sha256 of its text/);
    expect(transcriptProblems({ ...off, engines: [], agreement: 1 }, items).join()).toMatch(/carries no ASR engines/);
    expect(transcriptProblems({ ...off, publisher: "" }, items).join()).toMatch(/names its publisher/);
  });

  it("validates in the ledger schema and the lint", () => {
    const ledger: any = { ...emptyLedger(35), transcripts: [ours(fifty, fifty), ours(fifty, fifty)] };
    expect(validateLedger(ledger)).toEqual([]);
    expect(ledgerTranscriptProblems({ ...ledger, items }).join()).toMatch(/is repeated/);
    expect(lintTranscripts({ ...ledger, items, transcripts: [ours(fifty, "nothing alike")] })[0]).toMatchObject({ rule: "transcript-class", item: "tr-1" });
    expect(validateLedger({ ...ledger, transcripts: [{ ...ours(fifty, fifty), source: "asr" }] }).join()).toMatch(/transcripts/);
  });

  it("the CLI writes an official Kremlin transcript and refuses ours below the bar without writing", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "omnibus-t5-cli-"));
    const dir = path.join(tmp, "episodes", "35");
    mkdirSync(dir, { recursive: true });
    const ledger = { ...emptyLedger(35), items: [] as any[] };
    writeFileSync(path.join(dir, "rights-ledger.json"), JSON.stringify(ledger));
    // An item the transcript belongs to: any valid ledger item will do for the transcript class.
    const PC = "http://en.kremlin.ru/events/president/news/81305";
    const http = { getText: async () => ({ status: "ok", text: html("t5-kremlin-81305-press-conference.html") }) };
    await expect(runTranscript({ root: tmp, issue: 35, itemId: "sot-1", id: "tr-pc", official: PC, http, now })).rejects.toThrow(/no item of the ledger/);
    const before = readFileSync(path.join(dir, "rights-ledger.json"), "utf8");
    const a = path.join(tmp, "a.json");
    const b = path.join(tmp, "b.json");
    writeFileSync(a, JSON.stringify({ engine: "whisper", model: "large-v3", text: fifty }));
    writeFileSync(b, JSON.stringify({ engine: "parakeet", model: "tdt", text: "entirely different words" }));
    await expect(runTranscript({ root: tmp, issue: 35, itemId: "sot-1", id: "tr-ours", ours: [a, b], lang: "en", now })).rejects.toThrow(/below the 98% bar/);
    expect(readFileSync(path.join(dir, "rights-ledger.json"), "utf8")).toBe(before);
    await expect(runTranscript({ root: tmp, issue: 35, itemId: "x", id: "tr-x", official: "https://www.rev.com/x", http, now })).rejects.toThrow(/no official-transcript reader/);
    // With the bite's item in the ledger, the Kremlin's own transcript is written beside it.
    const terms = html("t5-kremlin-copyrights-en.html");
    const fhttp = {
      getText: async (u: string) => ({ status: "ok", text: u === kremlin.TERMS_URL ? terms : html("t5-kremlin-81305-press-conference.html") }),
      getMedia: async (_u: string, dest: string) => { writeFileSync(dest, "x"); return { status: "ok", sha256: "a".repeat(64), sha1: "b".repeat(40), bytes: 1, mime: "video/mp4", generator_tags: [] }; },
    };
    const doc = { schema: "omnibus.asset-requests/1", issue: 35, requests: [{ id: "sot-1", kind: "footage", for: "lead", title: "Putin", candidates: [{ adapter: "kremlin", ref: PC, tier: 1 }] }] };
    const filled = await fetchRequests(doc, emptyLedger(35), { adapters: { kremlin }, http: fhttp, mediaDir: mkdtempSync(path.join(os.tmpdir(), "omnibus-t5-")), checkedBy: "t", now });
    writeFileSync(path.join(dir, "rights-ledger.json"), JSON.stringify(filled.ledger));
    const t = await runTranscript({ root: tmp, issue: 35, itemId: "sot-1", id: "tr-pc", official: PC, http, now });
    expect(t).toMatchObject({ source: "official", translated_from: "ru" });
    const written = JSON.parse(readFileSync(path.join(dir, "rights-ledger.json"), "utf8"));
    expect(written.transcripts.map((x: any) => x.id)).toEqual(["tr-pc"]);
    expect(lintTranscripts(written)).toEqual([]);
    expect(readFileSync(path.join(dir, "disputes.json"), "utf8").length).toBeGreaterThan(10);
  });
});
