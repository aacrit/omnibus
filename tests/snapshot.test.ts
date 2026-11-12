import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  LIMITS,
  PATHS,
  RAW_BASE,
  buildManifest,
  checkCaps,
  decideWrite,
  isSnapshotPath,
  planDeepDives,
  printedDate,
  sha256Hex,
  validateDeepDive,
  validateFeed,
  validateManifest,
  validateSources,
  validateWeekly,
} from "../scripts/lib/snapshot.mjs";
import { politeGet, runSnapshot, USER_AGENT } from "../scripts/snapshot.mjs";
import { HEARTBEAT_KEY, INDEX_KEY, LATEST_KEY, fileKey, planUpload } from "../scripts/lib/snapshot-store.mjs";
import { parseSize, readLocalSnapshot, uploadSnapshot } from "../scripts/snapshot-r2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XSS = '"><img src=x onerror=alert(1)>';
const COMMIT = "a".repeat(40);
const COMMIT2 = "b".repeat(40);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "omnibus-snap-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function cluster(n: number, extra: Record<string, unknown> = {}) {
  return { id: id(n), title: `Story ${n}`, source_count: 10 - (n % 10), category: "world", importance_score: 50 + n, ...extra };
}
function feedOf(builtAt: string, ids: number[]) {
  return { builtAt, clusters: ids.map((n) => cluster(n)) };
}
const weekly = (issue = 33) => ({
  issue_number: issue,
  week_start: "2026-11-02",
  week_end: "2026-11-08",
  created_at: "2026-11-08T22:16:50+00:00",
  edition: "world",
  cover_headline: "A week",
  cover_numbers: [],
  cover_timelines: [{ story_index: 0, entries: [{ cluster_id: id(1), date_iso: "2026-11-03", title: "Story 1", source_count: 9 }] }],
});
const sources = () => [{ name: "Outlet A", political_lean_baseline: "center", tier: "us_major" }, { name: "Outlet B", tier: "independent" }];
const deepdive = (n: number) => [{ article: { url: `https://example.org/${n}`, title: `Headline ${n}`, published_at: "2026-11-03T10:00:00Z", source: { name: "Outlet A" } } }];

/** A fake void news repo at a commit: path -> JSON body (or a status / raw text). */
type Body = unknown | { status: number } | { raw: string };
function fakeFetch(files: Record<string, Body>, calls: { url: string; ua: string | null }[] = []) {
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push({ url, ua: init?.headers?.["user-agent"] ?? null });
    try {
      await Promise.resolve();
      const p = url.replace(/^https:\/\/raw\.githubusercontent\.com\/aacrit\/void--news\/[0-9a-f]{40}\//, "");
      const body = files[p];
      if (body === undefined) return new Response("Not Found", { status: 404 });
      if (body && typeof body === "object" && "status" in (body as object)) return new Response("x", { status: (body as { status: number }).status });
      if (body && typeof body === "object" && "raw" in (body as object)) return new Response((body as { raw: string }).raw, { status: 200 });
      return new Response(JSON.stringify(body), { status: 200 });
    } finally {
      inFlight--;
    }
  };
  return { impl: impl as unknown as typeof fetch, calls, maxInFlight: () => maxInFlight };
}

function repoFiles(builtAt = "2026-11-11T20:09:28Z", ids = [1, 2, 3], w = weekly()) {
  const files: Record<string, Body> = { [PATHS.feed]: feedOf(builtAt, ids), [PATHS.weekly]: w, [PATHS.sources]: sources() };
  for (const n of ids) files[PATHS.deepdive(id(n))] = deepdive(n);
  return files;
}

const noSleep = async () => {};
const run = (outDir: string, files: Record<string, Body>, extra: Record<string, unknown> = {}) =>
  runSnapshot({ outDir, fetchImpl: fakeFetch(files).impl, sleep: noSleep, resolveCommit: () => COMMIT, now: () => new Date("2026-11-12T12:00:05Z"), ...extra });

