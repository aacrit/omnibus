// The cuts in a video, found from the file itself (S4 rights fix round 4): a reported cut
// list is never trusted. ffmpeg's scene filter over the aired span, null output, nothing
// encoded: `ffmpeg -to <out> -i <file> -an -vf "trim=start=<in>,select='gt(scene,T)',showinfo" -f null -`.
// The times are seconds into the file (trim keeps the file's own timestamps). Net-new.

import { spawnSync } from "node:child_process";

export const SCENE_THRESHOLD = 0.2;
export const CUT_TOLERANCE_S = 0.1;
export const SCENE_METHOD = `ffmpeg select=gt(scene,${SCENE_THRESHOLD}) over the aired span, null output`;

/** The ffmpeg the scene detector runs: DOCUMENT_FFMPEG, else ffmpeg on the PATH. */
export function ffmpegBin(env = process.env) {
  return env.DOCUMENT_FFMPEG || "ffmpeg";
}

/** ffmpeg's own first version line, or null when it cannot be run. */
export function ffmpegVersion(env = process.env) {
  const r = spawnSync(ffmpegBin(env), ["-hide_banner", "-version"], { encoding: "utf8", timeout: 20000, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout).split(/\r?\n/)[0].trim().slice(0, 200) || null;
}

/** The pts_time of every frame the showinfo filter printed (each one a cut), in order. */
export function parseShowinfo(stderr) {
  const out = [];
  for (const line of String(stderr).split(/\r?\n/)) {
    if (!/showinfo/i.test(line)) continue;
    const m = line.match(/pts_time:\s*(-?[0-9.]+(?:e-?\d+)?)/);
    if (m) out.push(Math.round(Number(m[1]) * 1000) / 1000);
  }
  return out;
}

/**
 * The cuts of `file` inside [fromS, toS] (toS null: the end of the file), found by ffmpeg.
 * Returns { times, threshold, method, ffmpeg, span } or throws with ffmpeg's own words.
 */
export function detectCuts(file, { fromS = 0, toS = null, threshold = SCENE_THRESHOLD, env = process.env } = {}) {
  const version = ffmpegVersion(env);
  if (!version) throw new Error(`ffmpeg cannot be run (${ffmpegBin(env)}); set DOCUMENT_FFMPEG`);
  // Gentle on the laptop: two decode threads, one process at a time (spawnSync), only the aired span.
  const args = ["-hide_banner", "-nostats", "-v", "info", "-threads", "2"];
  if (Number.isFinite(toS)) args.push("-to", String(toS));
  args.push("-i", String(file), "-an", "-sn", "-threads", "2", "-filter_threads", "1", "-vf", `trim=start=${Number(fromS) || 0},select='gt(scene,${threshold})',showinfo`, "-f", "null", "-");
  const r = spawnSync(ffmpegBin(env), args, { encoding: "utf8", timeout: 600000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg scene detection failed: ${String(r.error?.message ?? r.stderr).trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 300)}`);
  const times = parseShowinfo(r.stderr).filter((t) => t > (Number(fromS) || 0) + 1e-6 && (!Number.isFinite(toS) || t < toS - 1e-6));
  return { times, threshold, method: SCENE_METHOD, ffmpeg: version, span: [Number(fromS) || 0, Number.isFinite(toS) ? toS : null] };
}

/**
 * Where two cut lists disagree inside the span [a, b] (b null: open): each cut of one with no cut of
 * the other within the tolerance. A cut within the tolerance of an edge of the span is not counted
 * (whether it falls inside is a matter of a frame). Returns { missing, extra }: cuts the file has and
 * the record lacks, and cuts the record has and the file lacks.
 */
export function cutsDisagree(recorded, computed, [a, b], tol = CUT_TOLERANCE_S) {
  const inside = (t) => t > a + tol && (b === null || b === undefined || t < b - tol);
  const near = (t, list) => list.some((u) => Math.abs(u - t) <= tol + 1e-9);
  const rec = (recorded ?? []).filter((t) => Number.isFinite(t));
  const got = (computed ?? []).filter((t) => Number.isFinite(t));
  return { missing: got.filter((t) => inside(t) && !near(t, rec)), extra: rec.filter((t) => inside(t) && !near(t, got)) };
}
