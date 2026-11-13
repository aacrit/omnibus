// Rights fix round 4: a video's cuts are found in the file itself, never taken from a report;
// a file that shows bodies airs only through a fit clear of them, and the dignity list carries the span.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cutsDisagree, detectCuts, ffmpegVersion, parseShowinfo } from "../scripts/lib/rights/scenes.mjs";
import { dignityHit, fetchRequests, spanLeftOut } from "../scripts/lib/rights/fetcher.mjs";
import { bodiesProblems, marksProblems, sparseShots } from "../scripts/lib/rights/licences.mjs";
import { lintLicenceAllowlist } from "../scripts/lib/rights/lints.mjs";
import { resolveRequests } from "../scripts/lib/rights/resolve.mjs";

const AT = "2026-11-13T12:00:00Z";
const HAVE_FFMPEG = ffmpegVersion() !== null;
// e33-day2-pic over its aired 0..14.5 s at threshold 0.2 (the 3.033 s cut scores 0.294), and one frame per shot the
// verifier must sign, at most 2.5 s apart with each shot's edges.
const D2_CUTS = [3.033, 5.9, 8.5, 11.433];
const D2_FRAMES = [1.517, 4.467, 7.2, 9.967, 12.967];
const FF = "ffmpeg version 9.0.1";

