// C6: one capture run end to end with every edge faked (listers, evidence, media, the store): what reaches the
// store, the artifact fallback's licence rule, the heartbeat written last, the DVIDS skip, the run that fails,
// the proxy addresses, the backfill from an artifact, the heartbeat route, and the workflow's own declarations.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { HEARTBEAT_KEY, LISTERS, latestWeeklyIssue, runCapture } from "../scripts/capture/run.mjs";
import { artifactMayHoldMedia, proxyCandidates } from "../scripts/capture/proxy.mjs";
import { backfillOne, dirStore, assertKey, contentType } from "../scripts/capture-r2.mjs";
import { INDEX_KEY, readIndex } from "../scripts/lib/capture-store.mjs";
import { poolKey } from "../scripts/capture/pool.mjs";
import { isAllowedUrl } from "../scripts/lib/rights/http.mjs";
import { CAPTURE_HEARTBEAT_KEY, CAPTURE_STALE_HOURS, handleCaptureHeartbeat, readCaptureHeartbeat } from "../worker/src/capture";
import { handle, type Env } from "../worker/src/index";
import { createMockAssets, createMockD1 } from "./helpers/mock-d1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editions = JSON.parse(readFileSync(path.join(root, "tests/fixtures/capture/week33-editions.json"), "utf8")).editions;
const AT = "2026-11-07T21:41:00Z";
const now = () => new Date(AT);
const hex = (s: string) => createHash("sha256").update(s).digest("hex");

function memStore() {
  const objects = new Map<string, string | Buffer>();
  const order: string[] = [];
  return {
    objects,
    order,
    get: (k: string) => (objects.has(k) ? String(objects.get(k)) : null),
    put: (k: string, b: string | Buffer) => (objects.set(k, b), order.push(k)),
    delete: (k: string) => objects.delete(k),
  };
}

const miller = { source: "commons", id: "File:White House Chief of Staff, Stephen Miller.webm", url: "https://commons.wikimedia.org/wiki/File:White_House_Chief_of_Staff,_Stephen_Miller.webm", title: "White House Chief of Staff, Stephen Miller", description: "", published_at: "2026-11-06T22:50:00Z", captured_at: AT };
const editorial = { source: "commons", id: "File:Stephen Miller briefing.webm", url: "https://commons.wikimedia.org/wiki/File:Stephen_Miller_briefing.webm", title: "Stephen Miller briefing on Susie Wiles", description: "", published_at: "2026-11-06T23:00:00Z", captured_at: AT };
const offTopic = { source: "commons", id: "File:Garden tour.webm", url: "https://commons.wikimedia.org/wiki/File:Garden_tour.webm", title: "A garden tour", description: "", published_at: "2026-11-06T12:00:00Z", captured_at: AT };

