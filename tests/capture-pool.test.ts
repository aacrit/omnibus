// C7: the weekly pool and the candidate pins it becomes. Acceptance: week 33's pool, built from the week 33 replay
// (the White House's Commons category and the DVIDS Hegseth search, captured at the schedule's run times), becomes
// episodes/33/candidates/capture.json with no mergeCandidatePins problem, and goes through the resolver with its
// automatic fit intact; the ledger carries fit.auto, and a final render refuses it until confirmed (pytest
// studio/tests/test_c7_capture_fit.py).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadChannels, selectItems } from "../scripts/capture/relevance.mjs";
import { CATEGORIES, parseCategory } from "../scripts/capture/listers/commons.mjs";
import { parseSearch } from "../scripts/capture/listers/dvids.mjs";
import { INDEX_KEY, emptyIndex, planPut, readIndex, serialiseIndex, sourceId, sweep } from "../scripts/lib/capture-store.mjs";
import { applyPins, pinCaptured, pinRequestKey, readPinRequests } from "../scripts/capture-r2.mjs";
import { AUTO_WHY, POOL_SCHEMA, buildPool, candidatesFromPool, kindOf, poolKey, poolProblems, unconfirmedFit, weekStories } from "../scripts/capture/pool.mjs";
import { CANDIDATES_SCHEMA_ID, mergeCandidatePins, pinProblems, resolveRequests } from "../scripts/lib/rights/resolve.mjs";
import { fitRecord } from "../scripts/lib/rights/fetcher.mjs";
import { capturedSids, writeCaptureCandidates } from "../scripts/rights.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (p: string) => JSON.parse(readFileSync(path.join(root, "tests/fixtures", p), "utf8"));
const channels = loadChannels();
const editions = fixture("capture/week33-editions.json").editions;
const record = JSON.parse(readFileSync(path.join(root, "data/week-33.json"), "utf8"));
const rundown = JSON.parse(readFileSync(path.join(root, "episodes/33/rundown.json"), "utf8"));
const hex = (s: string) => createHash("sha256").update(s).digest("hex");
const MILLER = "File:White House Chief of Staff, Stephen Miller.webm";

const listed = [
  ...parseCategory(fixture("capture/commons-wh-week33.json").response, { category: CATEGORIES[0], capturedAt: "2026-11-13T00:00:00Z" }),
  ...parseSearch(fixture("rights/dvids-search-hegseth.json").response, { capturedAt: "2026-11-13T00:00:00Z" }),
];

/** The week replayed at the schedule's run times: every item a run selects enters the index (metadata, an ok verdict). */
function replayIndex() {
  let index = emptyIndex();
  for (let d = 2; d <= 9; d++) {
    for (const hm of ["05:23", "13:11", "21:41"]) {
      const at = `2026-11-${String(d).padStart(2, "0")}T${hm}:00Z`;
      const seen = listed.filter((i: any) => Date.parse(i.published_at) <= Date.parse(at));
      for (const s of selectItems(seen, { editions, channels, now: at })) {
        if (!s.capture || index.items[sourceId(s.item)]) continue;
        const record = { captured_at: at, published_at: s.item.published_at, source_time: s.item.event_date ?? null, page: { sha256: hex(s.item.id) }, terms: { sha256: hex("terms") }, verdict: { status: "ok", licence: "pd-us-federal" } };
        index = planPut({ index, item: { ...s.item, captured_at: at }, evidence: { record, blobs: [{ sha256: hex(s.item.id), gz: Buffer.from("x"), kind: "page", url: s.item.url }] }, now: at }).index;
      }
    }
  }
  return index;
}

const index = replayIndex();
const pool = buildPool({ issue: 33, record, index, editions, channels, now: "2026-11-09T05:23:00Z", from: "data/week-33.json" });

describe("the week 33 pool", () => {
  it("holds the lead, the seven day leads and the margins, each with its window and scored items", () => {
    expect(poolProblems(pool)).toEqual([]);
    expect(pool.schema).toBe(POOL_SCHEMA);
    expect(poolKey(33)).toBe("capture/weekly/33/pool.json");
    expect(pool.stories.map((s: any) => s.key)).toEqual(["lead", "day-1", "day-2", "day-3", "day-4", "day-5", "day-6", "day-7", "margin-1", "margin-2", "margin-3"]);
    const day6 = pool.stories.find((s: any) => s.key === "day-6");
    expect(day6.cluster_id).toBe("225f5760-42f1-4c4e-954f-fad95ea7d6e4");
    expect(day6.window).toEqual({ from: "2026-11-06T00:00:00Z", to: "2026-11-08T00:00:00Z" });
    const m = day6.items.find((i: any) => i.id === MILLER);
    expect(m).toMatchObject({ kind: "footage", source: "commons", verdict: { status: "ok" }, published_at: expect.stringMatching(/^2026-11-06T22:/) });
    expect(m.score).toBeGreaterThanOrEqual(channels.capture_at);
    expect(m.evidence_keys[0]).toMatch(/^capture\/evidence\/[0-9a-f]{64}\.gz$/);
    const day5 = pool.stories.find((s: any) => s.key === "day-5");
    expect(day5.items.some((i: any) => /hegseth/i.test(i.title))).toBe(true);
    expect(pool.stories.find((s: any) => s.key === "lead").cluster_ids).toContain("2ec1fcb8-3848-4809-9858-f5c309af2a0a");
  });

  it("refuses a record for another issue, and knows a video, a still and a locator", () => {
    expect(() => buildPool({ issue: 34, record, index, editions, channels, now: "2026-11-09T05:23:00Z" })).toThrow(/issue 33, not 34/);
    expect(kindOf({ id: "video:1028891" })).toBe("footage");
    expect(kindOf({ id: "File:A.jpg" })).toBe("still");
    expect(kindOf({ id: "https://www.whitehouse.gov/videos/x/", source: "whitehouse" })).toBeNull();
    expect(weekStories(record).filter((s: any) => s.role === "day")).toHaveLength(7);
  });
});

