import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle, type Env } from "../worker/src/index";
import { HEARTBEAT_KEY, HEARTBEAT_STALE_HOURS, handleSnapshotHeartbeat, readHeartbeat } from "../worker/src/snapshots";
import { API_CSP } from "../worker/src/headers";
import { createMockAssets, createMockD1 } from "./helpers/mock-d1";
import { HEARTBEAT_KEY as UPLOADER_HEARTBEAT_KEY, planUpload } from "../scripts/lib/snapshot-store.mjs";
import { buildManifest } from "../scripts/lib/snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XSS = '"><img src=x onerror=alert(1)>';
const NOW = Date.parse("2026-11-12T13:00:00Z");

function bucket(objects: Record<string, string>, opts: { throws?: boolean } = {}): R2Bucket {
  const reads: string[] = [];
  return {
    reads,
    async get(key: string) {
      if (opts.throws) throw new Error("r2 down");
      reads.push(key);
      const body = objects[key];
      return body === undefined ? null : ({ text: async () => body } as unknown as R2ObjectBody);
    },
  } as unknown as R2Bucket;
}

const beat = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, ran_at: "2026-11-12T12:01:00.000Z", result: "write", date: "2026-11-11", printed_at: "2026-11-11T20:09:28Z", content_sha256: "c".repeat(64), ...over });

function env(objects: Record<string, string> | null, extra: Partial<Env> = {}): Env {
  return { DB: createMockD1().db, ASSETS: createMockAssets(), ...(objects ? { SNAPSHOTS: bucket(objects) } : {}), ...extra };
}

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/snapshots/heartbeat", () => {
  it("reads the uploader's heartbeat key, the one snapshot-r2.mjs writes every run", () => {
    expect(HEARTBEAT_KEY).toBe(UPLOADER_HEARTBEAT_KEY);
    const m = buildManifest({ date: "2026-11-11", printedAt: "2026-11-11T20:09:28Z", commit: "a".repeat(40), capturedAt: "x", files: [], missing: [] });
    const hb = planUpload({ manifest: m, remote: { manifest: null, index: null, latest: null }, ranAt: "2026-11-12T12:01:00.000Z" }).puts.at(-1)!;
    expect(hb.key).toBe(HEARTBEAT_KEY);
    expect(readHeartbeat(JSON.parse(hb.body!))).not.toBeNull();
  });

  it("answers 200 with the last run while it is recent", async () => {
    const res = await handleSnapshotHeartbeat(env({ [HEARTBEAT_KEY]: beat() }), NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await body(res)).toEqual({
      ok: true,
      ran_at: "2026-11-12T12:01:00.000Z",
      result: "write",
      date: "2026-11-11",
      printed_at: "2026-11-11T20:09:28Z",
      content_sha256: "c".repeat(64),
      age_hours: 1,
      stale_after_hours: HEARTBEAT_STALE_HOURS,
    });
  });

  it("answers 503 stale once the last run is older than the stale window", async () => {
    const late = NOW + (HEARTBEAT_STALE_HOURS + 1) * 3_600_000;
    const res = await handleSnapshotHeartbeat(env({ [HEARTBEAT_KEY]: beat() }), late);
    expect(res.status).toBe(503);
    expect(await body(res)).toMatchObject({ ok: false, error: "stale", date: "2026-11-11" });
  });

  it("answers 503 when nothing has run, R2 is unbound, or R2 throws", async () => {
    expect(await body(await handleSnapshotHeartbeat(env({}), NOW))).toEqual({ ok: false, error: "no_heartbeat" });
    expect(await body(await handleSnapshotHeartbeat(env(null), NOW))).toEqual({ ok: false, error: "not_configured" });
    const broken = await handleSnapshotHeartbeat({ SNAPSHOTS: bucket({}, { throws: true }) }, NOW);
    expect(broken.status).toBe(503);
    expect(await body(broken)).toEqual({ ok: false, error: "store_unavailable" });
  });

  it("passes on only checked fields: a stored value with markup or an extra field is refused, never echoed", async () => {
    for (const bad of [
      beat({ date: XSS }),
      beat({ result: XSS }),
      beat({ ran_at: XSS }),
      beat({ content_sha256: XSS }),
      beat({ schema: 2 }),
      "{not json",
      JSON.stringify([1]),
    ]) {
      const res = await handleSnapshotHeartbeat(env({ [HEARTBEAT_KEY]: bad }), NOW);
      expect(res.status, bad).toBe(503);
      const text = await res.text();
      expect(text).toBe(JSON.stringify({ ok: false, error: "unreadable" }));
      expect(text).not.toContain("<img");
    }
    const extra = await body(await handleSnapshotHeartbeat(env({ [HEARTBEAT_KEY]: beat({ note: XSS }) }), NOW));
    expect(JSON.stringify(extra)).not.toContain("<img");
    expect(extra.ok).toBe(true);
  });

  it("is a Worker route: through handle() it carries the API policy and counts against the rate limit", async () => {
    const req = () => new Request("http://internal/api/snapshots/heartbeat");
    const res = await handle(req(), env({ [HEARTBEAT_KEY]: beat({ ran_at: new Date().toISOString() }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
    const limited = await handle(req(), env({ [HEARTBEAT_KEY]: beat() }, { RL_API: { limit: async () => ({ success: false }) } }));
    expect(limited.status).toBe(429);
  });

  it("wrangler.jsonc binds SNAPSHOTS to the omnibus bucket, and /api/* runs the Worker first", () => {
    const text = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
    expect(text).toMatch(/"binding":\s*"SNAPSHOTS",\s*"bucket_name":\s*"omnibus"/);
    expect(text).toMatch(/"run_worker_first":\s*\[[^\]]*"\/api\/\*"/);
  });
});
