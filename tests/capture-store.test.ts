// C5: the capture store: keys, caps in code (read against budget.yaml), over-cap puts refused with the item's
// metadata kept, dedupe by source id then sha256, and the retention sweep (pinned media kept).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
import { BUCKET, CAPS, INDEX_KEY, RETENTION, commit, emptyIndex, evidenceBytes, evidenceKey, mediaKey, pin, planPut, readIndex, serialiseIndex, sweep } from "../scripts/lib/capture-store.mjs";
import { BUCKET_CAP_BYTES as SNAPSHOT_CAP_BYTES } from "../scripts/lib/snapshot-store.mjs";
import { sha256 } from "../scripts/capture/evidence.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MiB = 1024 ** 2;
const DAY = 86_400_000;
const T0 = new Date("2026-11-06T21:41:00Z");
const hex = (c: string) => c.repeat(64);

function blob(text: string, kind = "page") {
  const bytes = Buffer.from(text);
  return { sha256: sha256(bytes), bytes: bytes.length, gz: gzipSync(bytes), kind, url: `https://example.gov/${kind}` };
}
const TERMS = blob("<p>terms</p>", "terms");
function evidenceFor(id: string, { page = true, terms = true, status = "ok", at = T0.toISOString() } = {}) {
  const p = blob(`<html>${id}</html>`);
  return {
    record: {
      schema: "omnibus.capture-evidence/1",
      source: "dvids",
      id,
      captured_at: at.replace(/\.\d{3}Z$/, "Z"),
      published_at: "2026-11-06T15:11:07Z",
      source_time: "2026-11-02",
      page: page ? { url: "u", sha256: p.sha256 } : { url: "u", sha256: null, missing: "403" },
      terms: terms ? { url: "t", sha256: TERMS.sha256 } : { url: null, sha256: null, missing: "none" },
      verdict: { adapter: "dvids", status, licence: "pd-us-federal", basis: "b", reasons: [] },
    },
    blobs: [...(page ? [p] : []), ...(terms ? [TERMS] : [])],
  };
}
const item = (id: string) => ({ source: "dvids", id, url: `https://www.dvidshub.net/video/${id}`, title: id, captured_at: T0.toISOString() });
const media = (c: string, bytes = 5 * MiB) => ({ sha256: hex(c), bytes, ext: "mp4" });

function put(index: ReturnType<typeof emptyIndex>, id: string, m: ReturnType<typeof media> | null, opts = {}, now: Date = T0) {
  return planPut({ index, item: item(id), evidence: evidenceFor(id, opts), media: m, now });
}