// ---- Validation ----------------------------------------------------------------

describe("snapshot validation", () => {
  it("accepts void news's printed shapes", () => {
    expect(validateFeed(feedOf("2026-11-11T20:09:28Z", [1, 2]))).toEqual([]);
    expect(validateWeekly(weekly())).toEqual([]);
    expect(validateSources(sources())).toEqual([]);
    expect(validateDeepDive(deepdive(1))).toEqual([]);
    expect(validateDeepDive({ 0: deepdive(1)[0] })).toEqual([]);
  });

  it("refuses a feed without a build time, without clusters, or with a cluster id that is not a uuid", () => {
    expect(validateFeed({ clusters: [cluster(1)] })).not.toEqual([]);
    expect(validateFeed({ builtAt: "2026-11-11T20:09:28Z", clusters: [] })).not.toEqual([]);
    for (const bad of [XSS, "../../etc/passwd", "1b53a415-e848-4686-ad97-c9646a09184f/../x", ""]) {
      expect(validateFeed({ builtAt: "2026-11-11T20:09:28Z", clusters: [{ ...cluster(1), id: bad }] }), bad).not.toEqual([]);
    }
    expect(validateFeed(null)).not.toEqual([]);
    expect(validateFeed([])).not.toEqual([]);
  });

  it("refuses a weekly issue, outlet list or deep dive missing what the record needs", () => {
    expect(validateWeekly({ ...weekly(), issue_number: "33" })).not.toEqual([]);
    expect(validateWeekly({ ...weekly(), week_start: "2026-02-30" })).not.toEqual([]);
    expect(validateSources([])).not.toEqual([]);
    expect(validateSources([{ tier: "x" }])).not.toEqual([]);
    expect(validateDeepDive("nope")).not.toEqual([]);
    expect(validateDeepDive([{ article: { url: "u", title: "t" } }])).not.toEqual([]);
  });

  it("names a snapshot by its printed date, not the capture date", () => {
    expect(printedDate({ builtAt: "2026-11-10T19:43:56Z" })).toBe("2026-11-10");
  });

  it("allows only the four snapshot file names, so no id can reach outside the date's folder", () => {
    expect(isSnapshotPath("feed.json")).toBe(true);
    expect(isSnapshotPath(`deepdive/${id(1)}.json`)).toBe(true);
    for (const bad of ["manifest.json", "../feed.json", `deepdive/${XSS}.json`, "deepdive/../../x.json", `deepdive/${id(1)}.json/..`]) {
      expect(isSnapshotPath(bad), bad).toBe(false);
    }
    expect(() => fileKey("2026-11-11", `deepdive/${XSS}.json`)).toThrow();
    expect(() => fileKey(XSS, "feed.json")).toThrow();
  });
});

// ---- Manifest ------------------------------------------------------------------

describe("snapshot manifest", () => {
  const files = [
    { path: "weekly.json", bytes: 3, sha256: sha256Hex("abc") },
    { path: "feed.json", bytes: 2, sha256: sha256Hex("ab") },
  ];
  const base = { date: "2026-11-11", printedAt: "2026-11-11T20:09:28Z", commit: COMMIT, capturedAt: "2026-11-12T12:00:00Z", files, missing: [] };

  it("hashes what was printed, not when it was captured or in what order", () => {
    const a = buildManifest(base);
    const b = buildManifest({ ...base, capturedAt: "2026-11-12T23:40:00Z", files: [...files].reverse() });
    expect(a.content_sha256).toBe(b.content_sha256);
    expect(a.files.map((f: { path: string }) => f.path)).toEqual(["feed.json", "weekly.json"]);
    expect(a.total_bytes).toBe(5);
    expect(validateManifest(a)).toEqual([]);
  });

  it("changes when any file, the commit or what is missing changes", () => {
    const a = buildManifest(base).content_sha256;
    expect(buildManifest({ ...base, files: [files[0], { ...files[1], sha256: sha256Hex("zz") }] }).content_sha256).not.toBe(a);
    expect(buildManifest({ ...base, commit: COMMIT2 }).content_sha256).not.toBe(a);
    expect(buildManifest({ ...base, missing: [{ cluster_id: id(9), reason: "not_found" }] }).content_sha256).not.toBe(a);
  });

  it("decides write, unchanged or replace from the stored manifest", () => {
    const m = buildManifest(base);
    expect(decideWrite(null, m)).toBe("write");
    expect(decideWrite(m, buildManifest({ ...base, capturedAt: "later" }))).toBe("unchanged");
    expect(decideWrite(m, buildManifest({ ...base, commit: COMMIT2 }))).toBe("replace");
  });

  it("refuses a stored manifest whose paths could escape the snapshot", () => {
    const m = buildManifest(base);
    expect(validateManifest({ ...m, files: [{ path: "../../x", bytes: 1, sha256: "0".repeat(64) }] })).not.toEqual([]);
    expect(validateManifest({ ...m, date: XSS })).not.toEqual([]);
  });
});