describe("rights.mjs candidates 33", () => {
  it("maps the pool onto the rundown by cluster id with no merge problem, every fit automatic", () => {
    const { doc, problems } = candidatesFromPool(pool, rundown, { now: "2026-11-16T10:00:00Z" });
    expect(problems).toEqual([]);
    expect(doc).toMatchObject({ schema: CANDIDATES_SCHEMA_ID, issue: 33, source: "capture" });
    const ids = new Set((rundown.asset_requests ?? []).map((r: any) => r.id));
    const merged = mergeCandidatePins({}, [{ name: "capture.json", doc }], { issue: 33, requestIds: ids });
    expect(merged.problems).toEqual([]);
    expect(pinProblems(merged.pins)).toEqual([]);
    const day6 = doc.pins["e33-day6-pic"];
    expect(day6[0]).toMatchObject({ adapter: "commons", ref: MILLER, tier: 2, window: { from: "2026-11-06", to: "2026-11-07T17:30:11.094818+00:00" }, fit: { beat: "week-day-6", auto: true, horizon: "2026-11-07T17:30:11.094818+00:00" } });
    expect(day6[0].fit.why.startsWith(AUTO_WHY)).toBe(true);
    for (const list of Object.values(doc.pins) as any[]) for (const p of list) expect(unconfirmedFit(p.fit)).toMatch(/confirmed_by/);
    // Only footage and still requests take pins; documents, sound and own pages never do.
    for (const id of Object.keys(doc.pins)) expect(["footage", "still"]).toContain(rundown.asset_requests.find((r: any) => r.id === id).kind);
  });

  it("goes through the resolver with its automatic fit, and the ledger keeps fit.auto and confirmed_by", async () => {
    const { doc } = candidatesFromPool(pool, rundown);
    const ids = new Set((rundown.asset_requests ?? []).map((r: any) => r.id));
    const { pins } = mergeCandidatePins({}, [{ name: "capture.json", doc }], { issue: 33, requestIds: ids });
    const http = { getJson: async () => ({ status: "not_found" }), getText: async () => ({ status: "not_found" }) };
    const assets = await resolveRequests(rundown, { pins, http, env: {} });
    const c = assets.requests.find((r: any) => r.id === "e33-day6-pic").candidates.find((x: any) => x.ref === MILLER);
    expect(c).toMatchObject({ adapter: "commons", tier: 2, pinned: true, fit: { auto: true } });
    const req = { id: "e33-day6-pic", for: "week-day-6", kind: "footage" };
    expect(fitRecord(c.fit, req)).toMatchObject({ beat: "week-day-6", auto: true });
    expect(fitRecord({ ...c.fit, why: "Miller at the podium, 0 to 33 s", confirmed_by: "CoS session" }, req)).toMatchObject({ auto: true, confirmed_by: "CoS session" });
    expect(unconfirmedFit({ ...c.fit, why: "Miller at the podium, 0 to 33 s", confirmed_by: "CoS session" })).toBeNull();
  });

  it("writes episodes/<n>/candidates/capture.json, and refuses a pool that does not map", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "omnibus-candidates-"));
    mkdirSync(path.join(tmp, "episodes", "33"), { recursive: true });
    copyFileSync(path.join(root, "episodes/33/rundown.json"), path.join(tmp, "episodes/33/rundown.json"));
    const { out } = writeCaptureCandidates({ root: tmp, issue: 33, pool, now: new Date("2026-11-16T10:00:00Z") });
    expect(out).toBe(path.join(tmp, "episodes", "33", "candidates", "capture.json"));
    expect(JSON.parse(readFileSync(out, "utf8")).pins["e33-day6-pic"][0].ref).toBe(MILLER);
    const wrongLead = { ...pool, stories: pool.stories.map((s: any) => (s.key === "lead" ? { ...s, cluster_ids: ["00000000"] } : s)) };
    expect(() => writeCaptureCandidates({ root: tmp, issue: 33, pool: wrongLead })).toThrow(/lead clusters/);
    expect(() => writeCaptureCandidates({ root: tmp, issue: 34, pool })).toThrow(/issue 33, not 34/);
    rmSync(tmp, { recursive: true, force: true });
    expect(existsSync(path.join(root, "episodes/33/candidates/capture.json"))).toBe(false);
  });
});

