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
import { dvidsEvidenceProblems, lintLicenceEvidence } from "../scripts/lib/rights/lints.mjs";

const XSS = '"><img src=x onerror=alert(1)>';
const AT = "2026-11-12T14:00:00Z";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "rights");
const fx = (n: string) => JSON.parse(readFileSync(path.join(DIR, n), "utf8"));
const parse = (n: string, ref: string) => dvids.parseDvids(fx(n).response, { ref, capturedAt: AT }).candidate;
const base = () => structuredClone(fx("dvids-asset-video-1028785.json").response.results);
const PAGE_HTML = readFileSync(path.join(DIR, "dvids-page-video-1028785.html"), "utf8");
const PAGE = () => dvids.parsePublicPage(PAGE_HTML);
const withPage = (c: any, page: any = PAGE()) => dvids.withPublicPage(c, page, { capturedAt: AT });

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
    expect(c.api_evidence.captured_text).toMatch(/VIRIN 261105-A-LE512-1001/);
    expect(isAllowedUrl(c.media_url)).toBe(true);
    // The API record alone is no licence evidence: the fetcher refuses it until the public page is read.
    expect(c.evidence).toBeNull();
    expect(checkCandidate({ ...c, kind: "footage" }).ok).toBe(false);
    expect(checkCandidate({ ...withPage(c), kind: "footage" }).ok).toBe(true);
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
    const w = withPage(c);
    for (const v of [c.title, c.description, c.credit, c.api_evidence.captured_text, c.licence_note ?? "", c.basis ?? "", w.evidence.captured_text, w.evidence_also[0].captured_text, w.licence_note ?? ""]) expect(v).not.toMatch(/<|>/);
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
  const held = (id: string) => ({ id, request_id: id, kind: "footage", adapter: "commons", file: `${id}.jpg` });
  const requestsFor = (ids: string[]) => ({ issue: 33, requests: ids.map((id) => ({ id, kind: "footage", for: "week-day-5", candidates: [{ adapter: "x", ref: "1", tier: 1 }], not_fetched: [] })) });

  it("tries the named request's whole ladder again; others stay held without a lookup", async () => {
    const ledger = { ...emptyLedger(33), items: [held("a"), held("b")] };
    const seen: string[] = [];
    const adapters = { x: { lookup: async () => (seen.push("x"), { status: "not_found", reason: "gone" }) } };
    const { report } = await fetchRequests(requestsFor(["a", "b"]), ledger, { adapters, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, redo: ["a"] });
    expect(seen).toEqual(["x"]);
    expect(report.find((r: { request: string }) => r.request === "b").outcome).toBe("held");
  });

  it("keeps the held item, in its place, with its rejected and dropped records, when the refill fills nothing", async () => {
    const before = { ...emptyLedger(33), items: [held("a"), held("b")], rejected: [{ request_id: "a", adapter: "y", ref: "old", reasons: ["earlier"] }] };
    const adapters = { x: { lookup: async () => ({ status: "not_found", reason: "gone" }) } };
    for (const dryRun of [true, false]) {
      const { ledger: out, report } = await fetchRequests(requestsFor(["a", "b"]), before, { adapters, http: {}, mediaDir: "unused", checkedBy: "t", dryRun, redo: ["a"] });
      expect(out.items, `dryRun ${dryRun}`).toEqual(before.items);
      expect(out.rejected).toEqual(before.rejected);
      expect(out.dropped ?? []).toEqual([]);
      const a = report.find((r: { request: string }) => r.request === "a");
      expect(a.outcome).toBe("held");
      expect(a.detail).toMatch(/filled nothing.*kept/);
    }
  });

  it("replaces the held item in its place when the refill passes, and never deletes the held file on a refusal", async () => {
    const { mkdtempSync, writeFileSync, existsSync, readFileSync: read } = await import("node:fs");
    const os = await import("node:os");
    const dir = mkdtempSync(path.join(os.tmpdir(), "omnibus-redo-"));
    writeFileSync(path.join(dir, "a.jpg"), "held");
    const cand = { adapter: "x", ref: "1", kind_hint: "footage", title: "T", item_url: "https://commons.wikimedia.org/wiki/File:A.jpg", media_url: "https://upload.wikimedia.org/a.jpg", licence: "cc0-1.0", licence_raw: "CC0", basis: "CC0", credit: "C", evidence: { url: "https://commons.wikimedia.org/wiki/File:A.jpg", captured_text: "CC0", captured_at: AT }, date: "2026-11-05", published_at: "2026-11-05T00:00:00Z", ai_fields_checked: ["title"], keywords: [], categories: [] };
    const adapters = { x: { lookup: async () => ({ status: "ok", candidate: cand }) } };
    // The new file is refused (its sha256 differs from the pinned one): the held file must survive.
    const http = { getMedia: async (_u: string, dest: string) => (writeFileSync(dest, "new"), { status: "ok", sha256: "0".repeat(64), sha1: "x", bytes: 3, mime: "image/jpeg" }) };
    const reqs = requestsFor(["a", "b"]);
    reqs.requests[0].candidates[0] = { ...reqs.requests[0].candidates[0], sha256: "f".repeat(64) } as never;
    const before = { ...emptyLedger(33), items: [held("a"), held("b")] };
    const { ledger: out } = await fetchRequests(reqs, before, { adapters, http, mediaDir: dir, checkedBy: "t", now: () => new Date(AT), redo: ["a"] });
    expect(out.items).toEqual(before.items);
    expect(read(path.join(dir, "a.jpg"), "utf8")).toBe("held");
    expect(existsSync(path.join(dir, "a.jpg.redo"))).toBe(false);
  });

  it("refuses a redo id that names no request", async () => {
    const requests = { issue: 33, requests: [] };
    await expect(fetchRequests(requests, emptyLedger(33), { adapters: {}, http: {}, mediaDir: null, checkedBy: "t", dryRun: true, redo: ["nope"] })).rejects.toThrow(/nope/);
  });
});

