import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as commons from "../scripts/lib/rights/adapters/commons.mjs";
import * as dvids from "../scripts/lib/rights/adapters/dvids.mjs";
import * as loc from "../scripts/lib/rights/adapters/loc.mjs";
import * as nasa from "../scripts/lib/rights/adapters/nasa.mjs";
import { PLACEMENT_PENDING, buildDisputePacket, serialisePacket } from "../scripts/lib/rights/disputes.mjs";
import { fetchRequests, mediaFileName } from "../scripts/lib/rights/fetcher.mjs";
import { FETCH_HOSTS, RefusedHost, USER_AGENT, getJson, getMedia } from "../scripts/lib/rights/http.mjs";
import { validate } from "../scripts/lib/rights/json-schema.mjs";
import { LEDGER_SCHEMA, emptyLedger, serialiseLedger, validateLedger, validateRequests } from "../scripts/lib/rights/ledger.mjs";
import { evidenceMarker, lintAiGeneratedShareZero, lintEpisode, lintLicenceAllowlist, lintLicenceEvidence } from "../scripts/lib/rights/lints.mjs";
import { lintRepo } from "../scripts/lint-rights.mjs";
import { assertMediaOutsideRepo, runFetch } from "../scripts/rights.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AT = "2026-11-12T10:00:00Z";
const now = () => new Date(AT);
const XSS = '"><img src=x onerror=alert(1)>';
const fx = (name: string) => JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "rights", name), "utf8"));
const FIXTURES = [
  "commons-cc-by-sa-2.0.json",
  "commons-cc-by-2.0.json",
  "commons-pd-nasa.json",
  "commons-ai-own-work.json",
  "commons-user-ai-uploader.json",
  "commons-missing.json",
  "nasa-search-as11-40-5903.json",
  "nasa-asset-as11-40-5903.json",
  "loc-item-2017762891.json",
];

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "omnibus-rights-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

/**
 * An http double: metadata from the recorded fixtures; media as a few fake
 * bytes written to disk, reporting the size and sha1 the source states (as
 * the real server's bytes would), so no media is ever fetched.
 */
function fakeHttp() {
  const byUrl = new Map(FIXTURES.map((n) => [fx(n)._recorded.url, fx(n).response]));
  const commonsFacts = new Map<string, { sha1: string; size: number }>();
  for (const n of FIXTURES.filter((x) => x.startsWith("commons-") && !x.includes("user") && !x.includes("missing"))) {
    const ii = fx(n).response.query.pages[0].imageinfo[0];
    commonsFacts.set(String(ii.url).split("?")[0], { sha1: ii.sha1, size: ii.size });
  }
  const media: string[] = [];
  return {
    media,
    getJson: async (url: string) => {
      if (!byUrl.has(url)) throw new Error(`no fixture for ${url}`);
      return { status: "ok", json: byUrl.get(url), url };
    },
    getMedia: async (url: string, dest: string) => {
      media.push(url);
      const bytes = Buffer.from(`fake media for ${url}`);
      writeFileSync(dest, bytes);
      const facts = commonsFacts.get(url);
      return {
        status: "ok",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sha1: facts?.sha1 ?? createHash("sha1").update(bytes).digest("hex"),
        bytes: facts?.size ?? bytes.length,
        mime: "image/jpeg",
        url,
      };
    },
  };
}

const adapters = { commons, nasa, loc, dvids };
const REQUESTS = {
  schema: "omnibus.asset-requests/1",
  issue: 32,
  requests: [
    {
      id: "S-MOON",
      kind: "still",
      candidates: [
        { adapter: "dvids", ref: "image:1", tier: 1 },
        { adapter: "commons", ref: "File:2023-03 AI images ZvD 01.png", tier: 2 },
        { adapter: "nasa", ref: "as11-40-5903", tier: 1 },
      ],
    },
    { id: "S-TOLEDO", kind: "still", candidates: [{ adapter: "commons", ref: "File:Spain-36 - Toledo (2218865210).jpg", tier: 3 }] },
    { id: "S-LANGE", kind: "still", candidates: [{ adapter: "loc", ref: "2017762891", tier: 3 }] },
    { id: "S-NONE", kind: "footage", candidates: [{ adapter: "commons", ref: "File:No such file omnibus T2 fixture.jpg", tier: 2 }] },
  ],
};