// ---- Size caps -----------------------------------------------------------------

describe("snapshot size caps (R2 bills past its free tier)", () => {
  it("flags a file over the file cap and a snapshot over the total cap", () => {
    const limits = { maxFileBytes: 10, maxTotalBytes: 15, maxDeepDives: 5 };
    expect(checkCaps([{ path: "feed.json", bytes: 10 }], limits)).toEqual([]);
    expect(checkCaps([{ path: "feed.json", bytes: 11 }], limits)).toHaveLength(1);
    expect(checkCaps([{ path: "feed.json", bytes: 8 }, { path: "weekly.json", bytes: 8 }], limits)).toHaveLength(1);
  });

  it("caps how many deep dives one day may hold, keeping printed order", () => {
    const { ids, skipped } = planDeepDives(feedOf("2026-11-11T00:00:00Z", [1, 2, 3, 2]), { ...LIMITS, maxDeepDives: 2 });
    expect(ids).toEqual([id(1), id(2)]);
    expect(skipped).toEqual([{ cluster_id: id(3), reason: "over_file_cap" }]);
  });

  it("stops reading a body once it passes the cap, whatever Content-Length says", async () => {
    const big = "x".repeat(5000);
    const impl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch;
    expect(await politeGet("https://example.org/big", { fetchImpl: impl, sleep: noSleep, maxBytes: 4096 })).toEqual({ status: "too_large" });
    const ok = await politeGet("https://example.org/big", { fetchImpl: impl, sleep: noSleep, maxBytes: 8192 });
    expect(ok.status).toBe("ok");
  });

  it("drops the lowest-printed deep dives past the total cap and records them; a core file over the cap fails the run", async () => {
    const out = tmp();
    const files = repoFiles("2026-11-11T20:09:28Z", [1, 2, 3]);
    const coreBytes = [PATHS.feed, PATHS.weekly, PATHS.sources].reduce((n, p) => n + JSON.stringify(files[p]).length, 0);
    const ddBytes = JSON.stringify(deepdive(1)).length;
    const limits = { maxFileBytes: 1_000_000, maxTotalBytes: coreBytes + ddBytes + 2, maxDeepDives: 60 };
    const r = await run(out, files, { limits });
    expect(r.manifest.files.filter((f: { path: string }) => f.path.startsWith("deepdive/"))).toHaveLength(1);
    expect(r.manifest.missing).toEqual([
      { cluster_id: id(2), reason: "over_total_cap" },
      { cluster_id: id(3), reason: "over_total_cap" },
    ]);
    expect(r.manifest.total_bytes).toBeLessThanOrEqual(limits.maxTotalBytes);
    await expect(run(tmp(), files, { limits: { ...limits, maxFileBytes: 10 } })).rejects.toThrow(/too_large/);
  });

  it("budget.yaml's R2 row covers a year at the total cap within the uploader's bucket share", async () => {
    const { BUCKET_CAP_BYTES } = await import("../scripts/lib/snapshot-store.mjs");
    expect(366 * LIMITS.maxTotalBytes).toBeLessThanOrEqual(BUCKET_CAP_BYTES);
    const budget = parseYaml(readFileSync(path.join(root, "budget.yaml"), "utf8")) as { alert_at: number; quotas: { name: string; ceiling: number; estimate_at_1000_users_per_day: number }[] };
    const r2 = budget.quotas.find((q) => q.name === "r2_storage_gb")!;
    expect(r2.estimate_at_1000_users_per_day).toBeGreaterThan(0);
    expect(BUCKET_CAP_BYTES / 1024 ** 3).toBeLessThanOrEqual(r2.ceiling * budget.alert_at);
  });
});

