import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from "node:fs";
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
  isSnapshotPath,
  planDeepDives,
  planSnapshot,
  printedDate,
  sha256Hex,
  validateDeepDive,
  validateFeed,
  validateManifest,
  validateSources,
  validateWeekly,
} from "../scripts/lib/snapshot.mjs";
import { MAX_CONSECUTIVE_FAILURES, USER_AGENT, politeGet, retryAfterMs, runSnapshot } from "../scripts/snapshot.mjs";
import { BUCKET_CAP_BYTES, HEARTBEAT_KEY, INDEX_KEY, LATEST_KEY, blobKey, manifestKey, planUpload, readIndex } from "../scripts/lib/snapshot-store.mjs";
import { findSnapshotDirs, parseSize, readLocalSnapshot, uploadSnapshot } from "../scripts/snapshot-r2.mjs";

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
type Body = unknown | { status: number; headers?: Record<string, string> } | { raw: string };
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
      if (body && typeof body === "object" && "status" in (body as object)) {
        const b = body as { status: number; headers?: Record<string, string> };
        return new Response("x", { status: b.status, headers: b.headers });
      }
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
const deepPaths = (m: { files: { path: string }[] }) => m.files.map((f) => f.path).filter((p) => p.startsWith("deepdive/"));

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

  it("allows only the four snapshot file names and content keys, so no id can reach outside the date's folder", () => {
    expect(isSnapshotPath("feed.json")).toBe(true);
    expect(isSnapshotPath(`deepdive/${id(1)}.json`)).toBe(true);
    for (const bad of ["manifest.json", "../feed.json", `deepdive/${XSS}.json`, "deepdive/../../x.json", `deepdive/${id(1)}.json/..`]) {
      expect(isSnapshotPath(bad), bad).toBe(false);
    }
    expect(() => blobKey("2026-11-11", XSS)).toThrow();
    expect(() => blobKey(XSS, "c".repeat(64))).toThrow();
    expect(() => manifestKey(XSS)).toThrow();
    expect(blobKey("2026-11-11", "c".repeat(64))).toBe(`snapshots/2026-11-11/blobs/${"c".repeat(64)}.json`);
  });
});

// ---- Manifest and merge ----------------------------------------------------------

