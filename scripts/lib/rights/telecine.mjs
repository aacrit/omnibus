// Whether a footage item is telecined (film under 3:2 pulldown), measured from the file itself, never assumed (T9c).
// The engine's A6 lint `telecine-declared` refuses a 29.97 or 59.94 clip whose ledger item does not state
// `telecined: true|false`; this is how the fetcher's ledger comes to state it. ffmpeg's idet filter over the aired
// span (the item's fit, at most WINDOW_MAX_S of it), null output, nothing encoded:
// `ffmpeg -ss <in> -t <s> -i <file> -an -vf idet -f null -`. Net-new.

import { spawnSync } from "node:child_process";
import { ffmpegBin, ffmpegVersion } from "./scenes.mjs";

export const WINDOW_MAX_S = 20;
export const METHOD = "ffmpeg idet over the aired span, null output";
/** Progressive at least this share of the frames, and repeated fields at most REPEAT_MAX: not telecined. */
export const PROGRESSIVE_MIN = 0.95;
export const REPEAT_MAX = 0.02;
/** 3:2 pulldown repeats a field in 2 of every 5 frames (40%): at least this share is telecined. */
export const REPEAT_TELECINE_MIN = 0.3;

/** idet's last (the input's) multi-frame detection and repeated-field counts from ffmpeg's stderr, or null. */
export function parseIdet(stderr) {
  let multi = null;
  let repeated = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    let m = line.match(/Multi frame detection:\s*TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)\s*Undetermined:\s*(\d+)/);
    if (m) multi = { tff: +m[1], bff: +m[2], progressive: +m[3], undetermined: +m[4] };
    m = line.match(/Repeated Fields:\s*Neither:\s*(\d+)\s*Top:\s*(\d+)\s*Bottom:\s*(\d+)/);
    if (m) repeated = { neither: +m[1], top: +m[2], bottom: +m[3] };
  }
  return multi && repeated ? { multi, repeated } : null;
}

/**
 * The decision from idet's counts (pure): { telecined: true|false } or { telecined: null, why } when the counts do
 * not decide it (interlaced video, too few frames, or a repeat share between the two thresholds). Never a guess.
 */
export function decide(counts) {
  if (!counts) return { telecined: null, why: "idet reported no counts" };
  const { multi, repeated } = counts;
  const frames = multi.tff + multi.bff + multi.progressive + multi.undetermined;
  const rep = repeated.top + repeated.bottom;
  const all = rep + repeated.neither;
  if (frames < 30 || all < 30) return { telecined: null, why: `idet read ${frames} frames: too few to decide` };
  const progressive = multi.progressive / frames;
  const share = rep / all;
  if (share >= REPEAT_TELECINE_MIN) return { telecined: true, progressive, repeated: share };
  if (progressive >= PROGRESSIVE_MIN && share <= REPEAT_MAX) return { telecined: false, progressive, repeated: share };
  return { telecined: null, progressive, repeated: share,
    why: `progressive ${(progressive * 100).toFixed(1)}%, repeated fields ${(share * 100).toFixed(1)}%: neither clean progressive nor 3:2 pulldown` };
}

/** idet's counts over [fromS, fromS + durS] of `file`, or throws with ffmpeg's own words. */
export function measure(file, { fromS = 0, durS = WINDOW_MAX_S, env = process.env } = {}) {
  const args = ["-hide_banner", "-nostats", "-threads", "2", "-ss", String(fromS), "-t", String(durS), "-i", file, "-an", "-vf", "idet", "-f", "null", "-"];
  const r = spawnSync(ffmpegBin(env), args, { encoding: "utf8", timeout: 300_000, windowsHide: true, maxBuffer: 1 << 24 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg idet failed on ${file}: ${(r.error?.message ?? String(r.stderr)).slice(-300)}`);
  return { counts: parseIdet(r.stderr), ffmpeg: ffmpegVersion(env) };
}

/** The window idet reads for an item: its fit's aired span (at most WINDOW_MAX_S from its in point), else the head. */
export function windowOf(item) {
  const a = Number(item?.fit?.in_s);
  const b = Number(item?.fit?.out_s);
  const fromS = Number.isFinite(a) && a >= 0 ? a : 0;
  const durS = Number.isFinite(b) && b > fromS ? Math.min(WINDOW_MAX_S, b - fromS) : WINDOW_MAX_S;
  return { fromS, durS };
}
