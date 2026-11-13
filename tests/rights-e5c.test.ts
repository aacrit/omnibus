// E5c: DVIDS against the live API. The fixtures are recorded live responses
// (tests/fixtures/rights/dvids-*.json, 2026-11-12), trimmed and key-free:
// the key-bearing fields (hls_url, closed_caption_urls) are not recorded.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dvids from "../scripts/lib/rights/adapters/dvids.mjs";
import { isAllowedUrl } from "../scripts/lib/rights/http.mjs";
import { checkCandidate } from "../scripts/lib/rights/provenance.mjs";
import { resolveRequests, videoFirst } from "../scripts/lib/rights/resolve.mjs";
import { fetchRequests } from "../scripts/lib/rights/fetcher.mjs";
import { emptyLedger } from "../scripts/lib/rights/ledger.mjs";

const XSS = '"><img src=x onerror=alert(1)>';
const AT = "2026-11-12T14:00:00Z";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "rights");
const fx = (n: string) => JSON.parse(readFileSync(path.join(DIR, n), "utf8"));
const parse = (n: string, ref: string) => dvids.parseDvids(fx(n).response, { ref, capturedAt: AT }).candidate;
const base = () => structuredClone(fx("dvids-asset-video-1028785.json").response.results);

describe("recorded DVIDS fixtures carry no key", () => {
  it("records no api_key value, no HLS address and no caption address", () => {
    for (const f of readdirSync(DIR).filter((n) => n.startsWith("dvids-"))) {
      const text = readFileSync(path.join(DIR, f), "utf8");
      expect(text, f).not.toMatch(/api_key=/);
      expect(text, f).not.toMatch(/\.m3u8|closed-captions\//);
      expect(text, f).not.toMatch(/"(hls_url|closed_caption_urls)":/);
    }
  });
});

describe("DVIDS asset records as the live API returns them", () => {
  it("passes the Secretary's 5 Nov message: Joint branch, a US unit, a named credit; takes the 1080p file, not the 2160p master", () => {
    const c = parse("dvids-asset-video-1028785.json", "video:1028785");
    expect(c).toMatchObject({
      licence: "pd-us-federal",
      kind_hint: "footage",
      credit: "Staff Sgt. Daniel Proper, Office of the Secretary of War Public Affairs, DVIDS",
      date: "2026-11-05",
      published_at: "2026-11-05T20:09:54Z",
      item_url: "https://www.dvidshub.net/video/1028785",
      media_url: "https://d34w7g4gy10iej.cloudfront.net/video/2611/DOD_112125491/DOD_112125491-1920x1080-9000k.mp4",
    });
    expect(c.basis).toMatch(/US federal government work/);
    expect(c.evidence.captured_text).toMatch(/VIRIN 261105-A-LE512-1001/);
    expect(isAllowedUrl(c.media_url)).toBe(true);
    expect(checkCandidate({ ...c, kind: "footage" }).ok).toBe(true);
  });

  it("passes a still with a service branch and a named airman, its file on DVIDS's CDN", () => {
    const c = parse("dvids-asset-image-10078768.json", "image:10078768");
    expect(c).toMatchObject({ licence: "pd-us-federal", kind_hint: "still", media_url: "https://d34w7g4gy10iej.cloudfront.net/photos/2611/10078768.jpg" });
    expect(c.credit).toBe("Senior Airman Leighton Lucero, United States Air Forces Central, DVIDS");
  });

  it("refuses CENTCOM's 7 Nov blockade video: its credit is DVIDS's 'Courtesy', which names no author", () => {
    const c = parse("dvids-asset-video-1029004.json", "video:1029004");
    expect(c.licence).toBeNull();
    expect(c.licence_note).toMatch(/courtesy/i);
  });

  it("refuses NATO's channel: branch Joint, a non-US unit and a courtesy credit", () => {
    const c = parse("dvids-asset-video-1028881.json", "video:1028881");
    expect(c.licence).toBeNull();
    expect(c.licence_note).toMatch(/Joint/);
    expect(c.licence_note).toMatch(/courtesy/i);
  });
});

describe("the Joint rule: a US-only rank form or a US unit", () => {
  const joint = (rank: string, unit: string) => {
    const r = { ...base(), credit: [{ id: 1, name: "Jane Roe", rank }], unit_name: unit, description: "Footage." };
    return dvids.parseDvids({ results: r }, { ref: "video:1", capturedAt: AT }).candidate.licence;
  };
  it("passes a US-only rank form whatever the unit", () => {
    for (const rank of ["Spc.", "PFC", "Pfc.", "TSgt", "MSgt", "Master Sgt.", "Tech. Sgt.", "Sgt. 1st Class", "Petty Officer 2nd Class", "Seaman", "Airman 1st Class", "Senior Airman", "SrA", "Gunnery Sgt."]) {
      expect(joint(rank, "Joint Task Force-Bravo"), rank).toBe("pd-us-federal");
    }
  });
  it("refuses a rank other forces also use, under a unit that is not plainly US", () => {
    for (const rank of ["Staff Sgt.", "SSgt", "Sgt.", "Capt.", "Lt.", "Maj.", "Col.", "Cpl.", "Petty Officer", "Leading Seaman", "Able Seaman", ""]) {
      expect(joint(rank, "Natochannel"), rank).toBeNull();
      expect(joint(rank, "Combined Joint Task Force - Operation Inherent Resolve"), rank).toBeNull();
    }
  });
  it("passes any named credit under a US unit", () => {
    for (const unit of ["U.S. Central Command Public Affairs", "Office of the Secretary of War Public Affairs", "United States Air Forces Central", "Department of War"]) {
      expect(joint("Capt.", unit), unit).toBe("pd-us-federal");
    }
  });
  it("leaves a service branch to its branch: an Army item needs no US-only rank", () => {
    const r = { ...base(), branch: "Army", unit_name: "1st Armored Division", credit: [{ name: "Kyle Larsen", rank: "Sgt. 1st Class" }] };
    expect(dvids.parseDvids({ results: r }, { ref: "video:1", capturedAt: AT }).candidate.licence).toBe("pd-us-federal");
  });
});

describe("another status or a third party refuses the item", () => {
  const status = (over: Record<string, unknown>) => dvids.parseDvids({ results: { ...base(), ...over } }, { ref: "video:1", capturedAt: AT }).candidate;
  it("refuses any non-empty copyright, restrictions or licence field, whatever it says", () => {
    for (const k of ["copyright", "restrictions", "license", "licence", "copyright_status", "usage_restrictions"]) {
      for (const v of ["Public Domain", "none", ["x"], { a: 1 }]) expect(status({ [k]: v }).licence, `${k}=${JSON.stringify(v)}`).toBeNull();
    }
  });
  it("ignores an empty one", () => {
    for (const v of ["", null, [], {}]) expect(status({ copyright: v }).licence, JSON.stringify(v)).toBe("pd-us-federal");
  });
  it("refuses courtesy, and credits outside the US military", () => {
    for (const over of [
      { credit: "Courtesy" },
      { credit: "Courtesy Photo" },
      { credit: [{ name: "Courtesy", rank: "" }] },
      { description: "Ships transit the strait. (Courtesy video)" },
      { description: "Sailors train. (Royal Navy photo by Leading Seaman Jo Bloggs)" },
      { description: "Troops train. (NATO video)" },
      { description: "A crowd gathers. (Photo by John Doe, Associated Press)" },
      { credit: [{ name: "Reuters", rank: "" }] },
      { credit: [{ name: "Jane Roe", rank: "Flight Lieutenant" }], branch: "Joint", unit_name: "Royal Air Force" },
    ]) {
      expect(status(over).licence, JSON.stringify(over)).toBeNull();
    }
  });
  it("keeps markup out of every field it passes on", () => {
    const c = status({ title: XSS, description: XSS, unit_name: XSS, credit: [{ name: XSS, rank: "Spc." }] });
    for (const v of [c.title, c.description, c.credit, c.evidence.captured_text, c.licence_note ?? "", c.basis ?? ""]) expect(v).not.toMatch(/<|>/);
  });
});

describe("DVIDS search: no OR operator, so each alternative is its own search", () => {
  it("splits a step's alternatives, keeping quoted phrases whole", () => {
    expect(dvids.queryAlternatives('"U.S. Central Command" OR CENTCOM task force')).toEqual(['"U.S. Central Command"', "CENTCOM task force"]);
    expect(dvids.queryAlternatives('"election day" OR "absentee ballot" voting')).toEqual(['"election day"', '"absentee ballot" voting']);
    expect(dvids.queryAlternatives("Hegseth")).toEqual(["Hegseth"]);
    expect(dvids.queryAlternatives('"Vice President Vance"')).toEqual(['"Vice President Vance"']);
    expect(dvids.queryAlternatives('"OR" inside quotes')).toEqual(['"OR" inside quotes']);
  });

  it("reads the recorded Hegseth search: both hits published by day 5's print time, newest first", () => {
    const hits = dvids.searchHits(fx("dvids-search-hegseth.json").response, { from: "2026-10-30", to: "2026-11-06T19:18:18.407444+00:00" });
    expect(hits).toEqual(["video:1028891", "video:1028785"]);
    expect(dvids.searchHits(fx("dvids-search-hegseth.json").response, { from: "2026-10-30", to: "2026-11-06T15:00:00Z" })).toEqual(["video:1028785"]);
  });

  it("the resolver runs one search per alternative and merges the hits newest first, never sending OR", async () => {
    const asked: string[] = [];
    const answers: Record<string, unknown> = {
      '"U.S. Central Command"': { results: [{ id: "image:2", date_published: "2026-11-06T10:00:00Z" }, { id: "video:9", date_published: "2026-11-07T20:32:09Z" }] },
      "CENTCOM task force": { results: [{ id: "video:9", date_published: "2026-11-07T20:32:09Z" }, { id: "video:3", date_published: "2026-11-08T09:00:00Z" }] },
    };
    const http = {
      getJson: async (url: string) => {
        asked.push(url);
        const q = new URL(url).searchParams.get("q") ?? "";
        return { status: "ok", json: answers[q] ?? { results: [] }, url };
      },
    };
    const rundown = {
      issue: 33,
      asset_requests: [{ id: "r1", for: "week-day-7", kind: "footage", purpose: "p", fallback: "tier 4 locator map", ladder: [{ tier: 1, host: "api.dvidshub.net", adapter: "dvids", query: 'q="U.S. Central Command" OR CENTCOM task force; type=video', window: { from: "2026-11-01", to: "2026-11-08T11:51:04Z" } }] }],
    };
    const doc = await resolveRequests(rundown, { http, env: { DVIDS_API_KEY: "sekret" } });
    expect(asked).toHaveLength(2);
    for (const u of asked) expect(new URL(u).searchParams.get("q")).not.toMatch(/\bOR\b/);
    expect(doc.requests[0].candidates.map((c: { ref: string }) => c.ref)).toEqual(["video:3", "video:9", "image:2"]);
    expect(JSON.stringify(doc)).not.toMatch(/sekret/);
  });

  it("puts a footage request's DVIDS videos before its stills (stills stay as the rostrum fallback)", () => {
    expect(videoFirst([{ ref: "image:1" }, { ref: "video:2" }, { ref: "File:a.webm" }]).map((c: { ref: string }) => c.ref)).toEqual(["video:2", "File:a.webm", "image:1"]);
  });
});

describe("re-fetching a held request (--redo)", () => {
  it("drops the named request's held item and fills it again from its ladder; others stay held", async () => {
    const held = (id: string) => ({ id, request_id: id, kind: "footage", adapter: "commons", file: `${id}.jpg` });
    const ledger = { ...emptyLedger(33), items: [held("a"), held("b")] };
    const requests = { issue: 33, requests: ["a", "b"].map((id) => ({ id, kind: "footage", for: "week-day-5", candidates: [{ adapter: "x", ref: "1", tier: 1 }], not_fetched: [] })) };
    const seen: string[] = [];
    const adapters = { x: { lookup: async () => (seen.push("x"), { status: "not_found", reason: "gone" }) } };
    const { ledger: out, report } = await fetchRequests(requests, ledger, { adapters, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, redo: ["a"] });
    expect(seen).toEqual(["x"]);
    expect(report.find((r: { request: string }) => r.request === "b").outcome).toBe("held");
    expect(report.find((r: { request: string }) => r.request === "a").outcome).toBe("unfilled");
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(["b"]);
  });

  it("refuses a redo id that names no request", async () => {
    const requests = { issue: 33, requests: [] };
    await expect(fetchRequests(requests, emptyLedger(33), { adapters: {}, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, redo: ["nope"] })).rejects.toThrow(/nope/);
  });
});