describe("E5c review: broadcasters, the pool, booleans and nested status fields", () => {
  const status = (over: Record<string, unknown>) => dvids.parseDvids({ results: { ...base(), ...over } }, { ref: "video:1", capturedAt: AT }).candidate;
  it("refuses a network or the press pool as author, even under a DoD unit", () => {
    for (const name of ["CNN", "Fox News", "NBC", "ABC News", "CBS", "C-SPAN", "Pool", "White House pool"]) {
      expect(status({ unit_name: "DoD", credit: [{ name, rank: "" }] }).licence, name).toBeNull();
    }
    const pooled = status({ unit_name: "DoD", credit: [{ name: "Pool", rank: "" }] });
    expect(pooled.licence_note).toMatch(/third party/);
    expect(status({ unit_name: "DoD", description: "The Secretary speaks. (Pool video)" }).licence).toBeNull();
  });
  it("refuses a closing attribution that names no US body and no third party", () => {
    const c = status({ description: "A briefing is held. (Video by Jane Roe)" });
    expect(c.licence).toBeNull();
    expect(c.licence_note).toMatch(/attribution "Video by Jane Roe" names no US body/);
  });
  it("passes a boolean false status field (no restriction stated) and refuses true", () => {
    expect(status({ restricted: false }).licence).toBe("pd-us-federal");
    expect(status({ restricted: true }).licence).toBeNull();
  });
  it("scans nested fields: files[].license and credit[].copyright refuse the item", () => {
    const files = base().files.map((f: Record<string, unknown>, i: number) => (i === 0 ? { ...f, license: "CC BY-NC" } : f));
    const a = status({ files });
    expect(a.licence).toBeNull();
    expect(a.licence_note).toMatch(/files\[0\]\.license/);
    const b = status({ credit: [{ id: 1, name: "Daniel Proper", rank: "Staff Sgt.", copyright: "Jane Roe 2026" }] });
    expect(b.licence).toBeNull();
    expect(b.licence_note).toMatch(/credit\[0\]\.copyright/);
    expect(status({ files: base().files.map((f: Record<string, unknown>) => ({ ...f, restricted: false })) }).licence).toBe("pd-us-federal");
    expect(dvids.statusFields({ a: { b: [{ licence: "x" }] } })).toEqual([["a.b[0].licence", "x"]]);
  });
});

