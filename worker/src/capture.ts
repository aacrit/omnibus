// GET /api/capture/heartbeat: the footage capture's heartbeat (rule 10's
// heartbeat_url for .github/workflows/capture.yml). The last step of every
// successful capture run (scripts/capture/run.mjs) writes
// capture/heartbeat.json to the private R2 bucket `omnibus-capture`; this
// reads it back. 200 while the last run is recent, 503 once it is stale,
// missing or unreadable, so a sentinel needs only the status code. One R2
// read per request, behind the per-client rate limit every Worker route
// passes; nothing is written. Only the fields below, in their expected
// shapes, are passed on: never an item, a URL or a reason.

export interface CaptureEnv {
  CAPTURE?: R2Bucket;
}

export const CAPTURE_HEARTBEAT_KEY = "capture/heartbeat.json";
export const CAPTURE_HEARTBEAT_SCHEMA = "omnibus.capture-heartbeat/1";

// Three runs a day (05:23, 13:11, 21:41 UTC), at most about 8 hours apart.
// 30 hours means three missed or failed runs in a row before this pages: a
// lone failure already opens the capture-red issue, and White House and VOA
// feeds roll over in days, not hours.
export const CAPTURE_STALE_HOURS = 30;

const STORES = new Set(["r2", "dir"]);
const LISTER = new Set(["ok", "skipped", "error"]);
const COUNTS = ["listed", "selected", "stored", "metadata", "refused", "deferred", "index_items"] as const;

export interface CaptureHeartbeat {
  ran_at: string;
  store: string;
  listers: Record<string, string>;
  listed: number;
  selected: number;
  stored: number;
  metadata: number;
  refused: number;
  deferred: number;
  index_items: number;
}

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7;

/** The heartbeat's fields if the stored object has exactly the expected shapes, else null. */
export function readCaptureHeartbeat(value: unknown): CaptureHeartbeat | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.schema !== CAPTURE_HEARTBEAT_SCHEMA || !isIso(v.ran_at)) return null;
  if (typeof v.store !== "string" || !STORES.has(v.store)) return null;
  for (const k of COUNTS) if (!isCount(v[k])) return null;
  const l = v.listers;
  if (l === null || typeof l !== "object" || Array.isArray(l)) return null;
  const listers: Record<string, string> = {};
  for (const [k, s] of Object.entries(l as Record<string, unknown>)) {
    if (!/^[a-z]{2,16}$/.test(k) || typeof s !== "string" || !LISTER.has(s)) return null;
    listers[k] = s;
  }
  if (Object.keys(listers).length === 0 || Object.keys(listers).length > 16) return null;
  const out = { ran_at: v.ran_at, store: v.store, listers } as CaptureHeartbeat;
  for (const k of COUNTS) out[k] = v[k] as number;
  return out;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function handleCaptureHeartbeat(env: CaptureEnv, now: number = Date.now()): Promise<Response> {
  if (!env.CAPTURE) return json({ ok: false, error: "not_configured" }, 503);
  let obj: R2ObjectBody | null;
  try {
    obj = await env.CAPTURE.get(CAPTURE_HEARTBEAT_KEY);
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
  const hb = readCaptureHeartbeat(parsed);
  if (!hb) return json({ ok: false, error: "unreadable" }, 503);
  const ageHours = Math.max(0, Math.round(((now - Date.parse(hb.ran_at)) / 3_600_000) * 10) / 10);
  const fresh = ageHours <= CAPTURE_STALE_HOURS;
  return json({ ok: fresh, ...(fresh ? {} : { error: "stale" }), ...hb, age_hours: ageHours, stale_after_hours: CAPTURE_STALE_HOURS }, fresh ? 200 : 503);
}