describe("capture-store keys and caps", () => {
  it("names media and evidence by content, in the omnibus-capture bucket", () => {
    expect(BUCKET).toBe("omnibus-capture");
    expect(mediaKey(hex("a"), "mp4")).toBe(`capture/media/${hex("a")}.mp4`);
    expect(evidenceKey(hex("b"))).toBe(`capture/evidence/${hex("b")}.gz`);
    expect(() => mediaKey("../x", "mp4")).toThrow();
    expect(() => mediaKey(hex("a"), "m/p4")).toThrow();
    expect(INDEX_KEY).toBe("capture/index.json");
  });

  it("holds the caps budget.yaml states, and they fit the account", () => {
    expect(CAPS.maxFileBytes).toBe(40 * MiB);
    expect(CAPS.maxDayBytes).toBe(100 * MiB);
    expect(CAPS.evidenceCapBytes).toBe(100 * MiB);
    expect(RETENTION).toEqual({ unpinnedMediaDays: 14, pinnedAfterAirsDays: 30, evidenceDays: 365 });
    const budget = parseYaml(readFileSync(path.join(root, "budget.yaml"), "utf8")) as { alert_at: number; quotas: Record<string, number | string>[] };
    const q = (name: string) => budget.quotas.find((x) => x.name === name)! as Record<string, number>;
    const r2 = q("r2_storage_gb");
    expect(CAPS.bucketCapBytes / 1024 ** 3).toBe(r2.capture_bucket_cap_gib);
    // Snapshots and capture together, plus the document product's ~0.9 GB, stay under the alert line.
    const worst = 0.9 + (SNAPSHOT_CAP_BYTES + CAPS.bucketCapBytes) / 1024 ** 3;
    expect(Math.abs(worst - r2.account_worst_case_gb)).toBeLessThan(0.1);
    expect(r2.account_worst_case_gb).toBeLessThanOrEqual(r2.ceiling * budget.alert_at);
    // Fourteen days of unpinned media at the day cap fit in the bucket with the evidence cap.
    expect(RETENTION.unpinnedMediaDays * CAPS.maxDayBytes).toBeLessThanOrEqual(CAPS.bucketCapBytes - CAPS.evidenceCapBytes);
    const a = q("r2_class_a_ops_per_month");
    expect(a.capture_ops).toBe(2700);
    expect(a.estimate_at_1000_users_per_day).toBeGreaterThanOrEqual(2108 + a.capture_ops);
    expect(a.estimate_at_1000_users_per_day).toBeLessThanOrEqual(a.ceiling * budget.alert_at);
    const m = q("github_actions_minutes_per_month");
    expect(m.capture_minutes).toBe(800);
    expect(m.estimate_at_1000_users_per_day).toBeGreaterThanOrEqual(240 + m.capture_minutes);
    expect(m.estimate_at_1000_users_per_day).toBeLessThanOrEqual(m.ceiling * budget.alert_at);
  });

  it("refuses a file over 40 MiB, keeping the item's metadata, evidence and the reason", () => {
    const r = put(emptyIndex(), "video:1", media("a", 40 * MiB + 1));
    expect(r.action).toBe("refused");
    expect(r.refused.join()).toMatch(/file cap/);
    expect(r.puts.every((p) => !("media" in p))).toBe(true);
    const e = r.index.items["dvids:video:1"];
    expect(e.media).toBeNull();
    expect(e.title).toBe("video:1");
    expect(e.refused.join()).toMatch(/file cap/);
    expect(e.evidence_keys.length).toBe(2);
  });

  it("refuses puts past 100 MiB a day, and takes them again the next day", () => {
    let idx = emptyIndex();
    for (let i = 0; i < 2; i++) idx = put(idx, `video:${i}`, media(String(i), 40 * MiB)).index;
    const third = put(idx, "video:2", media("2", 30 * MiB));
    expect(third.action).toBe("refused");
    expect(third.refused.join()).toMatch(/day cap/);
    const next = put(third.index, "video:2", media("2", 30 * MiB), {}, new Date(T0.getTime() + DAY));
    expect(next.action).toBe("put");
  });

  it("refuses puts past the 1.5 GiB bucket cap", () => {
    const idx = emptyIndex();
    idx.media[hex("f")] = { bytes: CAPS.bucketCapBytes - 2 * MiB, ext: "mp4", stored_at: "2026-11-01T00:00:00Z" };
    const r = put(idx, "video:9", media("9", 5 * MiB));
    expect(r.action).toBe("refused");
    expect(r.refused.join()).toMatch(/bucket cap/);
  });

  it("refuses evidence past its 100 MiB cap, and media without stored evidence", () => {
    const idx = emptyIndex();
    idx.evidence[hex("e")] = { bytes: CAPS.evidenceCapBytes, kind: "page", url: null, stored_at: "2026-11-01T00:00:00Z" };
    const r = put(idx, "video:8", media("8"));
    expect(r.action).toBe("refused");
    expect(r.refused.join()).toMatch(/evidence cap/);
    expect(r.refused.join()).toMatch(/evidence was not stored/);
  });

  it("the C4 lint refuses media whose evidence lacks the page, the terms or an ok verdict", () => {
    for (const opts of [{ page: false }, { terms: false }, { status: "refused" }]) {
      const r = put(emptyIndex(), "video:7", media("7"), opts);
      expect(r.action, JSON.stringify(opts)).toBe("refused");
      expect(r.index.items["dvids:video:7"].evidence).toBeTruthy();
    }
  });
});

describe("capture-store dedupe", () => {
  it("dedupes by source id first: a second put of a held item writes nothing", () => {
    const a = put(emptyIndex(), "video:1", media("a"));
    expect(a.action).toBe("put");
    expect(a.puts.map((p) => p.key)).toContain(mediaKey(hex("a"), "mp4"));
    const again = put(a.index, "video:1", media("b"));
    expect(again.action).toBe("duplicate");
    expect(again.puts).toEqual([]);
    expect(again.index).toBe(a.index);
  });

  it("then by sha256: the same proxy under another id is not sent again, nor an identical terms page", () => {
    const a = put(emptyIndex(), "video:1", media("a"));
    const b = put(a.index, "video:2", media("a"));
    expect(b.action).toBe("put");
    expect(b.puts.some((p) => "media" in p)).toBe(false);
    expect(b.puts.map((p) => p.key)).not.toContain(evidenceKey(TERMS.sha256));
    expect(b.index.items["dvids:video:2"].media.key).toBe(mediaKey(hex("a"), "mp4"));
    expect(Object.keys(b.index.media)).toHaveLength(1);
  });
});