describe("E5c review: the licence evidence is the public page a claimant can read", () => {
  it("reads the recorded page: PUBLIC DOMAIN, credit line, unit, VIRIN and the restrictions line", () => {
    expect(PAGE()).toEqual({
      title: "SECWAR Hegseth delivers message from the Pentagon",
      public_domain: "PUBLIC DOMAIN",
      byline: "Video by Staff Sgt. Daniel Proper",
      unit: "Office of the Secretary of War Public Affairs",
      virin: "261105-A-LE512-1001",
      restrictions: "This work, SECWAR Hegseth delivers message from the Pentagon, by SSG Daniel Proper, identified by DVIDS, must comply with the restrictions shown on https://www.dvidshub.net/about/copyright.",
    });
  });

  it("quotes the page as the evidence, keeps the API read (key removed) second, and carries the DoW disclosure", () => {
    const c = withPage(parse("dvids-asset-video-1028785.json", "video:1028785"));
    expect(c.licence).toBe("pd-us-federal");
    expect(c.evidence.url).toBe("https://www.dvidshub.net/video/1028785");
    for (const q of ['"PUBLIC DOMAIN"', '"Video by Staff Sgt. Daniel Proper"', '"Office of the Secretary of War Public Affairs"', '"261105-A-LE512-1001"', "must comply with the restrictions shown on https://www.dvidshub.net/about/copyright"]) {
      expect(c.evidence.captured_text).toContain(q);
    }
    expect(c.evidence_also).toHaveLength(1);
    expect(c.evidence_also[0].url).toBe("https://api.dvidshub.net/asset?id=video:1028785");
    expect(c.evidence_also[0].captured_text).toMatch(/API asset record/);
    expect(JSON.stringify(c)).not.toMatch(/api_key/);
    expect(c.disclosure).toBe("The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.");
    expect(c.basis).toMatch(/public DVIDS page marks it PUBLIC DOMAIN/);
    expect(c).not.toHaveProperty("dvids");
    expect(c).not.toHaveProperty("api_evidence");
  });

  it("refuses when the page cannot be read, lacks a line, or disagrees with the API record", () => {
    const c = parse("dvids-asset-video-1028785.json", "video:1028785");
    const unread = dvids.withPublicPage(c, null, { capturedAt: AT, unread: "answered 403" });
    expect(unread.licence).toBeNull();
    expect(unread.evidence).toBeNull();
    expect(unread.licence_note).toMatch(/could not be read \(answered 403\)/);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ public_domain: null }, /PUBLIC DOMAIN/],
      [{ restrictions: null }, /restrictions shown/],
      [{ restrictions: "This work is copyrighted by Jane Roe." }, /restrictions shown/],
      [{ virin: "261105-A-XX000-0000" }, /VIRIN/],
      [{ unit: "Natochannel" }, /unit/],
      [{ byline: "Video by John Smith" }, /does not name Daniel Proper/],
      [{ byline: "Courtesy Video by Staff Sgt. Daniel Proper" }, /another status or a third party/],
      [{ byline: "Video by Staff Sgt. Daniel Proper and CNN" }, /third party/],
      [{ byline: null }, /no credit line/],
    ];
    for (const [over, why] of cases) {
      const r = withPage(c, { ...PAGE(), ...over });
      expect(r.licence, JSON.stringify(over)).toBeNull();
      expect(r.licence_note, JSON.stringify(over)).toMatch(why);
    }
  });

  it("an item the API record refuses stays refused whatever the page says", () => {
    expect(withPage(parse("dvids-asset-video-1029004.json", "video:1029004")).licence).toBeNull();
  });

  it("a hostile page yields plain text only, and is refused", () => {
    const html = PAGE_HTML.replace("Staff Sgt. Daniel Proper</a>", `${XSS}</a>`).replace("Office of the Secretary of War Public Affairs</a>", `${XSS}</a>`).replace("261105-A-LE512-1001", XSS);
    const p = dvids.parsePublicPage(html);
    for (const v of Object.values(p)) expect(String(v ?? "")).not.toMatch(/<|>/);
    const r = withPage(parse("dvids-asset-video-1028785.json", "video:1028785"), p);
    expect(r.licence).toBeNull();
    expect(r.evidence.captured_text).not.toMatch(/<|>/);
  });

  it("lookup reads the API with the key and the public page without it", async () => {
    const asked: string[] = [];
    const http = {
      getJson: async (url: string) => (asked.push(url), { status: "ok", json: fx("dvids-asset-video-1028785.json").response, url }),
      getText: async (url: string) => (asked.push(url), { status: "ok", text: PAGE_HTML, url }),
    };
    const r = await dvids.lookup("video:1028785", { http, env: { DVIDS_API_KEY: "sekret" }, now: () => new Date(AT) });
    expect(asked[1]).toBe("https://www.dvidshub.net/video/1028785");
    expect(isAllowedUrl(asked[1])).toBe(true);
    expect(r.candidate.licence).toBe("pd-us-federal");
    expect(JSON.stringify(r)).not.toMatch(/sekret/);
    const failing = { ...http, getText: async () => { throw new Error("https://www.dvidshub.net/video/1028785?k=sekret answered 500"); } };
    const f = await dvids.lookup("video:1028785", { http: failing, env: { DVIDS_API_KEY: "sekret" }, now: () => new Date(AT) });
    expect(f.candidate.licence).toBeNull();
    expect(JSON.stringify(f)).not.toMatch(/sekret/);
  });
});