async function fetchAll(mediaDir = tmp()) {
  const http = fakeHttp();
  const out = await fetchRequests(REQUESTS, null, { adapters, http, mediaDir, checkedBy: "test", now, env: {} });
  return { ...out, http, mediaDir };
}

describe("fetcher: walks the ladder and records every refusal", () => {
  it("takes the first passing candidate per request, with sha256 and evidence", async () => {
    const { ledger, report, mediaDir } = await fetchAll();
    expect(report.map((r: any) => [r.request, r.outcome])).toEqual([
      ["S-MOON", "taken"],
      ["S-TOLEDO", "taken"],
      ["S-LANGE", "taken"],
      ["S-NONE", "unfilled"],
    ]);
    expect(validateLedger(ledger)).toEqual([]);
    const moon = ledger.items.find((i: any) => i.id === "S-MOON");
    expect(moon).toMatchObject({ adapter: "nasa", licence: "pd-us-federal", source_tier: 1, file: "S-MOON.jpg", rights_checked: { date: "2026-11-12", by: "test" } });
    expect(moon.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path.join(mediaDir, "S-MOON.jpg"))).toBe(true);
    const toledo = ledger.items.find((i: any) => i.id === "S-TOLEDO");
    expect(toledo).toMatchObject({ licence: "cc-by-sa-2.0", credit: "Dennis G. Jarvis, via Wikimedia Commons", laundering_check: { status: "clear" } });
    expect(toledo.ai_provenance_check).toMatchObject({ status: "clear", method: "metadata", vision: "pending" });
  });

  it("keeps DVIDS's skip, the AI refusal and the missing file in the rejected list", async () => {
    const { ledger } = await fetchAll();
    const byRef = Object.fromEntries(ledger.rejected.map((r: any) => [r.ref, r.reasons.join(" | ")]));
    expect(byRef["image:1"]).toMatch(/DVIDS_API_KEY/);
    expect(byRef["File:2023-03 AI images ZvD 01.png"]).toMatch(/AI-generated/);
    expect(byRef["File:No such file omnibus T2 fixture.jpg"]).toBe("not found at the source");
  });

  it("refuses a download whose sha1 differs from the source's and deletes it", async () => {
    const http = fakeHttp();
    const real = http.getMedia;
    http.getMedia = async (url: string, dest: string) => ({ ...(await real(url, dest)), sha1: "0".repeat(40) });
    const mediaDir = tmp();
    const req = { ...REQUESTS, requests: [REQUESTS.requests[1]] };
    const { ledger } = await fetchRequests(req, null, { adapters, http, mediaDir, checkedBy: "test", now, env: {} });
    expect(ledger.items).toEqual([]);
    expect(ledger.rejected[0].reasons[0]).toMatch(/sha1/);
    expect(existsSync(path.join(mediaDir, "S-TOLEDO.jpg"))).toBe(false);
  });

  it("refuses a media address off the domain allowlist", async () => {
    const http = fakeHttp();
    const bad = { ...nasa, lookup: async (ref: string, ctx: any) => {
      const r = await nasa.lookup(ref, ctx);
      return { ...r, candidate: { ...r.candidate, media_url: "https://images.pexels.com/photos/1.jpeg" } };
    } };
    const req = { ...REQUESTS, requests: [{ id: "S-X", kind: "still", candidates: [{ adapter: "nasa", ref: "as11-40-5903", tier: 1 }] }] };
    const { ledger } = await fetchRequests(req, null, { adapters: { ...adapters, nasa: bad }, http, mediaDir: tmp(), checkedBy: "test", now, env: {} });
    expect(ledger.items).toEqual([]);
    expect(ledger.rejected[0].reasons.join(" ")).toMatch(/domain allowlist/);
    expect(ledger.rejected[0].reasons.join(" ")).toMatch(/pexels/);
  });

  it("refuses a still for a footage request", async () => {
    const req = { ...REQUESTS, requests: [{ id: "F-1", kind: "footage", candidates: [{ adapter: "nasa", ref: "as11-40-5903", tier: 1 }] }] };
    const { ledger } = await fetchRequests(req, null, { adapters, http: fakeHttp(), mediaDir: tmp(), checkedBy: "test", now, env: {} });
    expect(ledger.rejected[0].reasons[0]).toMatch(/holds a still, and the request is for footage/);
  });

  it("dry run downloads nothing", async () => {
    const http = fakeHttp();
    const { ledger, report } = await fetchRequests(REQUESTS, null, { adapters, http, mediaDir: null, checkedBy: "test", now, env: {}, dryRun: true });
    expect(http.media).toEqual([]);
    expect(ledger.items).toEqual([]);
    expect(report[0]).toMatchObject({ request: "S-MOON", outcome: "would take" });
  });

  it("holds a filled request on the next run and fetches nothing again", async () => {
    const { ledger } = await fetchAll();
    const http = fakeHttp();
    const again = await fetchRequests(REQUESTS, ledger, { adapters, http, mediaDir: tmp(), checkedBy: "test", now, env: {} });
    expect(http.media).toEqual([]);
    expect(again.report.filter((r: any) => r.outcome === "held")).toHaveLength(3);
    expect(again.ledger.items).toHaveLength(3);
  });

  it("names files by request id and the source's extension", () => {
    expect(mediaFileName("S-1", "https://upload.wikimedia.org/a/b/X.JPEG")).toBe("S-1.jpg");
    expect(mediaFileName("S-1", "https://tile.loc.gov/x/y.tif")).toBe("S-1.tif");
    expect(mediaFileName("S-1", "https://x/y")).toBe("S-1.bin");
  });
});