// ---- The run: politeness, idempotence, missing deep dives --------------------------

describe("runSnapshot", () => {
  it("fetches one request at a time, at the pinned commit, naming void omnibus, and writes the printed date's folder", async () => {
    const out = tmp();
    const fake = fakeFetch(repoFiles());
    const r = await runSnapshot({ outDir: out, fetchImpl: fake.impl, sleep: noSleep, resolveCommit: () => COMMIT, now: () => new Date("2026-11-12T12:00:05Z") });
    expect(fake.maxInFlight()).toBe(1);
    expect(fake.calls.every((c) => c.url.startsWith(`${RAW_BASE}/${COMMIT}/`))).toBe(true);
    expect(fake.calls.every((c) => c.ua === USER_AGENT && /void-omnibus/.test(c.ua))).toBe(true);
    expect(r.date).toBe("2026-11-11"); // captured on the 12th, printed on the 11th
    expect(r.action).toBe("write");
    const m = JSON.parse(readFileSync(path.join(out, "2026-11-11", "manifest.json"), "utf8"));
    expect(m.weekly_issue).toBe(33);
    expect(m.source.commit).toBe(COMMIT);
    for (const f of m.files) expect(sha256Hex(readFileSync(path.join(out, "2026-11-11", f.path)))).toBe(f.sha256);
    expect(readLocalSnapshot(path.join(out, "2026-11-11")).content_sha256).toBe(m.content_sha256);
  });

  it("re-run for the same printed day writes nothing", async () => {
    const out = tmp();
    const files = repoFiles();
    const first = await run(out, files);
    const mf = path.join(out, "2026-11-11", "manifest.json");
    const before = statSync(mf).mtimeMs;
    const again = await run(out, files, { now: () => new Date("2026-11-12T23:40:00Z") });
    expect(again.action).toBe("unchanged");
    expect(again.manifest.content_sha256).toBe(first.manifest.content_sha256);
    expect(statSync(mf).mtimeMs).toBe(before);
    expect(JSON.parse(readFileSync(mf, "utf8")).captured_at).toBe("2026-11-12T12:00:05.000Z");
  });

  it("replaces the day when void news reprints it, and drops files the new printing lacks", async () => {
    const out = tmp();
    await run(out, repoFiles("2026-11-11T12:00:00Z", [1, 2, 3]));
    const r = await run(out, repoFiles("2026-11-11T20:00:00Z", [1, 4], weekly(34)));
    expect(r.action).toBe("replace");
    expect(existsSync(path.join(out, "2026-11-11", "deepdive", `${id(3)}.json`))).toBe(false);
    expect(existsSync(path.join(out, "2026-11-11", "deepdive", `${id(4)}.json`))).toBe(true);
    expect(r.manifest.weekly_issue).toBe(34);
  });

  it("tolerates a missing, broken or unreachable deep dive and records why", async () => {
    const out = tmp();
    const files = repoFiles("2026-11-11T20:09:28Z", [1, 2, 3, 4]);
    delete files[PATHS.deepdive(id(2))];
    files[PATHS.deepdive(id(3))] = { raw: "{not json" };
    files[PATHS.deepdive(id(4))] = { status: 503 };
    const fake = fakeFetch(files);
    const r = await runSnapshot({ outDir: out, fetchImpl: fake.impl, sleep: noSleep, resolveCommit: () => COMMIT });
    expect(r.action).toBe("write");
    expect(r.manifest.missing).toEqual([
      { cluster_id: id(2), reason: "not_found" },
      { cluster_id: id(3), reason: "invalid" },
      { cluster_id: id(4), reason: "fetch_failed" },
    ]);
    // 404 is not retried; 503 is, three times after the first try.
    expect(fake.calls.filter((c) => c.url.endsWith(`${id(2)}.json`))).toHaveLength(1);
    expect(fake.calls.filter((c) => c.url.endsWith(`${id(4)}.json`))).toHaveLength(4);
  });

  it("retries a transient failure with backoff, then succeeds", async () => {
    let n = 0;
    const waits: number[] = [];
    const impl = (async () => (++n < 3 ? new Response("busy", { status: 429 }) : new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const r = await politeGet("https://example.org/x", { fetchImpl: impl, sleep: async (ms: number) => void waits.push(ms) });
    expect(r.status).toBe("ok");
    expect(waits).toEqual([1000, 2000]);
  });

  it("fails without writing when the feed, weekly issue or outlet list is missing or malformed", async () => {
    for (const broken of [
      { [PATHS.feed]: undefined },
      { [PATHS.weekly]: { status: 404 } },
      { [PATHS.sources]: { raw: "[]" } },
      { [PATHS.feed]: { builtAt: "2026-11-11T00:00:00Z", clusters: [{ ...cluster(1), id: XSS }] } },
    ]) {
      const out = tmp();
      const files = { ...repoFiles(), ...broken } as Record<string, Body>;
      for (const [k, v] of Object.entries(files)) if (v === undefined) delete files[k];
      await expect(run(out, files)).rejects.toThrow();
      expect(existsSync(path.join(out, "2026-11-11"))).toBe(false);
    }
  });
});

// ---- R2 upload -------------------------------------------------------------------

function memoryStore(bytes = 0) {
  const objects = new Map<string, string>();
  const puts: string[] = [];
  return {
    objects,
    puts,
    get: (k: string) => objects.get(k) ?? null,
    put: (k: string, file: string) => {
      puts.push(k);
      objects.set(k, readFileSync(file, "utf8"));
    },
    bucketBytes: () => bytes,
  };
}

describe("snapshot upload to R2", () => {
  it("puts data files first, then the manifest, the index, the latest pointer and the heartbeat", async () => {
    const out = tmp();
    const r = await run(out, repoFiles());
    const store = memoryStore();
    expect(uploadSnapshot({ dir: r.dir, store, now: () => new Date("2026-11-12T12:01:00Z") })).toBe("write");
    const n = r.manifest.files.length;
    expect(store.puts.slice(0, n).every((k) => /^snapshots\/2026-11-11\/(feed|weekly|sources|deepdive\/.+)\.json$/.test(k))).toBe(true);
    expect(store.puts.slice(n)).toEqual(["snapshots/2026-11-11/manifest.json", INDEX_KEY, LATEST_KEY, HEARTBEAT_KEY]);
    expect(JSON.parse(store.objects.get(INDEX_KEY)!).dates.map((d: { date: string }) => d.date)).toEqual(["2026-11-11"]);
    expect(JSON.parse(store.objects.get(HEARTBEAT_KEY)!)).toMatchObject({ schema: 1, result: "write", date: "2026-11-11", ran_at: "2026-11-12T12:01:00.000Z" });
  });

  it("re-uploading the same day writes only the heartbeat", async () => {
    const out = tmp();
    const r = await run(out, repoFiles());
    const store = memoryStore();
    uploadSnapshot({ dir: r.dir, store });
    store.puts.length = 0;
    expect(uploadSnapshot({ dir: r.dir, store })).toBe("unchanged");
    expect(store.puts).toEqual([HEARTBEAT_KEY]);
  });

  it("never moves the latest pointer back for a late or replayed older day", async () => {
    const root = tmp();
    const newer = await run(root, repoFiles("2026-11-11T20:00:00Z"));
    const older = await run(root, repoFiles("2026-11-09T12:00:00Z"));
    const store = memoryStore();
    uploadSnapshot({ dir: newer.dir, store });
    uploadSnapshot({ dir: older.dir, store });
    expect(JSON.parse(store.objects.get(LATEST_KEY)!).date).toBe("2026-11-11");
    expect(JSON.parse(store.objects.get(INDEX_KEY)!).dates.map((d: { date: string }) => d.date)).toEqual(["2026-11-09", "2026-11-11"]);
  });

  it("refuses to grow the bucket past this product's cap, and uploads nothing", async () => {
    const r = await run(tmp(), repoFiles());
    const store = memoryStore(1000);
    expect(() => uploadSnapshot({ dir: r.dir, store, capBytes: 1500 })).toThrow(/cap/);
    expect(store.puts).toEqual([]);
  });

  it("refuses a local snapshot whose files no longer match their manifest", async () => {
    const r = await run(tmp(), repoFiles());
    writeFileSync(path.join(r.dir, "feed.json"), "{}");
    const store = memoryStore();
    expect(() => uploadSnapshot({ dir: r.dir, store })).toThrow(/does not match/);
    expect(store.puts).toEqual([]);
  });

  it("an unchanged plan with a corrupt stored manifest is treated as a fresh write", async () => {
    const r = await run(tmp(), repoFiles());
    const plan = planUpload({ manifest: r.manifest, remote: { manifest: "{oops", index: null, latest: null }, ranAt: "2026-11-12T00:00:00Z" });
    expect(plan.action).toBe("write");
  });

  it("reads wrangler's bucket size, erring high", () => {
    expect(parseSize("0 B")).toBe(0);
    expect(parseSize("923 MB")).toBe(923 * 1024 ** 2);
    expect(parseSize("2.5 kB")).toBe(2560);
    expect(() => parseSize("lots")).toThrow();
  });
});

// ---- The workflow (rule 10) ----------------------------------------------------------

describe("snapshot workflow", () => {
  const text = readFileSync(path.join(root, ".github", "workflows", "snapshot.yml"), "utf8");
  const wf = parseYaml(text) as { on: { schedule: { cron: string }[] }; jobs: Record<string, { steps: { name?: string; if?: string; run?: string }[] }> };

  it("runs daily at 12:00 UTC, plus a late-edition catch", () => {
    expect(wf.on.schedule.map((s) => s.cron)).toEqual(["0 12 * * *", "40 23 * * *"]);
  });

  it("declares owner, kill_after_idle_days and a heartbeat_url on this product's Worker", () => {
    expect(text).toMatch(/^#\s+owner: \S+/m);
    expect(text).toMatch(/^#\s+kill_after_idle_days: \d+$/m);
    expect(text).toMatch(/^#\s+heartbeat_url: https:\/\/omnibus\.voidvision\.org\/api\/snapshots\/heartbeat$/m);
  });

  it("skips R2 with a warning when the secret is missing, never by swallowing a failure", () => {
    const steps = wf.jobs.snapshot.steps;
    const store = steps.find((s) => s.name === "Store it in R2")!;
    expect(store.if).toContain("CLOUDFLARE_API_TOKEN != ''");
    const notice = steps.find((s) => s.name === "R2 is not configured")!;
    expect(notice.run).toContain("::warning");
    expect(text).not.toMatch(/continue-on-error|\|\|\s*true|\|\|\s*echo/);
  });
});

// ---- The week record from snapshots ------------------------------------------------

describe("normalise-week from snapshots", () => {
  async function buildWeek(root: string, opts: { skipDay?: string; tamper?: boolean } = {}) {
    // Seven printed days of week 33 (2 to 8 Nov), plus the 9th holding the weekly issue.
    for (let i = 0; i < 8; i++) {
      const date = `2026-11-0${2 + i}`;
      if (date === opts.skipDay) continue;
      const ids = i === 0 ? [5, 6, 7] : i === 1 ? [1, 5, 6] : [5 + (i % 3), 6, 7];
      const files = repoFiles(`${date}T14:00:00Z`, ids, i === 7 ? weekly(33) : weekly(32));
      if (i === 1) files[PATHS.deepdive(id(1))] = deepdive(100); // first printed state of the lead
      if (i === 7) {
        (files[PATHS.feed] as { clusters: unknown[] }).clusters.push(cluster(1));
        files[PATHS.deepdive(id(1))] = deepdive(200); // a later state: must not be used
      }
      await runSnapshot({ outDir: root, fetchImpl: fakeFetch(files).impl, sleep: noSleep, resolveCommit: () => (i === 7 ? COMMIT2 : COMMIT) });
    }
    if (opts.tamper) writeFileSync(path.join(root, "2026-11-04", "feed.json"), JSON.stringify(feedOf("2026-11-04T14:00:00Z", [9])));
    const { normaliseWeek } = await import("../scripts/lib/normalise.mjs");
    const { dirReader, snapshotSource } = await import("../scripts/lib/week-sources.mjs");
    const source = snapshotSource(dirReader(root));
    // The echo record is read at the anchor's commit; stub it, no network in tests.
    source.echo = async (p: string) => ({ text: "slug: spanish-flu-1918\ntitle: 'The flu'\ndate_display: '1918'\n", link: `https://github.com/aacrit/void--news/blob/${COMMIT2}/${p}` });
    return normaliseWeek(source, 33);
  }

  it("builds the week from the seven daily snapshots and the snapshot holding the issue", async () => {
    const w = await buildWeek(tmp());
    expect(w.week_start).toBe("2026-11-02");
    expect(w.days.map((d: { available: boolean }) => d.available)).toEqual([true, true, true, true, true, true, true]);
    expect(w.days[1].lead.title).toBe("Story 1");
    expect(w.days[1].snapshot).toBe(`https://github.com/aacrit/void--news/blob/${COMMIT}/${PATHS.feed}`);
    expect(w.normalised_from.origin_main).toBe(COMMIT2);
    expect(w.normalised_from.weekly).toBe(`https://github.com/aacrit/void--news/blob/${COMMIT2}/${PATHS.weekly}`);
    expect(w.normalised_from.snapshots.store).toBe("local");
    expect(JSON.stringify(w)).not.toContain(os.tmpdir()); // no local paths in the record
  });

  it("takes a lead deep dive from its earliest snapshot, its first printed state", async () => {
    const w = await buildWeek(tmp());
    expect(w.lead.records[0].deepdive).toBe(`https://github.com/aacrit/void--news/blob/${COMMIT}/${PATHS.deepdive(id(1))}`);
    expect(w.lead.ledger.map((a: { headline: string }) => a.headline)).toEqual(["Headline 100"]);
  });

  it("marks a day with no snapshot as unavailable instead of inventing it", async () => {
    const w = await buildWeek(tmp(), { skipDay: "2026-11-05" });
    expect(w.days[3]).toEqual({ date: "2026-11-05", available: false });
  });

  it("refuses a snapshot file that no longer matches its manifest", async () => {
    await expect(buildWeek(tmp(), { tamper: true })).rejects.toThrow(/sha256/);
  });

  it("says plainly when no snapshot holds the issue", async () => {
    const root = tmp();
    mkdirSync(root, { recursive: true });
    const { normaliseWeek } = await import("../scripts/lib/normalise.mjs");
    const { dirReader, snapshotSource } = await import("../scripts/lib/week-sources.mjs");
    await expect(normaliseWeek(snapshotSource(dirReader(root)), 33)).rejects.toThrow(/no snapshot .* holds weekly issue 33/);
  });
});
