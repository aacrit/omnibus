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

  it("reports a missing file as not found", () => {
    expect(commons.parseInfo(fx("commons-missing.json").response, { ref: "x", capturedAt: AT })).toEqual({ status: "not_found" });
  });

  it("strips markup from the author, so a hostile Artist field never reaches a credit as HTML", () => {
    const json = structuredClone(fx("commons-cc-by-2.0.json").response);
    json.query.pages[0].imageinfo[0].extmetadata.Artist.value = `<a href="x">${XSS}</a>`;
    const c = commons.parseInfo(json, { ref: "x", capturedAt: AT }).candidate;
    expect(c.credit).not.toMatch(/<img|onerror=alert\(1\)>/);
    expect(plain(XSS)).toBe('">');
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

  it("passes an item over 120 years old by age", () => {
    const json = structuredClone(fx("loc-item-2017762891.json").response);
    json.item.rights = [];
    json.item.date = "1888";
    expect(loc.parseLoc(json, { ref: "2017762891", capturedAt: AT }).candidate.licence).toBe("pd-age");
    json.item.date = "1910";
    expect(loc.parseLoc(json, { ref: "2017762891", capturedAt: AT }).candidate.licence).toBeNull();
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