function fakeEvidence(licence: (id: string) => string | null) {
  return async (item: any) => {
    const page = `<html>${item.id}</html>`;
    const lic = licence(item.id);
    return {
      record: {
        schema: "omnibus.capture-evidence/1", source: item.source, id: item.id, url: item.url, title: item.title, captured_at: AT, listed_at: item.captured_at,
        published_at: item.published_at, source_time: null,
        page: { url: item.url, sha256: hex(page), bytes: page.length }, terms: { url: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia", sha256: hex("terms"), bytes: 5 },
        verdict: { adapter: item.source, status: lic ? "ok" : "refused", licence: lic, basis: lic ? "a federal work" : null, reasons: lic ? [] : ["no licence"] },
        media_url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${encodeURIComponent(item.id.replace(/^File:/, "").replace(/ /g, "_"))}`,
      },
      blobs: [
        { sha256: hex(page), bytes: page.length, gz: Buffer.from(page), kind: "page", url: item.url },
        { sha256: hex("terms"), bytes: 5, gz: Buffer.from("terms"), kind: "terms", url: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia" },
      ],
      candidate: lic ? { media_url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${item.id.replace(/^File:/, "").replace(/ /g, "_")}` } : null,
    };
  };
}

function fakeMedia(asked: string[]) {
  return async (url: string, dest: string) => {
    asked.push(url);
    const body = `proxy of ${url}`;
    writeFileSync(dest, body);
    return { status: "ok", sha256: hex(body), bytes: Buffer.byteLength(body) };
  };
}

const listers = (items: any[], over: Record<string, any> = {}) => ({
  commons: async () => ({ source: "commons", items, skipped: null }),
  dvids: async ({ env }: any) => (env.DVIDS_API_KEY ? { source: "dvids", items: [], skipped: null } : { source: "dvids", items: [], skipped: "DVIDS needs an API key (DVIDS_API_KEY is not set); skipped" }),
  ...over,
});

function dirs() {
  const base = mkdtempSync(path.join(os.tmpdir(), "omnibus-capture-test-"));
  return { base, outDir: path.join(base, "out"), workDir: path.join(base, "work") };
}

describe("a capture run", () => {
  it("stores what matched the editions with its evidence and proxy, writes the pool once, and the heartbeat last", async () => {
    const { base, outDir, workDir } = dirs();
    const store = memStore();
    const asked: string[] = [];
    const report = await runCapture({ store, mode: "r2", outDir, workDir, editions, now, env: {}, listers: listers([miller, offTopic]), evidenceFor: fakeEvidence(() => "pd-us-federal"), fetchMedia: fakeMedia(asked), weekly: { issue: 33, reader: null }, log: () => {} });
    expect(report).toMatchObject({ store: "r2", listed: 2, selected: 1, stored: 1, refused: 0, listers: { commons: "ok", dvids: "skipped" }, pool: { issue: 33, status: "written" } });
    const index = readIndex(store.get(INDEX_KEY));
    const entry = index.items[`commons:${miller.id}`];
    expect(entry.media).toMatchObject({ ext: "webm" });
    expect(entry.evidence_keys).toHaveLength(2);
    expect(index.items[`commons:${offTopic.id}`]).toBeUndefined();
    expect(asked[0]).toMatch(/\/transcoded\/a\/ab\/.+\.480p\.vp9\.webm$/);
    expect(store.order.at(-1)).toBe(HEARTBEAT_KEY);
    expect(store.order.indexOf(poolKey(33))).toBeGreaterThan(store.order.indexOf(INDEX_KEY));
    expect(existsSync(path.join(outDir, "weekly", "33", "pool.json"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")).lister_detail.dvids.reason).toMatch(/DVIDS_API_KEY/);

    // The next run: the held item is not fetched again and the pool is not rewritten.
    const again = await runCapture({ store, mode: "r2", outDir, workDir, editions, now, env: {}, listers: listers([miller]), evidenceFor: async () => { throw new Error("fetched again"); }, fetchMedia: fakeMedia(asked), weekly: { issue: 33, reader: null }, log: () => {} });
    expect(again).toMatchObject({ stored: 0, pool: { status: "already written" } });
    expect(asked).toHaveLength(1);
    rmSync(base, { recursive: true, force: true });
  });

  it("the artifact store holds only public-domain and CC proxies: an editorial-use item is URL and evidence only", async () => {
    const { base, outDir, workDir } = dirs();
    const store = dirStore(path.join(outDir, "store"));
    const asked: string[] = [];
    const licence = (id: string) => (id === editorial.id ? "editorial-use" : "pd-us-federal");
    const report = await runCapture({ store, mode: "dir", outDir, workDir, editions, now, env: {}, listers: listers([miller, editorial]), evidenceFor: fakeEvidence(licence), fetchMedia: fakeMedia(asked), log: () => {} });
    expect(report).toMatchObject({ store: "dir", stored: 1, metadata: 1 });
    expect(asked).toHaveLength(1);
    const index = readIndex(store.get(INDEX_KEY));
    expect(index.items[`commons:${editorial.id}`]).toMatchObject({ media: null, url: editorial.url });
    expect(index.items[`commons:${editorial.id}`].evidence_keys.length).toBeGreaterThan(0);
    const results = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")).results;
    expect(results.find((r: any) => r.sid === `commons:${editorial.id}`).note).toMatch(/never goes in a public artifact/);
    expect(existsSync(path.join(outDir, "store", "capture", "heartbeat.json"))).toBe(true);

    // Backfill: the artifact merges into R2 through planPut; the heartbeat is not written by a backfill.
    const r2 = memStore();
    const counts = backfillOne({ localRoot: path.join(outDir, "store"), store: r2, now });
    expect(counts).toEqual({ put: 1, metadata: 1 });
    const merged = readIndex(r2.get(INDEX_KEY));
    expect(merged.items[`commons:${miller.id}`].media.key).toMatch(/^capture\/media\/[0-9a-f]{64}\.webm$/);
    expect(r2.objects.has(merged.items[`commons:${miller.id}`].media.key)).toBe(true);
    expect(r2.objects.has(HEARTBEAT_KEY)).toBe(false);
    expect(backfillOne({ localRoot: path.join(outDir, "store"), store: r2, now })).toEqual({ duplicate: 1, metadata: 1 });
    rmSync(base, { recursive: true, force: true });
  });

  it("fails without a heartbeat when no lister answered; one failing lister alone does not fail the run", async () => {
    const { base, outDir, workDir } = dirs();
    const store = memStore();
    const down = { commons: async () => { throw new Error("commons down"); } };
    await expect(runCapture({ store, mode: "r2", outDir, workDir, editions, now, env: {}, listers: down, evidenceFor: fakeEvidence(() => null), fetchMedia: fakeMedia([]), log: () => {} })).rejects.toThrow(/no lister answered/);
    expect(store.objects.has(HEARTBEAT_KEY)).toBe(false);
    const one = await runCapture({ store, mode: "r2", outDir, workDir, editions, now, env: {}, listers: { ...down, voa: async () => ({ source: "voa", items: [], skipped: null }) }, evidenceFor: fakeEvidence(() => null), fetchMedia: fakeMedia([]), log: () => {} });
    expect(one.listers).toEqual({ commons: "error", voa: "ok" });
    expect(store.objects.has(HEARTBEAT_KEY)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });

  it("runs every lister the design names, and reads the newest weekly issue from the snapshot index", () => {
    expect(Object.keys(LISTERS).sort()).toEqual(["cdc", "commons", "dvids", "nasa", "noaa", "voa", "whitehouse"]);
    const reader = { dates: () => ["2026-11-08", "2026-11-09"], weeklyIssue: (d: string) => (d === "2026-11-09" ? 33 : 32), manifest: () => null };
    expect(latestWeeklyIssue(reader)).toBe(33);
    expect(latestWeeklyIssue({ dates: () => [], weeklyIssue: () => undefined, manifest: () => null })).toBeNull();
  });
});

describe("proxies", () => {
  it("are 480p (then 360p) Commons transcodes, an 854 px thumbnail, or the adapter's own small file, all allowlisted", () => {
    const v = proxyCandidates("commons", { media_url: "https://upload.wikimedia.org/wikipedia/commons/4/4d/A_b.webm" });
    expect(v.urls.map((u: any) => u.url)).toEqual([
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/4/4d/A_b.webm/A_b.webm.480p.vp9.webm",
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/4/4d/A_b.webm/A_b.webm.360p.vp9.webm",
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/4/4d/A_b.webm/A_b.webm.480p.webm",
    ]);
    expect(proxyCandidates("commons", { media_url: "https://upload.wikimedia.org/wikipedia/commons/4/4d/P.jpg" }).urls[0]).toEqual({ url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/P.jpg/854px-P.jpg", ext: "jpg" });
    expect(proxyCandidates("dvids", { proxy_url: "https://d34w7g4gy10iej.cloudfront.net/video/x_480.mp4" }).urls[0].ext).toBe("mp4");
    expect(proxyCandidates("dvids", { proxy_url: null }).reason).toMatch(/480p/);
    expect(proxyCandidates("nasa", { proxy_url: "https://example.com/x~mobile.mp4" }).urls).toEqual([]);
    expect(proxyCandidates("whitehouse", {}).reason).toMatch(/locator/);
  });

  it("a public artifact holds public-domain and CC media only", () => {
    for (const l of ["pd-us-federal", "pd-age", "pd-dedication", "cc0-1.0", "cc-by-4.0", "cc-by-sa-3.0"]) expect(artifactMayHoldMedia({ status: "ok", licence: l }), l).toBe(true);
    for (const l of ["editorial-use", "fair-use-excerpt", "own-property", "eu-reuse-credit", null]) expect(artifactMayHoldMedia({ status: "ok", licence: l }), String(l)).toBe(false);
    expect(artifactMayHoldMedia({ status: "refused", licence: "pd-us-federal" })).toBe(false);
  });

  it("NASA's terms page is now on the allowlist (DECISIONS 2026-11-13)", () => {
    expect(isAllowedUrl("https://www.nasa.gov/nasa-brand-center/images-and-media/")).toBe(true);
  });
});

describe("the stores", () => {
  it("write only under capture/, with a content type per kind", () => {
    expect(() => assertKey("snapshots/index.json")).toThrow();
    expect(() => assertKey("capture/../x")).toThrow();
    expect(assertKey("capture/media/a.webm")).toBe("capture/media/a.webm");
    expect(contentType("capture/evidence/x.gz")).toBe("application/gzip");
    expect(contentType("capture/media/x.webm")).toBe("video/webm");
  });
});

describe("GET /api/capture/heartbeat", () => {
  const bucket = (objects: Record<string, string>) => ({ get: async (k: string) => (k in objects ? ({ text: async () => objects[k] } as unknown as R2ObjectBody) : null) }) as unknown as R2Bucket;
  const env = (objects: Record<string, string> | null): Env => ({ DB: createMockD1().db, ASSETS: createMockAssets(), ...(objects ? { CAPTURE: bucket(objects) } : {}) }) as Env;

  it("reads the key the run writes, and accepts the run's own report", async () => {
    expect(CAPTURE_HEARTBEAT_KEY).toBe(HEARTBEAT_KEY);
    const { base, outDir, workDir } = dirs();
    const store = memStore();
    await runCapture({ store, mode: "r2", outDir, workDir, editions, now, env: {}, listers: listers([miller]), evidenceFor: fakeEvidence(() => "pd-us-federal"), fetchMedia: fakeMedia([]), log: () => {} });
    const hb = readCaptureHeartbeat(JSON.parse(String(store.get(HEARTBEAT_KEY))));
    expect(hb).toMatchObject({ ran_at: AT, store: "r2", stored: 1, listers: { commons: "ok", dvids: "skipped" } });
    const res = await handleCaptureHeartbeat(env({ [HEARTBEAT_KEY]: String(store.get(HEARTBEAT_KEY)) }), Date.parse(AT) + 3_600_000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, age_hours: 1, stale_after_hours: 30 });
    expect(JSON.stringify(body)).not.toMatch(/Miller|commons\.wikimedia/);
    rmSync(base, { recursive: true, force: true });
  });

  it("answers 503 after 30 hours, when missing, unreadable or unbound, and is routed by the Worker", async () => {
    const beat = JSON.stringify({ schema: "omnibus.capture-heartbeat/1", ran_at: AT, store: "r2", listed: 1, selected: 1, stored: 1, metadata: 0, refused: 0, deferred: 0, index_items: 1, listers: { commons: "ok" } });
    expect(CAPTURE_STALE_HOURS).toBe(30);
    expect((await handleCaptureHeartbeat(env({ [HEARTBEAT_KEY]: beat }), Date.parse(AT) + 30 * 3_600_000)).status).toBe(200);
    const stale = await handleCaptureHeartbeat(env({ [HEARTBEAT_KEY]: beat }), Date.parse(AT) + 30.2 * 3_600_000);
    expect(stale.status).toBe(503);
    expect(await stale.json()).toMatchObject({ ok: false, error: "stale" });
    expect(await (await handleCaptureHeartbeat(env({}))).json()).toMatchObject({ error: "no_heartbeat" });
    expect(await (await handleCaptureHeartbeat(env(null))).json()).toMatchObject({ error: "not_configured" });
    expect(await (await handleCaptureHeartbeat(env({ [HEARTBEAT_KEY]: "{" }))).json()).toMatchObject({ error: "unreadable" });
    expect(readCaptureHeartbeat({ ...JSON.parse(beat), listers: { commons: "<script>" } })).toBeNull();
    expect(readCaptureHeartbeat({ ...JSON.parse(beat), stored: -1 })).toBeNull();
    const routed = await handle(new Request("https://omnibus.voidvision.org/api/capture/heartbeat"), env({ [HEARTBEAT_KEY]: beat }));
    expect([200, 503]).toContain(routed.status);
    expect(routed.headers.get("content-security-policy")).toBeTruthy();
  });
});

describe(".github/workflows/capture.yml", () => {
  const text = readFileSync(path.join(root, ".github/workflows/capture.yml"), "utf8");
  const wf = parseYaml(text);
  const job = wf.jobs.capture;

  it("runs three times a day and on dispatch, in its own concurrency group, inside 25 minutes, with rule 10's header", () => {
    expect(wf.on.schedule.map((s: any) => s.cron)).toEqual(["23 5 * * *", "11 13 * * *", "41 21 * * *"]);
    expect(wf.on).toHaveProperty("workflow_dispatch");
    expect(wf.concurrency.group).toBe("capture");
    expect(job["timeout-minutes"]).toBe(25);
    expect(text).toMatch(/owner: Studio \(omnibus\)/);
    expect(text).toMatch(/kill_after_idle_days: 21/);
    expect(text).toMatch(/heartbeat_url: https:\/\/omnibus\.voidvision\.org\/api\/capture\/heartbeat/);
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toEqual({ contents: "read", issues: "write" });
  });

  it("passes each secret only to the steps that use it, and keeps a 14-day artifact", () => {
    for (const step of job.steps) {
      const env = JSON.stringify(step.env ?? {});
      expect(env).not.toMatch(/CLOUDFLARE_API_TOKEN/);
      if (/R2_SECRET_ACCESS_KEY/.test(env)) expect(step.run).toMatch(/--store r2/);
      if (/DVIDS_API_KEY/.test(env)) expect(step.run).toMatch(/scripts\/capture\/run\.mjs/);
    }
    expect(job.env).toEqual({ HAS_R2: "${{ secrets.R2_ACCESS_KEY_ID != '' && secrets.R2_SECRET_ACCESS_KEY != '' && secrets.R2_ACCOUNT_ID != '' }}", HAS_DVIDS: "${{ secrets.DVIDS_API_KEY != '' }}" });
    const art = job.steps.find((s: any) => String(s.uses).startsWith("actions/upload-artifact"));
    expect(art.with["retention-days"]).toBe(14);
    const red = job.steps.find((s: any) => /capture-red/.test(String(s.run)));
    expect(red.if).toMatch(/failure\(\) && github\.event_name == 'schedule'/);
    expect(red.run).toMatch(/--label capture-red --label prod-red/);
  });

  it("verify-production checks the capture heartbeat only once CAPTURE_R2_ENABLED is true", () => {
    const vp = parseYaml(readFileSync(path.join(root, ".github/workflows/verify-production.yml"), "utf8"));
    const step = vp.jobs.verify.steps.find((s: any) => /api\/capture\/heartbeat/.test(String(s.run)));
    expect(step.if).toMatch(/vars\.CAPTURE_R2_ENABLED == 'true'/);
  });

  it("the Worker reads the capture bucket through the CAPTURE binding", () => {
    const wr = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
    expect(wr).toMatch(/\{ "binding": "CAPTURE", "bucket_name": "omnibus-capture" \}/);
  });
});

describe("review follow-ups: bytes, reconcile, retries, labels", () => {
  it("counts the index, pools, pins and heartbeat against the bucket cap", async () => {
    const { overheadBytes, storedBytes, emptyIndex, planPut, CAPS } = await import("../scripts/lib/capture-store.mjs");
    const idx = { ...emptyIndex(), overhead_bytes: CAPS.bucketCapBytes - 5 };
    expect(overheadBytes(idx)).toBe(CAPS.bucketCapBytes - 5);
    expect(storedBytes(idx)).toBe(CAPS.bucketCapBytes - 5);
    const ev = { record: { captured_at: AT, published_at: AT, page: { sha256: hex("p") }, terms: { sha256: hex("t") }, verdict: { status: "ok" } }, blobs: [] };
    const r = planPut({ index: idx, item: { source: "commons", id: "File:A.webm", url: "u" }, evidence: ev, media: { sha256: hex("m"), ext: "webm", bytes: 10 }, now: AT });
    expect(r.refused.join()).toMatch(/bucket cap/);
  });

  it("fetches a held item again only when the day or bucket cap alone refused it", async () => {
    const { retriesHeld } = await import("../scripts/capture/run.mjs");
    expect(retriesHeld({ media: null, refused: ["media: over the 104857600-byte day cap"] })).toBe(true);
    expect(retriesHeld({ media: null, refused: ["media: over the 1610612736-byte bucket cap"] })).toBe(true);
    expect(retriesHeld({ media: null, refused: ["media: over the 104857600-byte day cap", "media: without an ok adapter verdict"] })).toBe(false);
    expect(retriesHeld({ media: { sha256: "x" }, refused: null })).toBe(false);
    expect(retriesHeld({ media: null, refused: null })).toBe(false);
  });

  it("reconciles weekly: deletes media and evidence the index does not name, and sets overhead from the rest", async () => {
    const { reconcile, OVERHEAD_RESERVE_BYTES, fitPool } = await import("../scripts/capture/run.mjs");
    const { emptyIndex, mediaKey } = await import("../scripts/lib/capture-store.mjs");
    const idx = { ...emptyIndex(), media: { [hex("keep")]: { bytes: 4, ext: "webm" } } };
    const old = "2026-11-07T19:00:00Z";
    const objects = [
      { key: mediaKey(hex("keep"), "webm"), size: 4, last_modified: old },
      { key: mediaKey(hex("orphan"), "webm"), size: 9, last_modified: old },
      { key: `capture/evidence/${hex("e")}.gz`, size: 3, last_modified: old },
      // Younger than an hour, or with no time: maybe a put whose index write is still to come, so kept.
      { key: mediaKey(hex("young"), "webm"), size: 7, last_modified: "2026-11-07T21:10:00Z" },
      { key: `capture/evidence/${hex("untimed")}.gz`, size: 1 },
      { key: "capture/index.json", size: 100, last_modified: old },
      { key: "capture/weekly/33/pool.json", size: 50, last_modified: old },
    ];
    const deleted: string[] = [];
    const out = reconcile({ list: () => objects, delete: (k: string) => deleted.push(k) }, idx, { now: new Date(AT) });
    expect(deleted.sort()).toEqual([mediaKey(hex("orphan"), "webm"), `capture/evidence/${hex("e")}.gz`].sort());
    expect(out.overhead_bytes).toBe(150 + OVERHEAD_RESERVE_BYTES);
    expect(out.reconcile).toMatchObject({ objects: 7, listed_bytes: 174, orphans_deleted: 2, orphan_bytes: 12 });
    // The pool is trimmed to its cap, and refused when even three items a story do not fit.
    const build = (n: number) => ({ items: "x".repeat(n * 100) });
    expect(fitPool(build, 700)?.maxItems).toBe(5);
    expect(fitPool(build, 100)).toBeNull();
  });

  it("a run reconciles a listable store once a week and reports it", async () => {
    const { base, outDir, workDir } = dirs();
    const store = dirStore(path.join(outDir, "store"));
    const one = await runCapture({ store, mode: "dir", outDir, workDir, editions, now, env: {}, listers: listers([]), log: () => {} });
    expect(one.reconcile).toMatchObject({ objects: 0 });
    const two = await runCapture({ store, mode: "dir", outDir, workDir, editions, now, env: {}, listers: listers([]), log: () => {} });
    expect(two.reconcile).toBeNull();
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the issue labels only when missing, and states when the heartbeat is live", () => {
    const text = readFileSync(path.join(root, ".github/workflows/capture.yml"), "utf8");
    expect(text).not.toMatch(/gh label create[^\n]*--force/);
    expect(text).toMatch(/grep -qx prod-red; then gh label create prod-red/);
    expect(text).toMatch(/heartbeat_url: https:\/\/omnibus\.voidvision\.org\/api\/capture\/heartbeat\n#\s+\(live only once CAPTURE_R2_ENABLED is "true"/);
    expect(readFileSync(path.join(root, "budget.yaml"), "utf8")).toMatch(/3 x 25 x 30 = 2,250 minutes a month, which a public repo is not billed for/);
  });
});
