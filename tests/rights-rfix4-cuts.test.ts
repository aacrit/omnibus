// Rights fix round 4: a video's cuts are found in the file itself, never taken from a report;
// a file that shows bodies airs only through a fit clear of them, and the dignity list carries the span.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cutsDisagree, detectCuts, ffmpegVersion, parseShowinfo } from "../scripts/lib/rights/scenes.mjs";
import { dignityHit, fetchRequests, spanLeftOut } from "../scripts/lib/rights/fetcher.mjs";
import { bodiesProblems, marksProblems } from "../scripts/lib/rights/licences.mjs";
import { resolveRequests } from "../scripts/lib/rights/resolve.mjs";

const AT = "2026-11-13T12:00:00Z";
const HAVE_FFMPEG = ffmpegVersion() !== null;

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
      expect(all.threshold).toBe(0.3);
      const part = detectCuts(f, { fromS: 0, toS: 1.5 });
      expect(part.times.length).toBe(1);
      expect(part.span).toEqual([0, 1.5]);
      expect(detectCuts(f, { fromS: 1.5, toS: 3 }).times.length).toBe(1);
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
    const r = { by: "verifier", at: AT, frames: [2.95, 7.2, 9.967, 12.967], contact_sheet: { path: "s.png", sha256: "a".repeat(64) }, cuts: { times: [5.9, 8.5, 11.433], threshold: 0.3, method: "ffmpeg select=gt(scene,0.3)" } };
    const item = (rv: any) => ({ adapter: "commons", kind: "footage", fit: { beat: "b", why: "w", in_s: 0, out_s: 14.5 }, marks_checked: { marks: [], reviewed: rv } });
    expect(marksProblems(item(r)).join()).toMatch(/cuts.ffmpeg must name the ffmpeg/);
    expect(marksProblems(item({ ...r, cuts: { ...r.cuts, ffmpeg: "ffmpeg version 9" } }))).toEqual([]);
  });

  const cand = () => ({ status: "ok", candidate: { adapter: "commons", ref: "File:K (001).webm", kind_hint: "footage", title: "K", item_url: "https://commons.wikimedia.org/wiki/File:K_(001).webm", media_url: "https://upload.wikimedia.org/k.webm", mime: "video/webm", licence: "cc-by-4.0", basis: "CC BY 4.0", credit: "SES", evidence: { url: "https://commons.wikimedia.org/wiki/File:K_(001).webm", captured_text: "Creative Commons Attribution 4.0 cc-by-4.0", captured_at: AT }, date: "2026-11-02", published_at: "2026-11-02T10:00:00Z", categories: [], keywords: [], own_work: false, ai_fields_checked: ["title"], youtube_source: 'category "Uploaded with video2commons"' } });
  const reported = { by: "verifier", at: AT, frames: [2.95, 7.2, 9.967, 12.967], contact_sheet: { path: "s.png", sha256: "a".repeat(64) }, duration_s: 67.868, cuts: { times: [5.9, 44.9], threshold: 0.3, method: "ffmpeg select=gt(scene,0.3)" } };
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
    const r = await run((_f: string, o: any) => ({ times: [5.9, 8.5, 11.433], threshold: 0.3, method: "m", ffmpeg: "ffmpeg version 9", span: [o.fromS, o.toS] }));
    expect(r.asked).toEqual([expect.objectContaining({ fromS: 0, toS: 14.5 })]);
    expect(r.report[0].outcome).toBe("taken");
    expect(r.ledger.items[0].marks_checked.reviewed.cuts).toEqual({ times: [5.9, 8.5, 11.433], threshold: 0.3, method: "m", ffmpeg: "ffmpeg version 9", span: [0, 14.5] });
  });
  it("a shot of the file's own cuts with no frame refuses the item; a detector failure refuses it too", async () => {
    const unseen = await run(() => ({ times: [5.9, 8.5, 11.433, 13.5], threshold: 0.3, method: "m", ffmpeg: "ffmpeg version 9", span: [0, 14.5] }));
    expect(unseen.report[0].outcome).toBe("unfilled");
    expect(JSON.stringify(unseen.ledger.rejected)).toMatch(/1 shot\(s\) unseen: 13.5..14.5 s/);
    const fails = await run(() => { throw new Error("no ffmpeg"); });
    expect(JSON.stringify(fails.ledger.rejected)).toMatch(/cuts could not be found in the file: no ffmpeg/);
  });
  it("carries shows_bodies and the excluded span; the lint holds the fit clear of it", async () => {
    const r = await run(() => ({ times: [5.9, 8.5, 11.433], threshold: 0.3, method: "m", ffmpeg: "ffmpeg version 9", span: [0, 14.5] }), { shows_bodies: true, bodies_excluded: { from_s: 20.3, to_s: 26.8, note: "covered remains, never aired" } });
    const it_ = r.ledger.items[0];
    expect(it_.shows_bodies).toBe(true);
    expect(it_.bodies_excluded).toEqual({ from_s: 20.3, to_s: 26.8, note: "covered remains, never aired" });
    expect(bodiesProblems(it_)).toEqual([]);
    expect(bodiesProblems({ ...it_, fit: { ...it_.fit, out_s: 22 } }).join()).toMatch(/overlaps the bodies/);
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