describe("pinning what candidates names (review of cap/c6-c7)", () => {
  const T0 = "2026-11-07T21:41:00Z";
  const day15 = new Date(Date.parse(T0) + 15 * 86_400_000);
  const ev = (id: string) => ({ record: { captured_at: T0, published_at: "2026-11-06T22:50:00Z", page: { sha256: hex(id) }, terms: { sha256: hex("terms") }, verdict: { status: "ok", licence: "pd-us-federal" } }, blobs: [{ sha256: hex(id), gz: Buffer.from(id), kind: "page", url: "u" }] });
  const withMedia = () => {
    let idx = emptyIndex();
    for (const [id, m] of [[MILLER, "m"], ["File:Other.webm", "o"]]) {
      idx = planPut({ index: idx, item: { source: "commons", id, url: "u", title: id }, evidence: ev(id), media: { sha256: hex(m), ext: "webm", bytes: 10 }, now: T0 }).index;
    }
    return idx;
  };
  const memStore = (conditionalWins: boolean) => {
    const o = new Map<string, { body: string; etag: string }>();
    let n = 0;
    return {
      o,
      conditional: true,
      get: (k: string) => o.get(k)?.body ?? null,
      getWithEtag: (k: string) => ({ text: o.get(k)?.body ?? null, etag: o.get(k)?.etag ?? null }),
      put: (k: string, b: any) => void o.set(k, { body: String(b), etag: `e${n++}` }),
      putIfMatch(k: string, b: any, etag: string | null) {
        if (!conditionalWins || (o.get(k)?.etag ?? null) !== etag) return false;
        o.set(k, { body: String(b), etag: `e${n++}` });
        return true;
      },
      delete: (k: string) => void o.delete(k),
      list: (p: string) => [...o.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key, size: o.get(key)!.body.length })),
    };
  };
  const millerSid = `commons:${MILLER}`;
  const doc = { pins: { "e33-day6-pic": [{ capture: { sid: millerSid } }], "e33-day5-pic": [{ capture: { sid: millerSid } }, { capture: {} }] } };

  it("names each captured sid once", () => {
    expect(capturedSids(doc)).toEqual([millerSid]);
  });

  it("pins the index at once on a conditional store, and the pinned item survives the sweep at day 15", () => {
    const store = memStore(true);
    store.put(INDEX_KEY, serialiseIndex(withMedia()));
    const r = pinCaptured({ store, issue: 33, sids: capturedSids(doc), airsOn: "2026-11-20", now: () => new Date(T0) });
    expect(r).toMatchObject({ pinned_now: true, missing: [] });
    const idx = readIndex(store.get(INDEX_KEY));
    expect(idx.items[millerSid].pinned).toEqual({ issue: 33, airs_on: "2026-11-20" });
    const swept = sweep({ index: idx, now: day15 });
    expect(swept.index.items[millerSid].media).not.toBeNull();
    expect(swept.index.items["commons:File:Other.webm"].media).toBeNull();
    expect(swept.deletes).toEqual([`capture/media/${hex("o")}.webm`]);
  });

  it("when the index write loses every race, the pin request is applied by the next capture run before it sweeps", () => {
    const store = memStore(false);
    store.put(INDEX_KEY, serialiseIndex(withMedia()));
    const r = pinCaptured({ store, issue: 33, sids: [millerSid, "commons:File:Gone.webm"], now: () => new Date(T0) });
    expect(r.pinned_now).toBe(false);
    expect(readIndex(store.get(INDEX_KEY)).items[millerSid].pinned).toBeNull();
    expect(store.get(pinRequestKey(33))).toMatch(/omnibus\.capture-pins\/1/);
    const { index, missing } = applyPins(readIndex(store.get(INDEX_KEY)), readPinRequests(store));
    expect(missing).toEqual(["commons:File:Gone.webm"]);
    expect(sweep({ index, now: day15 }).index.items[millerSid].media).not.toBeNull();
  });

  it("a capture run applies the pin requests it finds before its sweep", async () => {
    const { runCapture } = await import("../scripts/capture/run.mjs");
    const store = memStore(false);
    store.put(INDEX_KEY, serialiseIndex(withMedia()));
    pinCaptured({ store, issue: 33, sids: [millerSid], now: () => new Date(T0) });
    const base = mkdtempSync(path.join(os.tmpdir(), "omnibus-pin-run-"));
    await runCapture({ store, mode: "r2", outDir: path.join(base, "o"), workDir: path.join(base, "w"), editions, now: () => day15, env: {}, listers: { voa: async () => ({ source: "voa", items: [], skipped: null }) }, log: () => {} });
    const idx = readIndex(store.get(INDEX_KEY));
    expect(idx.items[millerSid]).toMatchObject({ pinned: { issue: 33, airs_on: null }, media: { ext: "webm" } });
    expect(idx.items["commons:File:Other.webm"].media).toBeNull();
    rmSync(base, { recursive: true, force: true });
  });
});
