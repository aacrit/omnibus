// GET /api/snapshots/heartbeat: the daily snapshot's heartbeat (rule 10's
// heartbeat_url for .github/workflows/snapshot.yml). Every successful run of
// scripts/snapshot-r2.mjs writes snapshots/heartbeat.json to the R2 bucket
// `omnibus`, whether or not the printed day was new; this reads it back.
// 200 while the last run is recent, 503 once it is stale or missing, so a
// sentinel needs only the status code. One R2 read per request, behind the
// same per-client rate limit as every Worker route; nothing is written.
//
// The object is read as data and re-checked field by field: only the
// fields below, in their expected shapes, are passed on.

export interface SnapshotEnv {
  SNAPSHOTS?: R2Bucket;
}

export const HEARTBEAT_KEY = "snapshots/heartbeat.json";

// The workflow runs at 12:00 and 23:40 UTC, at most about 12.3 hours apart,
// and GitHub can start a scheduled run late. Two missed runs in a row pass
// 18 hours, and a day missed is a printed day lost, so that is stale.
export const HEARTBEAT_STALE_HOURS = 18;

const RESULTS = new Set(["write", "replace", "unchanged"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export interface Heartbeat {
  ran_at: string;
  result: string;
  date: string;
  printed_at: string;
  content_sha256: string;
}

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** The heartbeat's fields if the stored object has exactly the expected shapes, else null. */
export function readHeartbeat(value: unknown): Heartbeat | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.schema !== 1) return null;
  if (!isIso(v.ran_at) || !isIso(v.printed_at)) return null;
  if (typeof v.result !== "string" || !RESULTS.has(v.result)) return null;
  if (typeof v.date !== "string" || !DATE.test(v.date)) return null;
  if (typeof v.content_sha256 !== "string" || !HEX64.test(v.content_sha256)) return null;
  return { ran_at: v.ran_at, result: v.result, date: v.date, printed_at: v.printed_at, content_sha256: v.content_sha256 };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function handleSnapshotHeartbeat(env: SnapshotEnv, now: number = Date.now()): Promise<Response> {
  if (!env.SNAPSHOTS) return json({ ok: false, error: "not_configured" }, 503);
  let obj: R2ObjectBody | null;
  try {
    obj = await env.SNAPSHOTS.get(HEARTBEAT_KEY);
  } catch {
    return json({ ok: false, error: "store_unavailable" }, 503);
  }
  if (!obj) return json({ ok: false, error: "no_heartbeat" }, 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await obj.text());
  } catch {
    parsed = null;
  }
  const hb = readHeartbeat(parsed);
  if (!hb) return json({ ok: false, error: "unreadable" }, 503);
  const ageHours = Math.max(0, Math.round(((now - Date.parse(hb.ran_at)) / 3_600_000) * 10) / 10);
  const fresh = ageHours <= HEARTBEAT_STALE_HOURS;
  return json({ ok: fresh, ...(fresh ? {} : { error: "stale" }), ...hb, age_hours: ageHours, stale_after_hours: HEARTBEAT_STALE_HOURS }, fresh ? 200 : 503);
}