describe("capture-store sweep", () => {
  function twoItems() {
    let idx = put(emptyIndex(), "video:1", media("a")).index;
    idx = put(idx, "video:2", media("b")).index;
    return idx;
  }

  it("deletes unpinned media after 14 days and keeps pinned media until the episode airs plus 30 days", () => {
    let idx = pin(twoItems(), "dvids:video:2", { issue: 34, airs_on: "2026-11-25" });
    const at15 = sweep({ index: idx, now: new Date(T0.getTime() + 15 * DAY) });
    expect(at15.deletes).toEqual([mediaKey(hex("a"), "mp4")]);
    expect(at15.index.items["dvids:video:1"].media).toBeNull();
    expect(at15.index.items["dvids:video:1"].evidence).toBeTruthy(); // evidence outlives the media
    expect(at15.index.items["dvids:video:2"].media.sha256).toBe(hex("b"));
    // Pinned with no air date yet: kept however old.
    idx = pin(twoItems(), "dvids:video:2", { issue: 34 });
    expect(sweep({ index: idx, now: new Date(T0.getTime() + 300 * DAY) }).index.items["dvids:video:2"].media).not.toBeNull();
    // Pinned: gone 30 days after it airs.
    const late = sweep({ index: at15.index, now: new Date("2026-12-26T00:00:00Z") });
    expect(late.deletes).toContain(mediaKey(hex("b"), "mp4"));
  });

  it("keeps a proxy two items share until neither keeps it", () => {
    let idx = put(emptyIndex(), "video:1", media("a")).index;
    idx = put(idx, "video:2", media("a")).index;
    idx = pin(idx, "dvids:video:2", { issue: 34, airs_on: "2026-12-30" });
    const r = sweep({ index: idx, now: new Date(T0.getTime() + 20 * DAY) });
    expect(r.deletes).not.toContain(mediaKey(hex("a"), "mp4"));
  });

  it("expires evidence at 365 days, and holds evidence to its cap oldest first, never the evidence of kept media", () => {
    const idx = pin(twoItems(), "dvids:video:2", { issue: 34 });
    const year = sweep({ index: idx, now: new Date(T0.getTime() + 366 * DAY) });
    expect(year.index.items["dvids:video:1"]).toBeUndefined();
    expect(year.index.items["dvids:video:2"]).toBeTruthy();
    // The shared terms page stays while the pinned item names it; the expired item's page goes.
    expect(year.deletes).not.toContain(evidenceKey(TERMS.sha256));
    expect(year.deletes.filter((k) => k.startsWith("capture/evidence/"))).toHaveLength(1);

    // Over the evidence cap: the oldest media-less entries go first.
    let big = emptyIndex();
    big = put(big, "video:old", null, { at: "2026-10-01T00:00:00Z" }, new Date("2026-10-01T00:00:00Z")).index;
    big = put(big, "video:new", null, {}, T0).index;
    const tight = { ...CAPS, evidenceCapBytes: evidenceBytes(big) - 1 };
    const r = sweep({ index: big, now: T0, caps: tight });
    expect(r.index.items["dvids:video:old"]).toBeUndefined();
    expect(r.index.items["dvids:video:new"]).toBeTruthy();
  });
});

describe("capture-store index and commit", () => {
  it("refuses an unreadable stored index rather than rewriting it", () => {
    expect(readIndex(null)).toEqual(emptyIndex());
    expect(() => readIndex("{oops")).toThrow(/index/);
    expect(() => readIndex(JSON.stringify({ schema: 1 }))).toThrow(/index/);
    expect(readIndex(serialiseIndex(emptyIndex()))).toEqual(emptyIndex());
  });

  it("commits the puts, then the index, then the deletes", () => {
    const ops: string[] = [];
    const store = { put: (k: string) => ops.push(`put ${k}`), delete: (k: string) => ops.push(`delete ${k}`) };
    const r = put(emptyIndex(), "video:1", media("a"));
    commit(store, { ...r, deletes: ["capture/media/x.mp4"] }, { mediaBody: () => Buffer.from("m") });
    expect(ops.at(-2)).toBe(`put ${INDEX_KEY}`);
    expect(ops.at(-1)).toBe("delete capture/media/x.mp4");
    expect(ops.filter((o) => o.startsWith("put capture/media/"))).toHaveLength(1);
    expect(() => commit(store, r)).toThrow(/media body/);
  });
});