describe("rights ledger schema", () => {
  it("accepts what the fetcher writes and rejects every missing required field", async () => {
    const { ledger } = await fetchAll();
    expect(validateLedger(ledger)).toEqual([]);
    for (const field of LEDGER_SCHEMA.$defs.item.required) {
      const bad = structuredClone(ledger);
      delete bad.items[0][field];
      expect(validateLedger(bad).join(" "), field).toMatch(new RegExp(`missing ${field}`));
    }
  });

  it("rejects unknown fields, a local path as the file, a bad sha256, a tier off the ladder", async () => {
    const { ledger } = await fetchAll();
    const cases: Array<[string, (it: any) => void, RegExp]> = [
      ["unknown field", (it) => (it.extra = 1), /unknown field extra/],
      ["local path", (it) => (it.file = "D:/omnibus-media/32/S-MOON.jpg"), /\.file: does not match/],
      ["sha256", (it) => (it.sha256 = "abc"), /\.sha256: does not match/],
      ["tier 0", (it) => (it.source_tier = 0), /below 1/],
      ["tier 6", (it) => (it.source_tier = 6), /above 5/],
      ["http evidence", (it) => (it.licence_evidence.url = "http://x"), /licence_evidence\.url/],
      ["evidence time", (it) => (it.licence_evidence.captured_at = "yesterday"), /captured_at/],
      ["ai status", (it) => (it.ai_provenance_check.status = "probably fine"), /must be one of clear, flagged/],
      ["checked by", (it) => (it.rights_checked.by = ""), /shorter than 1/],
    ];
    for (const [name, mutate, re] of cases) {
      const bad = structuredClone(ledger);
      mutate(bad.items[0]);
      expect(validateLedger(bad).join(" "), name).toMatch(re);
    }
  });

  it("rejects a duplicate id and a rights check dated before its evidence", async () => {
    const { ledger } = await fetchAll();
    const dup = structuredClone(ledger);
    dup.items.push(structuredClone(dup.items[0]));
    expect(validateLedger(dup).join(" ")).toMatch(/duplicate id/);
    const early = structuredClone(ledger);
    early.items[0].rights_checked.date = "2026-11-01";
    expect(validateLedger(early).join(" ")).toMatch(/before the evidence was captured/);
  });

  it("the validator refuses a schema keyword it does not implement", () => {
    expect(() => validate({ type: "string", format: "date" }, "x")).toThrow(/unsupported keyword "format"/);
  });

  it("validates asset requests", () => {
    expect(validateRequests(REQUESTS)).toEqual([]);
    expect(validateRequests({ ...REQUESTS, requests: [{ id: "a b", kind: "gif", candidates: [{ adapter: "flickr", ref: "", tier: 9 }] }] })).toHaveLength(5);
  });
});