/** Two flat grey shots whose cut scores 0.29 in ffmpeg's scene filter (0x404040 to 0x626262), lossless. */
function softCutClip(dir: string) {
  const out = path.join(dir, "soft.mkv");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404040:s=64x48:r=10:d=1", "-f", "lavfi", "-i", "color=c=0x626262:s=64x48:r=10:d=1", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "ffv1", "-threads", "1", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}

/** A tiny synthetic clip: three 1 s shots (red, blue, the test pattern) at 10 fps, hard cuts at 1 s and 2 s. */
function threeShotClip(dir: string) {
  const out = path.join(dir, "three.mp4");
  const src = (s: string) => ["-f", "lavfi", "-i", `${s}s=64x48:r=10:d=1`];
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...src("color=c=red:"), ...src("color=c=blue:"), ...src("testsrc="), "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0", "-c:v", "mpeg4", "-q:v", "5", "-threads", "1", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}

describe("rights fix 4: the cuts come from the file", () => {
  it("parses showinfo's pts_time lines", () => {
    expect(parseShowinfo("[Parsed_showinfo_2 @ 0x1] n:   0 pts:  59 pts_time:5.9   duration\nnoise pts_time:1\n[Parsed_showinfo_2 @ 0x1] n:1 pts_time:11.4333 x")).toEqual([5.9, 11.433]);
  });
  it("finds the hard cuts of a synthetic clip, only over the span asked (without ffmpeg, refuses with its reason)", () => {
    if (!HAVE_FFMPEG) {
      // CI without ffmpeg: the fetcher tests below mock the detector; the real one says why it cannot run.
      expect(() => detectCuts("x.mp4")).toThrow(/ffmpeg cannot be run/);
      return;
    }
    const dir = mkdtempSync(path.join(tmpdir(), "omnibus-cuts-"));
    try {
      const f = threeShotClip(dir);
      const all = detectCuts(f);
      expect(all.times.length).toBe(2);
      expect(Math.abs(all.times[0] - 1)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(all.times[1] - 2)).toBeLessThanOrEqual(0.1);
      expect(all.ffmpeg).toMatch(/^ffmpeg version/);
      expect(all.threshold).toBe(0.2);
      const part = detectCuts(f, { fromS: 0, toS: 1.5 });
      expect(part.times.length).toBe(1);
      expect(part.span).toEqual([0, 1.5]);
      expect(detectCuts(f, { fromS: 1.5, toS: 3 }).times.length).toBe(1);
      // A cut scoring 0.29 (day 2's 3.033 s scores 0.294): found at 0.2, missed at the old 0.3.
      const soft = softCutClip(dir);
      expect(detectCuts(soft).times).toEqual([1]);
      expect(detectCuts(soft, { threshold: 0.3 }).times).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("cutsDisagree holds two lists to 0.1 s inside the span, edges aside", () => {
    expect(cutsDisagree([5.9, 8.5, 11.433], [5.9, 8.5, 11.433], [0, 14.5])).toEqual({ missing: [], extra: [] });
    expect(cutsDisagree([5.95, 8.45], [5.9, 8.5], [0, 14.5])).toEqual({ missing: [], extra: [] });
    expect(cutsDisagree([5.9, 8.5, 11.433, 44.9], [5.9, 8.5, 11.433, 14.533, 17.433, 20.267], [0, 67.868])).toEqual({ missing: [14.533, 17.433, 20.267], extra: [44.9] });
    expect(cutsDisagree([5.9, 9.0], [5.9, 8.5], [0, 14.5])).toEqual({ missing: [8.5], extra: [9] });
    expect(cutsDisagree([], [14.45], [0, 14.5])).toEqual({ missing: [], extra: [] }); // at the edge: a matter of a frame
  });
  it("a video review whose cuts the fetcher did not find (no ffmpeg named) is refused", () => {
    const r = { by: "verifier", at: AT, frames: D2_FRAMES, contact_sheet: { path: "s.png", sha256: "a".repeat(64) }, cuts: { times: D2_CUTS, threshold: 0.2, method: "ffmpeg select=gt(scene,0.2)", span: [0, 14.5] } };
    const item = (rv: any) => ({ adapter: "commons", kind: "footage", fit: { beat: "b", why: "w", in_s: 0, out_s: 14.5 }, marks_checked: { marks: [], reviewed: rv } });
    expect(marksProblems(item(r)).join()).toMatch(/cuts.ffmpeg must name the ffmpeg/);
    expect(marksProblems(item({ ...r, cuts: { ...r.cuts, ffmpeg: FF } }))).toEqual([]);
    // The verifier's signed frames (2.95, 7.2, 9.967, 12.967) miss the smoke shot 3.033..5.9 and leave 2.95 s at the start.
    const old = marksProblems(item({ ...r, frames: [2.95, 7.2, 9.967, 12.967], cuts: { ...r.cuts, ffmpeg: FF } })).join();
    expect(old).toMatch(/1 shot\(s\) unseen: 3.03..5.9 s/);
    expect(old).toMatch(/at most 2.5 s apart .* 0..2.95 s/);
    expect(marksProblems(item({ ...r, cuts: { ...r.cuts, ffmpeg: FF }, resign_required: "cuts changed" })).join()).toMatch(/needs a re-sign by the checking role/);
  });
  it("frames at most 2.5 s apart inside every shot, its edges included", () => {
    expect(sparseShots(D2_FRAMES, D2_CUTS, [0, 14.5])).toEqual([]);
    expect(sparseShots([2], [], [0, 6])).toEqual([[2, 6]]);
    expect(sparseShots([1, 3.4, 5.8], [], [0, 6])).toEqual([]);
    expect(sparseShots([1], [2], [0, 6])).toEqual([[2, 6]]);
  });

  const cand = () => ({ status: "ok", candidate: { adapter: "commons", ref: "File:K (001).webm", kind_hint: "footage", title: "K", item_url: "https://commons.wikimedia.org/wiki/File:K_(001).webm", media_url: "https://upload.wikimedia.org/k.webm", mime: "video/webm", licence: "cc-by-4.0", basis: "CC BY 4.0", credit: "SES", evidence: { url: "https://commons.wikimedia.org/wiki/File:K_(001).webm", captured_text: "Creative Commons Attribution 4.0 cc-by-4.0", captured_at: AT }, date: "2026-11-02", published_at: "2026-11-02T10:00:00Z", categories: [], keywords: [], own_work: false, ai_fields_checked: ["title"], youtube_source: 'category "Uploaded with video2commons"' } });
  const reported0 = { by: "verifier", at: AT, frames: D2_FRAMES, contact_sheet: { path: "s.png", sha256: "a".repeat(64) }, duration_s: 67.868, cuts: { times: D2_CUTS, threshold: 0.2, method: "ffmpeg select=gt(scene,0.2)" } };
  let reported: any = reported0;
  const doc = (extra: any = {}) => ({ schema: "omnibus.asset-requests/1", issue: 33, requests: [{ id: "e33-day2-pic", kind: "footage", for: "echo", title: "t", fallback: { tier: 4, text: "map" }, candidates: [{ adapter: "commons", ref: "File:K (001).webm", tier: 2, fit: { beat: "echo", why: "w", in_s: 0, out_s: 14.5 }, marks_checked: { marks: [], reviewed: reported }, ...extra }] }] });
  const run = async (detect: any, extra: any = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), "omnibus-fetch-"));
    const asked: any[] = [];
    try {
      const http = { getMedia: async (_u: string, dest: string) => (writeFileSync(dest, "x"), { status: "ok", sha256: "b".repeat(64), bytes: 1, mime: "video/webm" }) };
      const r = await fetchRequests(doc(extra), null, { adapters: { commons: { lookup: async () => cand() } }, http, mediaDir: dir, checkedBy: "t", now: () => new Date(AT), detectCuts: async (f: string, o: any) => (asked.push(o), detect(f, o)) });
      return { ...r, asked };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it("the fetcher records the file's cuts over the fit, not the reported ones", async () => {
    const r = await run((_f: string, o: any) => ({ times: D2_CUTS, threshold: 0.2, method: "m", ffmpeg: FF, span: [o.fromS, o.toS] }));
    expect(r.asked).toEqual([expect.objectContaining({ fromS: 0, toS: 14.5 })]);
    expect(r.report[0].outcome).toBe("taken");
    expect(r.ledger.items[0].marks_checked.reviewed.cuts).toEqual({ times: D2_CUTS, threshold: 0.2, method: "m", ffmpeg: FF, span: [0, 14.5] });
    expect(r.ledger.items[0].marks_checked.reviewed.resign_required).toBeUndefined();
  });
  it("a review signed against other cuts is ledgered marked for a re-sign, and the rights lint fails until it is", async () => {
    reported = { ...reported0, frames: [2.95, 7.2, 9.967, 12.967], cuts: { times: [5.9, 8.5, 11.433, 44.9], threshold: 0.3, method: "ffmpeg select=gt(scene,0.3)" } };
    try {
      const r = await run(() => ({ times: D2_CUTS, threshold: 0.2, method: "m", ffmpeg: FF, span: [0, 14.5] }));
      expect(r.report[0].outcome).toBe("taken");
      const rv = r.ledger.items[0].marks_checked.reviewed;
      expect(rv.cuts.times).toEqual(D2_CUTS);
      expect(rv.resign_required).toMatch(/missing 3.033.*unseen: 3.03..5.9 s/);
      expect(lintLicenceAllowlist({ items: r.ledger.items } as any).map((x: any) => x.message).join()).toMatch(/needs a re-sign/);
      // a review signed by the builder is refused outright, never held for a re-sign
      reported = { ...reported, by: "builder" };
      const b = await run(() => ({ times: D2_CUTS, threshold: 0.2, method: "m", ffmpeg: FF, span: [0, 14.5] }));
      expect(b.report[0].outcome).toBe("unfilled");
    } finally {
      reported = reported0;
    }
  });
  it("a shot of the file's own cuts with no frame holds the review for a re-sign; a detector failure refuses the item", async () => {
    const unseen = await run(() => ({ times: [...D2_CUTS, 13.5], threshold: 0.2, method: "m", ffmpeg: FF, span: [0, 14.5] }));
    expect(unseen.ledger.items[0].marks_checked.reviewed.resign_required).toMatch(/1 shot\(s\) unseen: 13.5..14.5 s/);
    const fails = await run(() => { throw new Error("no ffmpeg"); });
    expect(JSON.stringify(fails.ledger.rejected)).toMatch(/cuts could not be found in the file: no ffmpeg/);
  });
  it("carries shows_bodies and the excluded span; the lint holds the fit clear of it", async () => {
    const r = await run(() => ({ times: D2_CUTS, threshold: 0.2, method: "m", ffmpeg: FF, span: [0, 14.5] }), { shows_bodies: true, bodies_excluded: { from_s: 14.533, to_s: 29.2, note: "covered remains, never aired" } });
    const it_ = r.ledger.items[0];
    expect(it_.shows_bodies).toBe(true);
    expect(it_.bodies_excluded).toEqual({ from_s: 14.533, to_s: 29.2, note: "covered remains, never aired" });
    expect(bodiesProblems(it_)).toEqual([]);
    expect(bodiesProblems({ ...it_, fit: { ...it_.fit, out_s: 15 } }).join()).toMatch(/overlaps the bodies/);
    expect(bodiesProblems({ ...it_, bodies_excluded: undefined }).join()).toMatch(/never airs/);
    expect(bodiesProblems({ shows_bodies: false, bodies_excluded: it_.bodies_excluded }).join()).toMatch(/shows_bodies is not true/);
  });
  it("a dignity span refuses only a fit that reaches it; resolve lists it from the pin", async () => {
    const span = { from_s: 20.3, to_s: 26.8 };
    expect(spanLeftOut(span, { in_s: 0, out_s: 14.5 })).toBe(true);
    expect(spanLeftOut(span, { in_s: 10, out_s: 21 })).toBe(false);
    expect(spanLeftOut(span, {})).toBe(false);
    const d = [{ title_key: "k 001", sha256: "c".repeat(64), span, why: "covered remains" }];
    expect(dignityHit({ ref: "File:K (001).webm", fit: { in_s: 0, out_s: 14.5 } }, d)).toBeNull();
    expect(dignityHit({ ref: "File:K (001).webm", fit: { in_s: 0, out_s: 30 } }, d)?.why).toBe("covered remains");
    expect(dignityHit({ ref: "File:renamed.webm", sha256: "c".repeat(64) }, d)?.why).toBe("covered remains");
    const rundown = { issue: 33, asset_requests: [{ id: "e33-day2-pic", kind: "footage", for: "week-day-2", purpose: "p", fallback: "tier 4 map", ladder: [] }] };
    const pins = { "e33-day2-pic": [{ tier: 2, adapter: "commons", ref: "File:K (001).webm", fit: { beat: "b", why: "w", in_s: 0, out_s: 14.5 }, shows_bodies: true, bodies_excluded: { ...span, note: "covered remains" }, sha256: "c".repeat(64) }] };
    const out: any = await resolveRequests(rundown, { pins, http: {} });
    expect(out.dignity).toEqual([{ ref: "File:K (001).webm", title_key: "k 001", sha256: "c".repeat(64), span, why: "covered remains" }]);
    const bad = { "e33-day2-pic": [{ ...pins["e33-day2-pic"][0], fit: { beat: "b", why: "w", in_s: 0, out_s: 30 } }] };
    await expect(resolveRequests(rundown, { pins: bad, http: {} })).rejects.toThrow(/clear of the excluded 20.3..26.8 s/);
  });
});