describe("snapshot manifest", () => {
  const f = (p: string, content: string) => ({ path: p, bytes: content.length, sha256: sha256Hex(content) });
  const files = [f("weekly.json", "abc"), f("feed.json", "ab")];
  const base = { date: "2026-11-11", printedAt: "2026-11-11T20:09:28Z", commit: COMMIT, capturedAt: "2026-11-12T12:00:00Z", files, missing: [] };

  it("hashes what was printed, not when, in what order, or at which void news commit it was read", () => {
    const a = buildManifest(base);
    const b = buildManifest({ ...base, capturedAt: "2026-11-12T23:40:00Z", files: [...files].reverse(), commit: COMMIT2 });
    expect(a.content_sha256).toBe(b.content_sha256);
    expect(b.source.commit).toBe(COMMIT2); // kept as provenance
    expect(b.files.every((x: { commit: string }) => x.commit === COMMIT2)).toBe(true);
    expect(a.files.map((x: { path: string }) => x.path)).toEqual(["feed.json", "weekly.json"]);
    expect(a.total_bytes).toBe(5);
    expect(validateManifest(a)).toEqual([]);
  });

  it("changes when any file or what is missing changes", () => {
    const a = buildManifest(base).content_sha256;
    expect(buildManifest({ ...base, files: [files[0], f("feed.json", "zz")] }).content_sha256).not.toBe(a);
    expect(buildManifest({ ...base, missing: [{ cluster_id: id(9), reason: "not_found" }] }).content_sha256).not.toBe(a);
  });

  it("an unrelated void news commit with the same edition is unchanged, not a replace", () => {
    const stored = buildManifest(base);
    expect(planSnapshot(stored, { ...base, commit: COMMIT2, capturedAt: "later" }).action).toBe("unchanged");
    expect(planSnapshot(null, base).action).toBe("write");
  });

  it("a worse later capture of the same edition loses nothing: stored files stay, new ones are added, missing only shrinks", () => {
    const dd = (n: number) => f(`deepdive/${id(n)}.json`, `dd${n}`);
    const stored = buildManifest({ ...base, files: [...files, dd(1), dd(2)], missing: [{ cluster_id: id(3), reason: "not_found" }] });
    // Later capture: deep dive 2 is gone (void news dropped it), 3 has appeared, 1 is the same.
    const later = { ...base, commit: COMMIT2, files: [...files, dd(1), dd(3)], missing: [{ cluster_id: id(2), reason: "not_found" }] };
    const plan = planSnapshot(stored, later);
    expect(plan.action).toBe("merge");
    expect(deepPaths(plan.manifest)).toEqual([`deepdive/${id(1)}.json`, `deepdive/${id(2)}.json`, `deepdive/${id(3)}.json`]);
    expect(plan.manifest.missing).toEqual([]);
    expect(plan.superseded).toEqual([]);
    // Kept files keep the commit they were read at; new ones carry the new one.
    const commitOf = (p: string) => plan.manifest.files.find((x: { path: string }) => x.path === p).commit;
    expect(commitOf(`deepdive/${id(2)}.json`)).toBe(COMMIT);
    expect(commitOf(`deepdive/${id(3)}.json`)).toBe(COMMIT2);
  });

  it("takes a new weekly issue for the same edition and supersedes only the old weekly copy", () => {
    const stored = buildManifest(base);
    const plan = planSnapshot(stored, { ...base, files: [files[1], f("weekly.json", "issue34")] });
    expect(plan.action).toBe("merge");
    expect(plan.manifest.files.find((x: { path: string }) => x.path === "weekly.json").sha256).toBe(sha256Hex("issue34"));
    expect(plan.superseded).toEqual([sha256Hex("abc")]);
  });

  it("a later printing replaces the day whole; an earlier one changes nothing", () => {
    const stored = buildManifest(base);
    const reprint = planSnapshot(stored, { ...base, printedAt: "2026-11-11T22:00:00Z", files: [f("feed.json", "new"), files[0]] });
    expect(reprint.action).toBe("replace");
    expect(reprint.superseded).toEqual([sha256Hex("ab")]);
    const backfill = planSnapshot(stored, { ...base, printedAt: "2026-11-11T09:00:00Z", files: [f("feed.json", "old")] });
    expect(backfill.action).toBe("older");
    expect(backfill.manifest).toBe(stored);
  });

  it("refuses a stored manifest whose paths could escape the snapshot", () => {
    const m = buildManifest(base);
    expect(validateManifest({ ...m, files: [{ path: "../../x", bytes: 1, sha256: "0".repeat(64) }] })).not.toEqual([]);
    expect(validateManifest({ ...m, date: XSS })).not.toEqual([]);
    expect(validateManifest({ ...m, files: [{ ...m.files[0], commit: XSS }] })).not.toEqual([]);
    expect(validateManifest({ ...m, missing: [{ cluster_id: XSS, reason: "x" }] })).not.toEqual([]);
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
    expect(deepPaths(r.manifest)).toHaveLength(1);
    expect(r.manifest.missing).toEqual([
      { cluster_id: id(2), reason: "over_total_cap" },
      { cluster_id: id(3), reason: "over_total_cap" },
    ]);
    expect(r.manifest.total_bytes).toBeLessThanOrEqual(limits.maxTotalBytes);
    await expect(run(tmp(), files, { limits: { ...limits, maxFileBytes: 10 } })).rejects.toThrow(/too_large/);
  });

  it("budget.yaml's R2 row covers a year at the total cap within the uploader's bucket share", () => {
    expect(366 * LIMITS.maxTotalBytes).toBeLessThanOrEqual(BUCKET_CAP_BYTES);
    const budget = parseYaml(readFileSync(path.join(root, "budget.yaml"), "utf8")) as { alert_at: number; quotas: { name: string; ceiling: number; estimate_at_1000_users_per_day: number }[] };
    const r2 = budget.quotas.find((q) => q.name === "r2_storage_gb")!;
    expect(r2.estimate_at_1000_users_per_day).toBeGreaterThan(0);
    expect(BUCKET_CAP_BYTES / 1024 ** 3).toBeLessThanOrEqual(r2.ceiling * budget.alert_at);
    // Class A: one new day of up to 64 objects a day, plus two heartbeats; a
    // re-run of the same edition writes only the heartbeat.
    const a = budget.quotas.find((q) => q.name === "r2_class_a_ops_per_month")!;
    expect(a.estimate_at_1000_users_per_day).toBeGreaterThanOrEqual(31 * (LIMITS.maxDeepDives + 3 + 3 + 2));
    expect(a.estimate_at_1000_users_per_day).toBeLessThanOrEqual(a.ceiling * budget.alert_at);
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

  it("re-run for the same printed day writes nothing, even after void news moved on to a new commit", async () => {
    const out = tmp();
    const files = repoFiles();
    const first = await run(out, files);
    const mf = path.join(out, "2026-11-11", "manifest.json");
    const before = statSync(mf).mtimeMs;
    const again = await run(out, files, { now: () => new Date("2026-11-12T23:40:00Z"), resolveCommit: () => COMMIT2 });
    expect(again.action).toBe("unchanged");
    expect(again.manifest.content_sha256).toBe(first.manifest.content_sha256);
    expect(statSync(mf).mtimeMs).toBe(before);
    expect(JSON.parse(readFileSync(mf, "utf8")).captured_at).toBe("2026-11-12T12:00:05.000Z");
  });

  it("a later capture of the same edition missing a deep dive keeps the stored one on disk", async () => {
    const out = tmp();
    await run(out, repoFiles("2026-11-11T20:00:00Z", [1, 2, 3]));
    const worse = repoFiles("2026-11-11T20:00:00Z", [1, 2, 3]);
    delete worse[PATHS.deepdive(id(2))];
    const r = await run(out, worse, { resolveCommit: () => COMMIT2 });
    expect(r.action).toBe("unchanged");
    expect(existsSync(path.join(out, "2026-11-11", "deepdive", `${id(2)}.json`))).toBe(true);
    expect(r.manifest.missing).toEqual([]);
  });

  it("replaces the day when void news reprints it later, and drops files the new printing lacks", async () => {
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

  it(`stops asking after ${MAX_CONSECUTIVE_FAILURES} deep-dive failures in a row`, async () => {
    const ids = Array.from({ length: MAX_CONSECUTIVE_FAILURES + 3 }, (_, i) => i + 1);
    const files = repoFiles("2026-11-11T20:09:28Z", ids);
    for (const n of ids) files[PATHS.deepdive(id(n))] = { status: 500 };
    const fake = fakeFetch(files);
    const r = await runSnapshot({ outDir: tmp(), fetchImpl: fake.impl, sleep: noSleep, resolveCommit: () => COMMIT });
    const asked = new Set(fake.calls.map((c) => c.url).filter((u) => u.includes("/deepdive/")));
    expect(asked.size).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(r.manifest.missing.filter((m: { reason: string }) => m.reason === "skipped_after_failures")).toHaveLength(3);
  });

  it("retries a transient failure with backoff, honouring Retry-After up to a minute", async () => {
    let n = 0;
    const waits: number[] = [];
    const impl = (async () =>
      ++n === 1
        ? new Response("busy", { status: 429, headers: { "retry-after": "7" } })
        : n === 2
          ? new Response("busy", { status: 503, headers: { "retry-after": "9999" } })
          : n === 3
            ? new Response("busy", { status: 503 })
            : new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const r = await politeGet("https://example.org/x", { fetchImpl: impl, sleep: async (ms: number) => void waits.push(ms) });
    expect(r.status).toBe("ok");
    expect(waits).toEqual([7000, 60000, 4000]);
    expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(0);
    expect(retryAfterMs("soon")).toBeNull();
  });

  it("cancels every body it does not read", async () => {
    let cancelled = 0;
    const body = () => new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("x")); }, cancel() { cancelled++; } });
    const statuses = [503, 404];
    const impl = (async () => new Response(body(), { status: statuses.shift()! })) as unknown as typeof fetch;
    expect(await politeGet("https://example.org/x", { fetchImpl: impl, sleep: noSleep })).toEqual({ status: "not_found" });
    expect(cancelled).toBe(2);
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
  const ops: string[] = [];
  let sizeCalls = 0;
  return {
    objects,
    ops,
    sizeCalls: () => sizeCalls,
    get: (k: string) => objects.get(k) ?? null,
    put: (k: string, file: string) => {
      ops.push(`put ${k}`);
      objects.set(k, readFileSync(file, "utf8"));
    },
    delete: (k: string) => {
      ops.push(`delete ${k}`);
      objects.delete(k);
    },
    bucketBytes: () => {
      sizeCalls++;
      return bytes;
    },
  };
}
const puts = (s: ReturnType<typeof memoryStore>) => s.ops.filter((o) => o.startsWith("put ")).map((o) => o.slice(4));
const storedManifest = (s: ReturnType<typeof memoryStore>, date = "2026-11-11") => JSON.parse(s.objects.get(manifestKey(date))!);

describe("snapshot upload to R2", () => {
  it("puts content-named blobs first, then the manifest, the index, the latest pointer and the heartbeat", async () => {
    const r = await run(tmp(), repoFiles());
    const store = memoryStore();
    expect(uploadSnapshot({ dir: r.dir, store, now: () => new Date("2026-11-12T12:01:00Z") })).toBe("write");
    const n = r.manifest.files.length;
    expect(puts(store).slice(0, n).every((k) => /^snapshots\/2026-11-11\/blobs\/[0-9a-f]{64}\.json$/.test(k))).toBe(true);
    expect(puts(store).slice(n)).toEqual([manifestKey("2026-11-11"), INDEX_KEY, LATEST_KEY, HEARTBEAT_KEY]);
    for (const f of storedManifest(store).files) expect(sha256Hex(store.objects.get(blobKey("2026-11-11", f.sha256))!)).toBe(f.sha256);
    expect(readIndex(store.objects.get(INDEX_KEY)!).dates.map((d: { date: string }) => d.date)).toEqual(["2026-11-11"]);
    expect(JSON.parse(store.objects.get(HEARTBEAT_KEY)!)).toMatchObject({ schema: 1, result: "write", date: "2026-11-11", ran_at: "2026-11-12T12:01:00.000Z" });
  });

  it("re-uploading the same edition from a new void news commit writes only the heartbeat", async () => {
    const store = memoryStore();
    uploadSnapshot({ dir: (await run(tmp(), repoFiles())).dir, store });
    store.ops.length = 0;
    const again = await run(tmp(), repoFiles(), { resolveCommit: () => COMMIT2 });
    expect(uploadSnapshot({ dir: again.dir, store })).toBe("unchanged");
    expect(store.ops).toEqual([`put ${HEARTBEAT_KEY}`]);
  });

  it("a fresh runner's worse capture of the same edition merges into R2 and never deletes a stored file", async () => {
    const store = memoryStore();
    uploadSnapshot({ dir: (await run(tmp(), repoFiles("2026-11-11T20:00:00Z", [1, 2, 3]))).dir, store });
    const before = storedManifest(store);
    // The 23:43 run on a fresh runner: deep dive 2 failed, a new weekly issue landed.
    const worse = repoFiles("2026-11-11T20:00:00Z", [1, 2, 3], weekly(34));
    worse[PATHS.deepdive(id(2))] = { status: 404 };
    store.ops.length = 0;
    expect(uploadSnapshot({ dir: (await run(tmp(), worse, { resolveCommit: () => COMMIT2 })).dir, store })).toBe("merge");
    const after = storedManifest(store);
    expect(deepPaths(after)).toEqual(deepPaths(before));
    expect(after.missing).toEqual([]);
    expect(after.weekly_issue).toBe(34);
    // Only the new weekly blob went up; the old weekly blob went after the manifest.
    const oldWeekly = before.files.find((f: { path: string }) => f.path === "weekly.json").sha256;
    const newWeekly = after.files.find((f: { path: string }) => f.path === "weekly.json").sha256;
    expect(store.ops[0]).toBe(`put ${blobKey("2026-11-11", newWeekly)}`);
    const iManifest = store.ops.indexOf(`put ${manifestKey("2026-11-11")}`);
    const iDelete = store.ops.indexOf(`delete ${blobKey("2026-11-11", oldWeekly)}`);
    expect(iDelete).toBeGreaterThan(iManifest);
    expect(store.ops.filter((o) => o.startsWith("delete "))).toHaveLength(1);
    for (const f of after.files) expect(store.objects.has(blobKey("2026-11-11", f.sha256))).toBe(true);
  });

  it("a later printing replaces the day, deleting superseded blobs only after the new manifest lands", async () => {
    const store = memoryStore();
    uploadSnapshot({ dir: (await run(tmp(), repoFiles("2026-11-11T12:00:00Z", [1, 2, 3]))).dir, store });
    store.ops.length = 0;
    expect(uploadSnapshot({ dir: (await run(tmp(), repoFiles("2026-11-11T20:00:00Z", [1, 4]))).dir, store })).toBe("replace");
    const iManifest = store.ops.indexOf(`put ${manifestKey("2026-11-11")}`);
    const deletes = store.ops.map((o, i) => [o, i] as const).filter(([o]) => o.startsWith("delete "));
    expect(deletes.length).toBeGreaterThan(0);
    expect(deletes.every(([, i]) => i > iManifest)).toBe(true);
    for (const f of storedManifest(store).files) expect(store.objects.has(blobKey("2026-11-11", f.sha256))).toBe(true);
    const blobs = [...store.objects.keys()].filter((k) => k.includes("/blobs/"));
    expect(blobs).toHaveLength(storedManifest(store).files.length);
  });

  it("an earlier printing, replayed from a backfill, changes nothing", async () => {
    const store = memoryStore();
    uploadSnapshot({ dir: (await run(tmp(), repoFiles("2026-11-11T20:00:00Z"))).dir, store });
    store.ops.length = 0;
    expect(uploadSnapshot({ dir: (await run(tmp(), repoFiles("2026-11-11T12:00:00Z", [9]))).dir, store })).toBe("older");
    expect(store.ops).toEqual([`put ${HEARTBEAT_KEY}`]);
  });

  it("never moves the latest pointer back for a late or replayed older day", async () => {
    const out = tmp();
    const newer = await run(out, repoFiles("2026-11-11T20:00:00Z"));
    const older = await run(out, repoFiles("2026-11-09T12:00:00Z"));
    const store = memoryStore();
    uploadSnapshot({ dir: newer.dir, store });
    uploadSnapshot({ dir: older.dir, store });
    expect(JSON.parse(store.objects.get(LATEST_KEY)!).date).toBe("2026-11-11");
    expect(readIndex(store.objects.get(INDEX_KEY)!).dates.map((d: { date: string }) => d.date)).toEqual(["2026-11-09", "2026-11-11"]);
  });

  it("refuses to grow the bucket past this product's cap, and uploads nothing", async () => {
    const r = await run(tmp(), repoFiles());
    const store = memoryStore(1000);
    expect(() => uploadSnapshot({ dir: r.dir, store, capBytes: 1500 })).toThrow(/cap/);
    expect(store.ops).toEqual([]);
  });

  it("counts a backfill's own uploads against the cap, with the index's total as a floor", async () => {
    const out = tmp();
    const a = await run(out, repoFiles("2026-11-09T12:00:00Z"));
    const b = await run(out, repoFiles("2026-11-10T12:00:00Z"));
    const store = memoryStore(0); // wrangler's size figure lags uploads
    const budget = { used: null as number | null };
    uploadSnapshot({ dir: a.dir, store, budget });
    const afterOne = budget.used!;
    expect(afterOne).toBeGreaterThanOrEqual(a.manifest.total_bytes);
    expect(() => uploadSnapshot({ dir: b.dir, store, budget, capBytes: afterOne + 100 })).toThrow(/cap/);
    expect(store.sizeCalls()).toBe(1);
    // A fresh run sees the stored index's total even when the bucket says 0.
    expect(() => uploadSnapshot({ dir: b.dir, store: { ...store, bucketBytes: () => 0 }, capBytes: a.manifest.total_bytes + 100 })).toThrow(/cap/);
  });

  it("refuses an unreadable stored index rather than rewriting it from one date", async () => {
    const r = await run(tmp(), repoFiles());
    const store = memoryStore();
    store.objects.set(INDEX_KEY, "{oops");
    expect(() => uploadSnapshot({ dir: r.dir, store })).toThrow(/index/);
    store.objects.set(INDEX_KEY, JSON.stringify({ schema: 2, dates: [] }));
    expect(() => uploadSnapshot({ dir: r.dir, store })).toThrow(/index/);
    expect(store.ops).toEqual([]);
  });

  it("refuses a local snapshot whose files no longer match their manifest", async () => {
    const r = await run(tmp(), repoFiles());
    writeFileSync(path.join(r.dir, "feed.json"), "{}");
    const store = memoryStore();
    expect(() => uploadSnapshot({ dir: r.dir, store })).toThrow(/does not match/);
    expect(store.ops).toEqual([]);
  });

  it("treats a corrupt stored manifest as absent and re-sends every blob", async () => {
    const r = await run(tmp(), repoFiles());
    const plan = planUpload({ local: r.manifest, remote: { manifest: "{oops", index: null, latest: null }, ranAt: "2026-11-12T00:00:00Z" });
    expect(plan.action).toBe("write");
    expect(plan.puts.filter((p: { sha256?: string }) => p.sha256)).toHaveLength(r.manifest.files.length);
  });

  it("finds snapshots in a downloaded artifact's nested layout, oldest first", async () => {
    const dl = tmp();
    const a = await run(path.join(dl, "snapshot-2026-11-10-111", "snapshots-out"), repoFiles("2026-11-10T12:00:00Z"));
    const b = await run(path.join(dl, "snapshot-2026-11-09-222"), repoFiles("2026-11-09T12:00:00Z"));
    mkdirSync(path.join(dl, "2026-11-08")); // no manifest: not a snapshot
    expect(findSnapshotDirs(dl)).toEqual([b.dir, a.dir]);
    cpSync(a.dir, path.join(dl, "copy", "2026-11-10"), { recursive: true });
    expect(findSnapshotDirs(dl)).toHaveLength(3);
  });

  it("reads wrangler's bucket size, erring high", () => {
    expect(parseSize("0 B")).toBe(0);
    expect(parseSize("923 MB")).toBe(923 * 1024 ** 2);
    expect(parseSize("2.5 kB")).toBe(2560);
    expect(() => parseSize("lots")).toThrow();
  });
});

// ---- The workflows (rule 10) ----------------------------------------------------------

type Step = { name?: string; if?: string; run?: string; env?: Record<string, string> };
describe("snapshot workflow", () => {
  const text = readFileSync(path.join(root, ".github", "workflows", "snapshot.yml"), "utf8");
  const wf = parseYaml(text) as { on: { schedule: { cron: string }[] }; jobs: Record<string, { env?: Record<string, string>; steps: Step[] }> };
  const steps = wf.jobs.snapshot.steps;

  it("runs daily just after 12:00 UTC, plus a late-edition catch, off the busy minutes", () => {
    expect(wf.on.schedule.map((s) => s.cron)).toEqual(["17 12 * * *", "43 23 * * *"]);
  });

  it("declares owner, kill_after_idle_days and a heartbeat_url on this product's Worker", () => {
    expect(text).toMatch(/^#\s+owner: \S+/m);
    expect(text).toMatch(/^#\s+kill_after_idle_days: \d+$/m);
    expect(text).toMatch(/^#\s+heartbeat_url: https:\/\/omnibus\.voidvision\.org\/api\/snapshots\/heartbeat$/m);
  });

  it("gives the token only to the R2 step, and skips R2 with a warning when it is missing, never by swallowing a failure", () => {
    expect(wf.jobs.snapshot.env).toEqual({ HAS_R2: "${{ secrets.CLOUDFLARE_API_TOKEN != '' }}" });
    const withToken = steps.filter((s) => JSON.stringify(s).includes("secrets.CLOUDFLARE_API_TOKEN"));
    expect(withToken.map((s) => s.name)).toEqual(["Store it in R2"]);
    expect(steps.find((s) => s.name === "Store it in R2")!.if).toContain("env.HAS_R2 == 'true'");
    expect(steps.find((s) => s.name === "R2 is not configured")!.run).toContain("::warning");
    expect(text).not.toMatch(/continue-on-error|\|\|\s*true|\|\|\s*echo/);
  });

  it("verify-production checks the heartbeat, failing on anything but 200, once SNAPSHOT_R2_ENABLED is true", () => {
    const vp = parseYaml(readFileSync(path.join(root, ".github", "workflows", "verify-production.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
    const all = vp.jobs.verify.steps;
    const i = all.findIndex((s) => s.name === "Check the daily snapshot's heartbeat");
    expect(i).toBeGreaterThan(-1);
    expect(all[i].if).toContain("vars.SNAPSHOT_R2_ENABLED == 'true'");
    expect(all[i].run).toContain("https://omnibus.voidvision.org/api/snapshots/heartbeat");
    expect(all[i].run).toMatch(/!= "200"[\s\S]*exit 1/);
    const issue = all.findIndex((s) => s.name === "Open or update the prod-red issue on failure");
    expect(issue).toBeGreaterThan(i);
  });
});

// ---- The week record from snapshots ------------------------------------------------

describe("normalise-week from snapshots", () => {
  async function buildWeek(rootDir: string, opts: { skipDay?: string; tamper?: boolean } = {}) {
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
      await runSnapshot({ outDir: rootDir, fetchImpl: fakeFetch(files).impl, sleep: noSleep, resolveCommit: () => (i === 7 ? COMMIT2 : COMMIT) });
    }
    if (opts.tamper) writeFileSync(path.join(rootDir, "2026-11-04", "feed.json"), JSON.stringify(feedOf("2026-11-04T14:00:00Z", [9])));
    const { normaliseWeek } = await import("../scripts/lib/normalise.mjs");
    const { dirReader, snapshotSource } = await import("../scripts/lib/week-sources.mjs");
    const source = snapshotSource(dirReader(rootDir));
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

  it("reads the same week back from R2 by content key", async () => {
    const local = tmp();
    await buildWeek(local);
    const store = memoryStore();
    for (const d of findSnapshotDirs(local)) uploadSnapshot({ dir: d, store });
    const { normaliseWeek } = await import("../scripts/lib/normalise.mjs");
    const { r2Reader, snapshotSource } = await import("../scripts/lib/week-sources.mjs");
    const source = snapshotSource(r2Reader(store, tmp()));
    source.echo = async (p: string) => ({ text: "slug: spanish-flu-1918\ntitle: t\ndate_display: '1918'\n", link: `https://github.com/aacrit/void--news/blob/${COMMIT2}/${p}` });
    const w = await normaliseWeek(source, 33);
    expect(w.days.filter((d: { available: boolean }) => d.available)).toHaveLength(7);
    expect(w.lead.ledger.map((a: { headline: string }) => a.headline)).toEqual(["Headline 100"]);
    expect(w.normalised_from.snapshots.store).toBe("r2://omnibus/snapshots");
  });

  it("says plainly when no snapshot holds the issue", async () => {
    const rootDir = tmp();
    const { normaliseWeek } = await import("../scripts/lib/normalise.mjs");
    const { dirReader, snapshotSource } = await import("../scripts/lib/week-sources.mjs");
    await expect(normaliseWeek(snapshotSource(dirReader(rootDir)), 33)).rejects.toThrow(/no snapshot .* holds weekly issue 33/);
  });
});