describe("dispute packet", () => {
  it("has, per asset, the source, evidence, sha256, empty in and out points, licence terms and a paragraph", async () => {
    const { ledger } = await fetchAll();
    const text = serialiseLedger(ledger);
    const packet = buildDisputePacket(ledger, text);
    expect(packet).toMatchObject({ schema: "omnibus.disputes/1", issue: 32, ledger_sha256: createHash("sha256").update(text).digest("hex") });
    expect(packet.assets).toHaveLength(3);
    for (const a of packet.assets) {
      const item = ledger.items.find((i: any) => i.id === a.id);
      expect(a).toMatchObject({ source_url: item.item_url, sha256: item.sha256, licence_evidence: item.licence_evidence, in_point: null, out_point: null, placement: PLACEMENT_PENDING });
      expect(a.licence.deed_url).toMatch(/^https:\/\//);
      expect(a.dispute).toContain(item.sha256);
      expect(a.dispute).toContain(item.item_url);
      expect(a.dispute).not.toMatch(/\u2014/);
    }
    const toledo = packet.assets.find((a: any) => a.id === "S-TOLEDO");
    expect(toledo.licence.name).toBe("CC BY-SA 2.0");
    expect(toledo.dispute).toMatch(/share-alike; the episode is itself published under CC BY-SA 4\.0/);
    expect(packet.assets.find((a: any) => a.id === "S-MOON").dispute).toMatch(/public domain: NASA Image and Video Library record/);
  });

  it("is deterministic and line-ending proof", async () => {
    const { ledger } = await fetchAll();
    const text = serialiseLedger(ledger);
    const a = serialisePacket(buildDisputePacket(ledger, text));
    expect(serialisePacket(buildDisputePacket(structuredClone(ledger), text.replace(/\n/g, "\r\n")))).toBe(a);
  });

  it("keeps a hostile title as data, never as markup it adds", async () => {
    const { ledger } = await fetchAll();
    ledger.items[0].title = XSS;
    const p = buildDisputePacket(ledger, serialiseLedger(ledger));
    expect(p.assets[0].title).toBe(XSS);
    expect(JSON.parse(serialisePacket(p)).assets[0].title).toBe(XSS);
  });
});

describe("rights lints", () => {
  async function episode() {
    const { ledger } = await fetchAll();
    const ledgerText = serialiseLedger(ledger);
    return { ledger, ledgerText, disputesText: serialisePacket(buildDisputePacket(ledger, ledgerText)), now: new Date(AT) };
  }

  it("a fetched episode passes every lint", async () => {
    expect(lintEpisode(await episode())).toEqual([]);
  });

  it("licence-allowlist blocks CC BY-NC, bare public domain and an agency credit", async () => {
    const { ledger } = await episode();
    ledger.items[1].licence = "cc-by-nc-2.0";
    ledger.items[0].licence = "Public domain";
    ledger.items[2].credit = "AP Photo/John Doe";
    const f = lintLicenceAllowlist(ledger);
    expect(f.map((x: any) => x.rule)).toEqual(["licence-allowlist", "licence-allowlist", "licence-allowlist"]);
    expect(f[0]).toMatchObject({ item: "S-MOON", message: expect.stringMatching(/needs its basis/) });
    expect(f[1]).toMatchObject({ item: "S-TOLEDO", message: expect.stringMatching(/"cc-by-nc-2\.0" is not on the allowlist/) });
    expect(f[2]).toMatchObject({ item: "S-LANGE", message: "denied source: AP material" });
  });

  it("licence-evidence blocks captured text that does not state the licence, and a suspect uploader", async () => {
    const { ledger } = await episode();
    const toledo = ledger.items.find((i: any) => i.id === "S-TOLEDO");
    toledo.licence_evidence.captured_text = "LicenseShortName: CC BY 2.0";
    toledo.laundering_check = { status: "suspect", findings: ["claimed as own work with no capture date"] };
    const f = lintLicenceEvidence(ledger, { now: new Date(AT) });
    expect(f.map((x: any) => x.message)).toEqual([
      "the captured licence text does not state cc-by-sa-2.0",
      "laundering suspicion: claimed as own work with no capture date",
    ]);
    expect(evidenceMarker("cc-by-2.0").test("CC BY-SA 2.0")).toBe(false);
    expect(evidenceMarker("cc-by-sa-2.0").test("Creative Commons Attribution-Share Alike 2.0")).toBe(true);
  });

  it("licence-evidence blocks evidence captured in the future", async () => {
    const { ledger } = await episode();
    expect(lintLicenceEvidence(ledger, { now: new Date("2026-11-01T00:00:00Z") }).length).toBeGreaterThan(0);
  });

  it("ai-generated-share-zero blocks any flagged item and any generated shot", async () => {
    const { ledger } = await episode();
    expect(lintAiGeneratedShareZero(ledger)).toEqual([]);
    ledger.items[0].ai_provenance_check = { ...ledger.items[0].ai_provenance_check, status: "flagged", findings: ["Images generated by Stable Diffusion"] };
    ledger.items[1].ai_provenance_check = { ...ledger.items[1].ai_provenance_check, vision: "flagged" };
    const f = lintAiGeneratedShareZero(ledger, { shots: [{ id: "sh-9", kind: "generated" }] });
    expect(f.map((x: any) => x.item)).toEqual(["S-MOON", "S-TOLEDO", "sh-9"]);
  });

  it("disputes-generated blocks a hand edit and a missing packet", async () => {
    const e = await episode();
    const edited = e.disputesText.replace("We are entitled", "We are surely entitled");
    expect(lintEpisode({ ...e, disputesText: edited }).map((x: any) => x.rule)).toEqual(["disputes-generated"]);
    expect(lintEpisode({ ...e, disputesText: null }).map((x: any) => x.rule)).toEqual(["disputes-generated"]);
    expect(lintEpisode({ ...e, disputesText: e.disputesText.replace(/\n/g, "\r\n") })).toEqual([]);
  });

  it("a schema failure is reported under its own rule before the others run", async () => {
    const e = await episode();
    delete e.ledger.items[0].sha256;
    expect(lintEpisode(e).map((x: any) => x.rule)).toEqual(["rights-ledger-schema"]);
  });
});

describe("the CLI and the gate step", () => {
  it("refuses a media directory inside the repo", () => {
    expect(() => assertMediaOutsideRepo(path.join(root, "media"), root)).toThrow(/inside the repo/);
    expect(() => assertMediaOutsideRepo(root, root)).toThrow(/inside the repo/);
    expect(() => assertMediaOutsideRepo("relative/dir", root)).toThrow(/absolute/);
    expect(() => assertMediaOutsideRepo(tmp(), root)).not.toThrow();
  });

  it("fetch writes the ledger and the packet, and the gate's lint passes them", async () => {
    const repo = tmp();
    const media = tmp();
    mkdirSync(path.join(repo, "episodes", "32"), { recursive: true });
    writeFileSync(path.join(repo, "episodes", "32", "assets.json"), JSON.stringify(REQUESTS));
    await runFetch({ root: repo, issue: 32, mediaDir: media, http: fakeHttp(), env: {}, now, log: () => {} });
    expect(existsSync(path.join(media, "32", "S-MOON.jpg"))).toBe(true);
    const lint = lintRepo(repo, { now: new Date(AT) });
    expect(lint).toMatchObject({ findings: [], ledgers: 1, items: 3 });
    const disputes = path.join(repo, "episodes", "32", "disputes.json");
    writeFileSync(disputes, readFileSync(disputes, "utf8").replace("released", "dropped"));
    expect(lintRepo(repo, { now: new Date(AT) }).findings.map((f: any) => f.rule)).toEqual(["disputes-generated"]);
  });

  it("fails a disputes.json with no ledger, and a ledger in the wrong folder", () => {
    const repo = tmp();
    mkdirSync(path.join(repo, "episodes", "33"), { recursive: true });
    writeFileSync(path.join(repo, "episodes", "33", "disputes.json"), "{}");
    mkdirSync(path.join(repo, "episodes", "34"), { recursive: true });
    const l = emptyLedger(35);
    writeFileSync(path.join(repo, "episodes", "34", "rights-ledger.json"), serialiseLedger(l));
    writeFileSync(path.join(repo, "episodes", "34", "disputes.json"), serialisePacket(buildDisputePacket(l, serialiseLedger(l))));
    expect(lintRepo(repo).findings.map((f: any) => `${f.where}:${f.rule}`)).toEqual(["episodes/33:disputes-generated", "episodes/34:rights-ledger-schema"]);
  });

  it("this repo's episodes pass (the gate runs the same check)", () => {
    expect(lintRepo(root).findings).toEqual([]);
  });

  it("the gate runs lint-rights", () => {
    expect(readFileSync(path.join(root, "scripts", "gate.mjs"), "utf8")).toMatch(/scripts\/lint-rights\.mjs/);
  });
});

describe("polite http with the domain allowlist", () => {
  const res = (status: number, body = "", headers: Record<string, string> = {}) => new Response(status === 204 || (status >= 300 && status < 400) ? null : body, { status, headers });

  it("sends the User-Agent, refuses hosts off the allowlist and plain http", async () => {
    const seen: any[] = [];
    const fetchImpl = async (url: string, init: any) => (seen.push([url, init.headers["user-agent"], init.redirect]), res(200, "{}"));
    await getJson("https://images-api.nasa.gov/search?nasa_id=x", { fetchImpl });
    expect(seen[0]).toEqual(["https://images-api.nasa.gov/search?nasa_id=x", USER_AGENT, "manual"]);
    await expect(getJson("https://www.pexels.com/x", { fetchImpl })).rejects.toBeInstanceOf(RefusedHost);
    await expect(getJson("http://commons.wikimedia.org/x", { fetchImpl })).rejects.toBeInstanceOf(RefusedHost);
    expect(FETCH_HOSTS).not.toContain("www.pexels.com");
  });

  it("refuses a redirect that leaves the allowlist", async () => {
    const fetchImpl = async () => res(302, "", { location: "https://evil.example/x.jpg" });
    await expect(getJson("https://www.loc.gov/item/1/?fo=json", { fetchImpl })).rejects.toThrow(/evil\.example/);
  });

  it("follows a redirect inside the allowlist", async () => {
    const fetchImpl = async (url: string) => (url.includes("images-api") ? res(301, "", { location: "https://images-assets.nasa.gov/a.json" }) : res(200, '{"ok":1}'));
    expect(await getJson("https://images-api.nasa.gov/a", { fetchImpl })).toMatchObject({ status: "ok", json: { ok: 1 }, url: "https://images-assets.nasa.gov/a.json" });
  });

  it("honours Retry-After on 429 and does not retry a 404", async () => {
    const waits: number[] = [];
    let n = 0;
    const fetchImpl = async () => (n++ === 0 ? res(429, "", { "retry-after": "7" }) : res(200, "{}"));
    await getJson("https://www.loc.gov/x", { fetchImpl, sleep: async (ms: number) => void waits.push(ms) });
    expect(waits).toEqual([7000]);
    let calls = 0;
    const notFound = async () => (calls++, res(404));
    expect(await getJson("https://www.loc.gov/x", { fetchImpl: notFound, sleep: async () => {} })).toMatchObject({ status: "not_found" });
    expect(calls).toBe(1);
  });

  it("streams media to disk with its sha256 and refuses past the byte cap", async () => {
    const dir = tmp();
    const body = "0123456789";
    const ok = await getMedia("https://upload.wikimedia.org/x.jpg", path.join(dir, "a.jpg"), { fetchImpl: async () => res(200, body, { "content-type": "image/jpeg" }) });
    expect(ok).toMatchObject({ status: "ok", bytes: 10, sha256: createHash("sha256").update(body).digest("hex"), mime: "image/jpeg" });
    expect(readFileSync(path.join(dir, "a.jpg"), "utf8")).toBe(body);
    await expect(getMedia("https://upload.wikimedia.org/x.jpg", path.join(dir, "b.jpg"), { fetchImpl: async () => res(200, body), maxBytes: 5 })).rejects.toThrow(/cap/);
    expect(existsSync(path.join(dir, "b.jpg"))).toBe(false);
    expect(existsSync(path.join(dir, "b.jpg.part"))).toBe(false);
  });
});