describe("E5c review: the ledger, the packet and the pins", () => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const ledger = JSON.parse(readFileSync(path.join(ROOT, "episodes", "33", "rights-ledger.json"), "utf8"));
  const packet = JSON.parse(readFileSync(path.join(ROOT, "episodes", "33", "disputes.json"), "utf8"));
  const pins = JSON.parse(readFileSync(path.join(ROOT, "episodes", "33", "asset-pins.json"), "utf8"));
  const day5 = ledger.items.find((i: { id: string }) => i.id === "e33-day5-pic");

  it("every DVIDS item in week 33 names its public page as the source read", () => {
    const items = ledger.items.filter((i: { adapter: string }) => i.adapter === "dvids");
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(dvidsEvidenceProblems(it), it.id).toEqual([]);
  });

  it("day 5's Hegseth video airs muted, with the reason, in the ledger and the packet", () => {
    expect(day5.audio).toEqual({ mode: "muted", reason: expect.stringMatching(/no counterpart.*says only what was printed/) });
    expect(packet.assets.find((a: { id: string }) => a.id === "e33-day5-pic").audio).toEqual(day5.audio);
  });

  it("the packet lists the DoW disclosure for the credits, and the dispute names the page and the API read", () => {
    expect(packet.credit_disclosures).toEqual([{ text: "The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.", assets: ["e33-day5-pic"] }]);
    const d = packet.assets.find((a: { id: string }) => a.id === "e33-day5-pic").dispute;
    expect(d).toMatch(/read at https:\/\/www\.dvidshub\.net\/video\/1028785 on .* \(its source record also, at https:\/\/api\.dvidshub\.net\/asset\?id=video:1028785 on/);
  });

  it("the recruitment promo (video:1028891) is no longer pinned", () => {
    expect(JSON.stringify(pins.pins["e33-day5-pic"])).not.toMatch(/1028891/);
  });

  it("the licence-evidence lint refuses a DVIDS item that names the API, lacks a part, or keeps a key", () => {
    const bad = { ...day5, licence_evidence: { ...day5.licence_evidence, url: "https://api.dvidshub.net/asset?id=video:1028785" } };
    expect(dvidsEvidenceProblems(bad).join(" ")).toMatch(/public page/);
    expect(dvidsEvidenceProblems({ ...day5, disclosure: undefined }).join(" ")).toMatch(/disclosure/);
    expect(dvidsEvidenceProblems({ ...day5, evidence_also: [] }).join(" ")).toMatch(/second evidence entry/);
    const keyed = { ...day5, evidence_also: [{ ...day5.evidence_also[0], url: "https://api.dvidshub.net/asset?id=video:1028785&api_key=sekret" }] };
    const found = lintLicenceEvidence({ ...emptyLedger(33), items: [keyed] }).map((x: { message: string }) => x.message).join(" ");
    expect(found).toMatch(/carries a key/);
    expect(found).not.toMatch(/sekret/);
  });
});
