// Adapters read recorded API metadata (tests/fixtures/rights, JSON only, no
// media). Each fixture carries the URL it was recorded from; the adapter's
// own URL builder must produce that URL, so a fixture can never drift from
// the request the code makes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as commons from "../scripts/lib/rights/adapters/commons.mjs";
import * as dvids from "../scripts/lib/rights/adapters/dvids.mjs";
import * as loc from "../scripts/lib/rights/adapters/loc.mjs";
import * as nasa from "../scripts/lib/rights/adapters/nasa.mjs";
import { checkCandidate, launderingCheck } from "../scripts/lib/rights/provenance.mjs";
import { plain, firstDate } from "../scripts/lib/rights/text.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XSS = '"><img src=x onerror=alert(1)>';
const AT = "2026-11-12T10:00:00Z";
type Fixture = { _recorded: { url: string }; response: any };
const fx = (name: string): Fixture => JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "rights", name), "utf8"));

/** An http double that answers only the URLs the fixtures were recorded from. */
function fixtureHttp(...names: string[]) {
  const byUrl = new Map(names.map((n) => [fx(n)._recorded.url, fx(n).response]));
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
const now = () => new Date(AT);

describe("Wikimedia Commons adapter", () => {
  it("builds the URL each fixture was recorded from", () => {
    expect(commons.infoUrl("File:Spain-36 - Toledo (2218865210).jpg")).toBe(fx("commons-cc-by-sa-2.0.json")._recorded.url);
    expect(commons.infoUrl("https://commons.wikimedia.org/wiki/File:Aldrin_Apollo_11_original.jpg")).toBe(fx("commons-pd-nasa.json")._recorded.url);
  });

  it("reads a CC BY-SA 2.0 Flickr transfer: licence, author, capture and upload dates, evidence", async () => {
    const r = await commons.lookup("File:Spain-36 - Toledo (2218865210).jpg", { http: fixtureHttp("commons-cc-by-sa-2.0.json"), now });
    expect(r.status).toBe("ok");
    const c = r.candidate;
    expect(c).toMatchObject({
      licence: "cc-by-sa-2.0",
      credit: "Dennis G. Jarvis, via Wikimedia Commons",
      date: "2016-04-21",
      published_at: "2018-03-02T00:34:11Z",
      item_url: "https://commons.wikimedia.org/wiki/File:Spain-36_-_Toledo_(2218865210).jpg",
      own_work: false,
    });
    expect(c.media_url).toMatch(/^https:\/\/upload\.wikimedia\.org\/.+\.jpg$/);
    expect(c.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(c.evidence).toMatchObject({ url: c.item_url, captured_at: AT });
    expect(c.evidence.captured_text).toMatch(/LicenseShortName: CC BY-SA 2.0/);
    const chk = checkCandidate({ ...c, kind: "still" });
    expect(chk.reasons).toEqual([]);
    expect(chk.ai_provenance_check.status).toBe("clear");
    expect(chk.laundering_check.status).toBe("clear");
  });

  it("reads CC BY 2.0", () => {
    const r = commons.parseInfo(fx("commons-cc-by-2.0.json").response, { ref: "x", capturedAt: AT });
    expect(r.candidate).toMatchObject({ licence: "cc-by-2.0", credit: "Adam Schuster, via Wikimedia Commons" });
  });

  it("passes PD-USGov (PD NASA) with the basis taken from its category", () => {
    const r = commons.parseInfo(fx("commons-pd-nasa.json").response, { ref: "x", capturedAt: AT });
    expect(r.candidate.licence).toBe("pd-us-federal");
    expect(r.candidate.basis).toMatch(/PD NASA.*17 U\.S\.C\. 105/);
    expect(r.candidate.date).toBe("1969-07-21");
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(true);
  });

  it("fails an own-work file in the AI-generated categories, and asks for the uploader", async () => {
    const http = fixtureHttp("commons-ai-own-work.json", "commons-user-ai-uploader.json");
    const r = await commons.lookup("File:2023-03 AI images ZvD 01.png", { http, now });
    expect(http.asked).toHaveLength(2);
    expect(r.candidate.own_work).toBe(true);
    expect(r.candidate.uploader).toMatchObject({ name: "Ziko" });
    const chk = checkCandidate({ ...r.candidate, kind: "still" });
    expect(chk.ok).toBe(false);
    expect(chk.ai_provenance_check.status).toBe("flagged");
    expect(chk.reasons.some((x: string) => /^AI-generated: .*AI-generated images/.test(x))).toBe(true);
    expect(chk.reasons.some((x: string) => /PD-algorithm/.test(x))).toBe(true);
  });

  it("fails the AI file on its categories alone, even with a licence that would pass", () => {
    const r = commons.parseInfo(fx("commons-ai-own-work.json").response, { ref: "x", capturedAt: AT });
    const chk = checkCandidate({ ...r.candidate, licence: "cc0-1.0", kind: "still", uploader: { name: "Ziko", registration: "2007-03-25T22:02:37Z", editcount: 42012 } });
    expect(chk.ok).toBe(false);
    expect(chk.reasons.every((x: string) => x.startsWith("AI-generated: "))).toBe(true);
  });

  it("needs a US basis for PD-old: the file's latest year must be 95 years past", () => {
    const json = structuredClone(fx("commons-pd-nasa.json").response);
    const page = json.query.pages[0];
    page.categories = [{ title: "Category:PD-old-70" }];
    page.imageinfo[0].extmetadata.Categories.value = "PD-old-70";
    expect(commons.parseInfo(json, { ref: "x", capturedAt: AT }).candidate.licence).toBeNull(); // dated 1969
    page.imageinfo[0].extmetadata.DateTimeOriginal.value = "1890";
    expect(commons.parseInfo(json, { ref: "x", capturedAt: AT }).candidate.licence).toBe("pd-age");
    page.categories = [{ title: "Category:PD-old-assumed" }];
    page.imageinfo[0].extmetadata.Categories.value = "PD-old-assumed";
    page.imageinfo[0].extmetadata.DateTimeOriginal.value = "1890 (file-date: 2015-01-01)";
    expect(commons.parseInfo(json, { ref: "x", capturedAt: AT }).candidate.licence).toBeNull();
  });

  it("refuses a file Commons marks trademarked or an insignia", () => {
    const json = structuredClone(fx("commons-cc-by-2.0.json").response);
    json.query.pages[0].imageinfo[0].extmetadata.Restrictions.value = "trademarked";
    const c = commons.parseInfo(json, { ref: "x", capturedAt: AT }).candidate;
    expect(checkCandidate({ ...c, kind: "still" }).reasons).toContain('Commons marks the file "trademarked", a restriction no licence lifts');
    expect(commons.restrictionReasons("insignia|personality")).toHaveLength(1);
  });

  it("reports a missing file as not found", () => {
    expect(commons.parseInfo(fx("commons-missing.json").response, { ref: "x", capturedAt: AT })).toEqual({ status: "not_found" });
  });

  it("strips markup from the author, so a hostile Artist field never reaches a credit as HTML", () => {
    const json = structuredClone(fx("commons-cc-by-2.0.json").response);
    json.query.pages[0].imageinfo[0].extmetadata.Artist.value = `<a href="x">${XSS}</a>`;
    const c = commons.parseInfo(json, { ref: "x", capturedAt: AT }).candidate;
    expect(c.credit).not.toMatch(/<img|onerror=alert\(1\)>/);
    expect(plain(XSS)).toBe('"');
    expect(plain("&lt;img src=x onerror=alert(1)&gt;Name")).toBe("Name");
  });
});

describe("laundering heuristics", () => {
  const base = { adapter: "commons", own_work: true, date: "2026-10-28", published_at: "2026-10-29T08:00:00Z" };
  it("clears an established uploader", () => {
    expect(launderingCheck({ ...base, uploader: { name: "A", registration: "2015-01-01T00:00:00Z", editcount: 900 } }).status).toBe("clear");
  });
  it("suspects a new account with few edits", () => {
    const r = launderingCheck({ ...base, uploader: { name: "B", registration: "2026-10-20T00:00:00Z", editcount: 3 } });
    expect(r.status).toBe("suspect");
    expect(r.findings[0]).toMatch(/9 days old at upload with 3 edits/);
  });
  it("suspects own work with no capture date, or a capture after the upload", () => {
    const u = { name: "A", registration: "2015-01-01T00:00:00Z", editcount: 900 };
    expect(launderingCheck({ ...base, date: null, uploader: u }).findings).toContain("claimed as own work with no capture date");
    expect(launderingCheck({ ...base, date: "2026-11-05", uploader: u }).status).toBe("suspect");
  });
  it("suspects own work when the account cannot be read", () => {
    expect(launderingCheck({ ...base, uploader: null }).status).toBe("suspect");
  });
  it("does not apply to institution records", () => {
    expect(launderingCheck({ adapter: "nasa" }).status).toBe("not_applicable");
  });
  it("fails a candidate on suspicion", () => {
    const r = commons.parseInfo(fx("commons-cc-by-sa-2.0.json").response, { ref: "x", capturedAt: AT });
    const chk = checkCandidate({ ...r.candidate, kind: "still", own_work: true, uploader: { name: "B", registration: "2018-03-01T00:00:00Z", editcount: 2 } });
    expect(chk.ok).toBe(false);
    expect(chk.reasons.some((x: string) => x.startsWith("laundering suspicion:"))).toBe(true);
  });
});

describe("NASA Image and Video Library adapter", () => {
  it("reads the search record and the asset manifest's original", async () => {
    const r = await nasa.lookup("as11-40-5903", { http: fixtureHttp("nasa-search-as11-40-5903.json", "nasa-asset-as11-40-5903.json"), now });
    expect(r.candidate).toMatchObject({
      licence: "pd-us-federal",
      credit: "NASA/JSC",
      date: "1969-07-20",
      media_url: "https://images-assets.nasa.gov/image/as11-40-5903/as11-40-5903~orig.jpg",
      kind_hint: "still",
    });
    expect(r.candidate.evidence.captured_text).toMatch(/No field credits anyone outside NASA/);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(true);
  });

  it("fails an item that credits a partner agency or a photo agency", () => {
    const search = structuredClone(fx("nasa-search-as11-40-5903.json").response);
    search.collection.items[0].data[0].secondary_creator = "ESA/Hubble";
    const r = nasa.parseNasa(search, fx("nasa-asset-as11-40-5903.json").response, { ref: "as11-40-5903", capturedAt: AT });
    expect(r.candidate.licence).toBeNull();
    expect(checkCandidate({ ...r.candidate, kind: "still" }).reasons[0]).toMatch(/secondary_creator/);
    search.collection.items[0].data[0].secondary_creator = undefined;
    search.collection.items[0].data[0].photographer = "Getty Images";
    expect(nasa.parseNasa(search, fx("nasa-asset-as11-40-5903.json").response, { ref: "as11-40-5903", capturedAt: AT }).candidate.licence).toBeNull();
  });

  const parsed = (name: string, id: string) => nasa.parseNasa(fx(name).response, null, { ref: id, capturedAt: AT }).candidate;

  it("fails partner and contractor credits recorded from the library: SpaceX, JPL-Caltech/MSSS, Boeing, ESA in a description credit", () => {
    for (const [name, id, who] of [
      ["nasa-search-spacex.json", "KSC-20200429-PH-SPX01_0001", /SpaceX/],
      ["nasa-search-jpl-msss.json", "PIA25046", /JPL-Caltech\/MSSS/],
      ["nasa-search-boeing.json", "KSC-20161017-PH_BOE01_0001", /Boeing/],
      ["nasa-search-esa-in-description.json", "GSFC_20171208_Archive_e000982", /ESA\/Hubble/],
    ] as const) {
      const c = parsed(name, id);
      expect(c.licence, name).toBeNull();
      expect(c.licence_raw, name).toMatch(who);
      expect(checkCandidate({ ...c, kind: "still", media_url: "https://images-assets.nasa.gov/x.jpg" }).ok, name).toBe(false);
    }
  });

  it("passes a NASA staff photographer's credit", async () => {
    const r = await nasa.lookup("NHQ202409270003", { http: fixtureHttp("nasa-search-nasa-staff.json", "nasa-asset-nasa-staff.json"), now });
    expect(r.candidate).toMatchObject({ licence: "pd-us-federal", credit: "NASA/Keegan Barber" });
  });

  it("fails an ESA credit hidden in description_508 alone (hand-edited from the Apollo record)", () => {
    const search = structuredClone(fx("nasa-search-as11-40-5903.json").response);
    search.collection.items[0].data[0].description_508 = "A nebula. Image credit: ESA/Webb, NASA & CSA";
    expect(nasa.parseNasa(search, null, { ref: "as11-40-5903", capturedAt: AT }).candidate.licence).toBeNull();
  });

  it("reads which credits are NASA's alone", () => {
    for (const ok of ["NASA", "NASA/JSC", "NASA/Keegan Barber", "(NASA/Bill Ingalls)", "NASA/GSFC"]) expect(nasa.isNasaOnlyCredit(ok), ok).toBe(true);
    for (const no of ["NASA/JPL-Caltech", "NASA/JPL", "SpaceX", "Boeing", "ESA/Hubble & NASA", "NASA/JPL-Caltech/MSSS", "NASA/Johns Hopkins APL", "NASA, ESA and STScI", "NASA/Univ. of Arizona"]) {
      expect(nasa.isNasaOnlyCredit(no), no).toBe(false);
    }
  });

  it("reports an id the search does not hold as not found", () => {
    expect(nasa.parseNasa({ collection: { items: [] } }, null, { ref: "zz", capturedAt: AT })).toEqual({ status: "not_found" });
  });
});

describe("Library of Congress adapter", () => {
  it("reads an FSA photograph as a US federal work, with the LoC credit line", async () => {
    const r = await loc.lookup("2017762891", { http: fixtureHttp("loc-item-2017762891.json"), now });
    expect(r.candidate).toMatchObject({
      licence: "pd-us-federal",
      date: "1936",
      item_url: "https://www.loc.gov/item/2017762891/",
      credit: "Dorothea Lange. Library of Congress, Prints & Photographs Division, Farm Security Administration/Office of War Information Black-and-White Negatives, LC-DIG-fsa-8b29516",
    });
    expect(r.candidate.media_url).toMatch(/^https:\/\/tile\.loc\.gov\/.+\.jpg$/);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(true);
  });

  it("never takes 'No known restrictions' alone as a licence", () => {
    const json = structuredClone(fx("loc-item-2017762891.json").response);
    json.item.rights = [];
    const r = loc.parseLoc(json, { ref: "2017762891", capturedAt: AT });
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/No known restrictions.*not a licence/);
  });

  const aged = (item: Record<string, unknown>) => {
    const json = structuredClone(fx("loc-item-2017762891.json").response);
    json.item.rights = [];
    json.item.dates = [];
    json.item.contributor_names = [];
    Object.assign(json.item, item);
    return loc.parseLoc(json, { ref: "2017762891", capturedAt: AT }).candidate;
  };

  it("passes pd-age only on 120 years from creation with no author, or publication 95 years ago", () => {
    const anon = aged({ date: "1888", created_published: ["1888."] });
    expect(anon.licence).toBe("pd-age");
    expect(anon.basis).toMatch(/Created by 1888 .* author unknown: more than 120 years from creation/);
    expect(aged({ date: "1888", created_published: ["1888."], contributor_names: ["Doe, Jane, photographer"] }).licence).toBeNull();
    const pub = aged({ date: "1925", created_published: ["New York : Harper, 1925."], contributor_names: ["Doe, Jane"] });
    expect(pub.licence).toBe("pd-age");
    expect(pub.basis).toMatch(/Published in 1925 .* more than 95 years ago/);
    expect(aged({ date: "1910", created_published: ["1910."] }).licence).toBeNull();
  });

  it("judges a date range by its latest year", () => {
    expect(aged({ date: "1880-1935", created_published: ["between 1880 and 1935."] }).licence).toBeNull();
    expect(loc.latestYear(["1880-1935", "between 1880 and 1935"])).toBe(1935);
  });

  it("refuses pd-age when the rights text cautions", () => {
    for (const r of ["Rights status not evaluated.", "This item may be protected by copyright.", "Publication may be restricted."]) {
      const c = aged({ date: "1888", created_published: ["1888."], rights: [r] });
      expect(c.licence, r).toBeNull();
      expect(c.licence_note, r).toMatch(/the rights text says/);
    }
  });

  it("needs public domain and a federal source in one sentence, with no caution beside it", () => {
    const json = structuredClone(fx("loc-item-2017762891.json").response);
    json.item.rights = ["Photographs by the Farm Security Administration. Some items are in the public domain."];
    expect(loc.parseLoc(json, { ref: "2017762891", capturedAt: AT }).candidate.licence).toBeNull();
    json.item.rights = ["The Farm Security Administration negatives are in the public domain. Some prints may be protected by copyright."];
    expect(loc.parseLoc(json, { ref: "2017762891", capturedAt: AT }).candidate.licence).toBeNull();
    // the recorded FSA statement, with LoC's standard "Copyright and other Restrictions" link titles, passes
    expect(loc.parseLoc(fx("loc-item-2017762891.json").response, { ref: "2017762891", capturedAt: AT }).candidate.licence).toBe("pd-us-federal");
  });
});

describe("DVIDS adapter (optional, needs DVIDS_API_KEY)", () => {
  it("skips cleanly without a key and makes no request", async () => {
    const http = fixtureHttp();
    const r = await dvids.lookup("image:123", { http, env: {}, now });
    expect(r).toEqual({ status: "skipped", reason: expect.stringMatching(/DVIDS_API_KEY/) });
    expect(http.asked).toEqual([]);
  });

  // Hand-built, not recorded: no key was available for this ticket (dvids.mjs says so).
  const record = {
    results: {
      title: "Hurricane relief, Puerto Rico",
      description: "Soldiers unload water.",
      date: "2026-10-28",
      date_published: "2026-10-29T12:00:00Z",
      credit: [{ rank: "Sgt.", name: "Jane Roe" }],
      unit_name: "1st Mission Support Command",
      keywords: "hurricane, relief",
      image: "https://cdn.dvidshub.net/media/photos/2610/123.jpg",
      license: "Public Domain",
    },
  };

  it("passes an item whose own record marks it public domain, and never leaks the key", async () => {
    const asked: string[] = [];
    const http = { getJson: async (url: string) => (asked.push(url), { status: "ok", json: record, url }) };
    const r = await dvids.lookup("image:123", { http, env: { DVIDS_API_KEY: "sekret-key" }, now });
    expect(asked[0]).toBe("https://api.dvidshub.net/asset?id=image%3A123&api_key=sekret-key");
    expect(r.candidate).toMatchObject({ licence: "pd-us-federal", credit: "Sgt. Jane Roe, 1st Mission Support Command, DVIDS", item_url: "https://www.dvidshub.net/image/123" });
    expect(JSON.stringify(r)).not.toMatch(/sekret-key/);
    expect(checkCandidate({ ...r.candidate, kind: "still" }).ok).toBe(true);
  });

  it("fails an item with no per-item mark", () => {
    const r = dvids.parseDvids({ results: { ...record.results, license: undefined } }, { ref: "image:123", capturedAt: AT });
    expect(r.candidate.licence).toBeNull();
  });

  it("redacts the key from an error", async () => {
    const http = { getJson: async (url: string) => Promise.reject(new Error(`${url} answered 500`)) };
    await expect(dvids.lookup("image:123", { http, env: { DVIDS_API_KEY: "sekret-key" }, now })).rejects.toThrow(/\[DVIDS_API_KEY\]/);
    await expect(dvids.lookup("image:123", { http, env: { DVIDS_API_KEY: "sekret-key" }, now })).rejects.not.toThrow(/sekret-key/);
  });
});

describe("text helpers", () => {
  it("reads dates from Commons and NASA formats", () => {
    expect(firstDate("1969-07-20T00:00:00Z")).toBe("1969-07-20");
    expect(firstDate('circa 1890<div style="display: none;">date QS:P,+1890-00-00T00:00:00Z/9</div>')).toBe("1890");
    expect(firstDate("March 1936")).toBe("1936");
    expect(firstDate("")).toBeNull();
  });
});

describe("T2b precision: no federal claim for a third party, no refusal of ordinary NASA, LoC and archive titles", () => {
  const withData = (patch: Record<string, unknown>) => {
    const s = structuredClone(fx("nasa-search-as11-40-5903.json").response);
    Object.assign(s.collection.items[0].data[0], patch);
    return nasa.parseNasa(s, fx("nasa-asset-as11-40-5903.json").response, { ref: "as11-40-5903", capturedAt: AT }).candidate;
  };

  it("refuses a photo, image, video or illustration credit to a contractor, with or without 'by' or 'credit'", () => {
    for (const d of [
      "Starliner on the pad. Photo: Boeing",
      "Falcon 9 lifts off. Photo by SpaceX.",
      "Dragon docks. Image: SpaceX",
      "Launch replay. Video by Blue Origin.",
      "Lander concept. Illustration: Intuitive Machines",
      "Cygnus berthing. Images by Northrop Grumman.",
      "Rover tracks. Image by: Malin Space Science Systems",
    ]) {
      const c = withData({ description: d });
      expect(c.licence, d).toBeNull();
      expect(checkCandidate({ ...c, kind: "still" }).ok, d).toBe(false);
    }
  });

  it("does not read prose as a credit: 'credits' with no colon, 'photographed', 'courtesy' with no 'of'", () => {
    for (const d of [
      "The team credits the success of the mission to years of testing.",
      "The capsule was photographed at an angle from the gantry.",
      "As a courtesy to the crew, the hatch photos were held.",
    ]) {
      expect(withData({ description: d }).licence, d).toBe("pd-us-federal");
    }
    // a credit with a colon still counts, and so do "photo credit" and "courtesy of" with none
    expect(withData({ description: "Pad view. Credit: SpaceX" }).licence).toBeNull();
    expect(withData({ description: "Pad view. Photo credit SpaceX" }).licence).toBeNull();
    expect(withData({ description: "Pad view. Courtesy of SpaceX" }).licence).toBeNull();
    expect(withData({ description: "Pad view. Photo credit: NASA/Kim Shiflett" }).licence).toBe("pd-us-federal");
  });

  it("matches organisation names as whole words, so staff names that contain them pass", () => {
    for (const ok of [
      "NASA/Laura Rochon",
      "NASA/Ben Kaplan",
      "NASA/Sierra Smith",
      "NASA/Lucas Ball",
      "NASA/Goddard Space Flight Center",
      "NASA's Goddard Space Flight Center",
      "NASA/Kennedy Space Center",
      "NASA/Johnson Space Center/Josh Valcarcel",
    ]) {
      expect(nasa.isNasaOnlyCredit(ok), ok).toBe(true);
    }
    for (const no of ["NASA/Sierra Space", "NASA/Ball Aerospace", "NASA/AURA", "NASA/Johns Hopkins APL", "NASA/Firefly Aerospace"]) {
      expect(nasa.isNasaOnlyCredit(no), no).toBe(false);
    }
  });

  it("accepts a bare name in photographer or secondary_creator only when the record's own text credits NASA/<that name>", () => {
    const ingalls = "Crew portrait. Photo credit: NASA/Bill Ingalls";
    expect(withData({ center: "HQ", photographer: "Bill Ingalls", description: ingalls })).toMatchObject({ licence: "pd-us-federal", credit: "Bill Ingalls, NASA" });
    expect(withData({ center: "KSC", secondary_creator: "Kim Shiflett", title: "Pad 39A (NASA/Kim Shiflett)" }).licence).toBe("pd-us-federal");
    // no matching NASA/<name> credit in the text: refused, whatever the centre
    expect(withData({ center: "HQ", photographer: "Bill Ingalls" }).licence).toBeNull();
    expect(withData({ center: "KSC", photographer: "Bill Ingalls", description: "Photo credit: NASA/Kim Shiflett" }).licence).toBeNull();
    expect(withData({ center: "JPL", photographer: "Bill Ingalls", description: ingalls }).licence).toBeNull();
  });

  it("refuses contractors in a bare credit field, even beside a NASA staff credit (hand-edited ULA and Virgin Galactic records)", () => {
    for (const who of ["United Launch Alliance", "Virgin Galactic", "Airbus Defence", "Thales Alenia", "General Electric", "Jacobs Engineering", "Firefly Aerospace", "SpaceX", "Firefly"]) {
      const c = withData({ center: "KSC", photographer: who, description: "Atlas V on the pad. Photo credit: NASA/Kim Shiflett" });
      expect(c.licence, who).toBeNull();
      expect(c.licence_raw, who).toContain(who);
      expect(checkCandidate({ ...c, kind: "still" }).ok, who).toBe(false);
    }
  });

  it("T2c: after NASA/, takes only NASA units, a short mission list or a 2 to 4 word name that is not all capitals", () => {
    for (const no of ["NASA/ULA", "NASA/CNSA", "NASA/ASI", "NASA/Bigelow", "NASA/JHUAPL/CIW", "NASA/GSFC/ASU", "NASA/KARI", "NASA/Ingalls", "NASA/CIW", "NASA/JHU APL", "NASA/Sierra SNC"]) {
      expect(nasa.isNasaOnlyCredit(no), no).toBe(false);
    }
    for (const ok of ["NASA/Explorer 1", "NASA/Apollo 11", "NASA/Artemis II", "NASA/Joel Kowsky", "NASA/Aubrey Gemignani", "NASA/J. D. Smith", "NASA/GSFC"]) {
      expect(nasa.isNasaOnlyCredit(ok), ok).toBe(true);
    }
  });

  it("T2c: reads Goddard's Conceptual Image Lab and Scientific Visualization Studio without the slash", () => {
    for (const ok of [
      "NASA Goddard Space Flight Center Conceptual Image Lab",
      "NASA's Goddard Space Flight Center Conceptual Image Lab",
      "NASA Goddard Space Flight Center Scientific Visualization Studio",
      "NASA's Goddard Space Flight Center Scientific Visualization Studio",
    ]) {
      expect(nasa.isNasaOnlyCredit(ok), ok).toBe(true);
    }
    expect(nasa.isNasaOnlyCredit("NASA Goddard Space Flight Center Conceptual Image Lab/ASU")).toBe(false);
  });

  it("T2c: a bare all-capitals or one-word staff field is never read as a NASA photographer", () => {
    expect(withData({ center: "KSC", photographer: "ULA", description: "Photo credit: NASA/ULA" }).licence).toBeNull();
    expect(withData({ center: "KSC", photographer: "Bigelow", description: "Photo credit: NASA/Bigelow" }).licence).toBeNull();
  });

  it("reads NASA's visualisation studios as NASA units", () => {
    for (const ok of ["NASA/Scientific Visualization Studio", "NASA/SVS", "NASA/Goddard/Conceptual Image Lab", "NASA's Scientific Visualization Studio"]) {
      expect(nasa.isNasaOnlyCredit(ok), ok).toBe(true);
    }
  });

  it("refuses an outlet named in a Commons Credit field before download, as the lint does", () => {
    const json = structuredClone(fx("commons-cc-by-2.0.json").response);
    json.query.pages[0].imageinfo[0].extmetadata.Credit = { value: "BBC News", source: "commons-desc-page" };
    const c = commons.parseInfo(json, { ref: "File:HollerithMachine.CHM.jpg", capturedAt: AT }).candidate;
    expect(c.credit).toMatch(/Adam Schuster/);
    expect(c.credit_fields).toContain("BBC News");
    expect(checkCandidate({ ...c, kind: "still" }).reasons.join(" ")).toMatch(/news network or outlet/);
  });

  const locRights = (rights: string[]) => {
    const json = structuredClone(fx("loc-item-2017762891.json").response);
    json.item.rights = rights;
    return loc.parseLoc(json, { ref: "2017762891", capturedAt: AT }).candidate;
  };

  it("refuses a class-level LoC statement about works or employees, unless it is a known collection statement", () => {
    for (const s of [
      "Works created by U.S. government employees are in the public domain.",
      "Photographs taken by federal government employees as part of their duties are in the public domain.",
    ]) {
      const c = locRights([s]);
      expect(c.licence, s).toBeNull();
      expect(c.licence_note, s).toMatch(/class of works/);
    }
    expect(
      locRights(["The contents of the Library of Congress Farm Security Administration/Office of War Information Black-and-White Negatives are in the public domain and are free to use and reuse."]).licence,
    ).toBe("pd-us-federal");
    expect(locRights(["Photographs created by Farm Security Administration/Office of War Information employees are in the public domain."]).licence).toBe("pd-us-federal");
  });

  it("reads LoC's 'not aware of any U.S. copyright protection' as boilerplate, and keeps U.S. and U.S.C. inside one sentence", () => {
    const aware = "The Library of Congress is not aware of any U.S. copyright protection (see Title 17, U.S.C.) or any other restrictions in the materials in the collection.";
    expect(loc.cautionIn(aware)).toBeNull();
    expect(locRights([`${aware} The negatives of the U.S. Farm Security Administration are in the public domain.`]).licence).toBe("pd-us-federal");
    expect(loc.federalPdSentence("This U.S. Army photograph is in the public domain under 17 U.S.C. 105.")).toBe("This U.S. Army photograph is in the public domain under 17 U.S.C. 105.");
    expect(loc.federalPdSentence("Made by the U.S. Army. Some prints are in the public domain.")).toBeNull();
    // a real caution beside it is still read
    expect(loc.cautionIn(`${aware} Some items may be protected by copyright.`)).toMatch(/may be protected/);
    // the boilerplate stops at "except", "however", "unless" or "but": a restriction in the same sentence is caught
    for (const turn of ["except", "however", "unless", "but"]) {
      const s = `The Library of Congress is not aware of any U.S. copyright protection on these photographs ${turn} the donor's restrictions apply to publication.`;
      expect(loc.cautionIn(s), turn).toMatch(/restrictions apply/);
    }
  });
});
