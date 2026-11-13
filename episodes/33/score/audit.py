"""void omnibus issue 33, E8: the score's self-audit, measured with the engine's own functions.

    python episodes/33/score/audit.py --engine <document studio/engine/score.py> [--media D:/omnibus-media/33/score]

The checks are document's studio/engine/score.py (A29 and A29 refined) applied to the delivered WAVs, the way
render.build_mix places them: a featured cue (the theme, the credits theme) levelled to FEATURE_LUFS; the bed shaped by
bed_shape and levelled to the bed target (-32 LUFS), its low-mid and treble shares, its breathing, its holes; every
cue's self-repetition and the cross-cue matrix (score-repetition); the phone-check of a stand-in voice over the bed as
the mix ducks it (9 dB, 250 ms ramps, held through gaps under the standard's duck_hold_s). The narration is not yet
recorded (E7), so the stand-in is real Kokoro lines (af_aoede for the narrator, am_michael for the reader, the two
voices the rundown names) laid on each Echo beat's voiced budget from rundown.json, and also the worst case: the voice
band level against the ducked bed's loudest second anywhere in the 150 s. Plus what the engine does not measure: the
exact lengths, the true peak, the noise floor (no room tone is baked in; hiss over 6 kHz, the head and the tail), the
sting's two tones, and a per-part spectral summary (the arc in level and register). Writes audit.json beside the WAVs.
"""
from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, "2")

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
EP = HERE.parent
SCORE_TOOLS = Path(os.environ.get("SCORE_TOOLS", "C:/Users/aacri/document-work/score-tools"))
sys.path.insert(0, str(SCORE_TOOLS))
import whole as W  # noqa: E402  (short_term: BS.1770 3 s windows)
sys.path.insert(0, str(HERE))
import build as B  # noqa: E402  (planned_voice, READER_GATE, reader_gate)
import wio  # noqa: E402

RATE = 48000
STAND_IN = {"narrator": ["D:/document-media/narrator-audition/final/kokoro-af_aoede__L1.wav",
                         "D:/document-media/narrator-audition/final/kokoro-af_aoede__L2.wav",
                         "D:/document-media/narrator-audition/final/kokoro-af_aoede__L3.wav"],
            "reader": ["D:/document-media/partition-v3/auditions/kokoro_am_michael.wav"]}
SEGMENTS = {
    "theme": [("T1 1958 clip", 0.0, 3.0), ("T2 the macro prints", 3.0, 14.4), ("T3 lockup", 14.4, 18.0)],
    "credits": [("A the cell, cellos", 0.0, 14.0), ("B the turn: C, then D", 14.0, 28.0),
                ("C the figure to B", 28.0, 38.0), ("D chord, end board", 38.0, 45.0)],
    "echo-bed-150.mix": [("x3 White House", 0.0, 55.0), ("x4 Kumsong front", 55.0, 75.0),
                         ("x5 New Hampshire", 75.0, 105.0), ("x6 the Armory", 105.0, 150.0)],
}


def load_engine(path: Path):
    spec = importlib.util.spec_from_file_location("engine_score", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read(p) -> np.ndarray:
    x, sr = wio.read(p)
    x = np.asarray(x, np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != RATE:
        sys.path.insert(0, "C:/Users/aacri/claudeprojects/voidnews/pipeline/history")
        import score as S
        x = S.resample(x, int(round(len(x) * RATE / sr)))
    return x


def db(p, floor=-200.0) -> float:
    return float(max(10 * math.log10(max(float(p), 1e-30)), floor))


def rms_db(x) -> float:
    return round(db(np.mean(np.asarray(x, np.float64) ** 2)) if len(x) else -200.0, 1)


def band(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    N = 1 << int(np.ceil(np.log2(len(x) + 1)))
    X = np.fft.rfft(x, N)
    f = np.fft.rfftfreq(N, 1.0 / RATE)
    X[(f < lo) | (f >= hi)] = 0
    return np.fft.irfft(X, N)[: len(x)]


def true_peak_dbtp(x: np.ndarray, os_: int = 4, block: int = 1 << 16) -> float:
    """4x oversampled peak (BS.1770 true peak, by FFT interpolation on overlapping blocks)."""
    pk, pad = 0.0, 256
    for i in range(0, len(x), block):
        a, b = max(0, i - pad), min(len(x), i + block + pad)
        seg = x[a:b]
        y = np.fft.irfft(np.fft.rfft(seg), len(seg) * os_) * os_
        lo, hi = (i - a) * os_, (min(len(x), i + block) - a) * os_
        pk = max(pk, float(np.max(np.abs(y[lo:hi]))))
    return round(20 * math.log10(max(pk, 1e-12)), 2)


def loudness(SC, x) -> dict:
    st, _ = W.short_term(x)
    hop = int(0.1 * RATE)
    kw = SC._windows(SC.k_weight(x.astype(np.float32)), hop)
    kp = np.mean(kw.astype(np.float64) ** 2, axis=1)
    mom = np.convolve(kp, np.ones(4) / 4, mode="valid")
    return {"integrated_lufs": SC.integrated_lufs(x), "short_term_max_lufs": round(float(st.max()), 1),
            "momentary_max_lufs": round(-0.691 + db(mom.max()), 1), "true_peak_dbtp": true_peak_dbtp(x),
            "sample_peak_dbfs": round(20 * math.log10(float(np.max(np.abs(x))) + 1e-12), 2)}


def spectral(SC, x) -> dict:
    P = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1.0 / RATE)
    tot = P.sum() + 1e-30
    over = f >= 100
    bands = {"sub <100": (0, 100), "100-400": (100, 400), "400-1k": (400, 1000), "1k-5k": (1000, 5000),
             ">5k": (5000, 24000)}
    out = {k: round(10 * math.log10(P[(f >= a) & (f < b)].sum() / tot + 1e-12), 1) for k, (a, b) in bands.items()}
    cen = float((f[over] * P[over]).sum() / (P[over].sum() + 1e-30))
    lufs = SC.integrated_lufs(x) if len(x) >= int(0.4 * RATE) else None
    return {"lufs": lufs, "rms_dbfs": rms_db(x), "centroid_hz_over_100": round(cen), "band_share_db": out}


def stand_in_voice(SC, planned: list[dict], t0: float) -> tuple[np.ndarray, list, list, list[dict]]:
    """Real Kokoro lines, each levelled to the dialogue target, laid in the planned voice windows (build.planned_voice:
    the rundown's budgets) that fall under the bed: af_aoede in the narrator's, am_michael in the reader's, a 0.7 s
    breath between lines inside a window. Returns the voice, every line's span, the reader lines' spans, the layout."""
    lines = {k: [read(p) for p in v] for k, v in STAND_IN.items()}
    lines = {k: [y * 10 ** ((SC.DIALOGUE_LUFS - SC.integrated_lufs(y)) / 20) for y in v] for k, v in lines.items()}
    n = int(150.0 * RATE)
    v = np.zeros(n)
    spans, reader, layout = [], [], []
    k = {"narrator": 0, "reader": 0}
    for w in planned:
        a, b = w["start_s"] - t0, w["end_s"] - t0
        if not (0 <= a < 150.0):
            continue
        t, laid = a, 0.0
        while t < b - 0.5:
            y = lines[w["who"]][k[w["who"]] % len(lines[w["who"]])]
            k[w["who"]] += 1
            y = y[: int(min(len(y), (b - t) * RATE, n - int(t * RATE)))]
            i0 = int(t * RATE)
            v[i0:i0 + len(y)] += y
            spans.append((round(t, 2), round(t + len(y) / RATE, 2)))
            if w["who"] == "reader":
                reader.append(spans[-1])
            laid += len(y) / RATE
            t += len(y) / RATE + 0.7
        layout.append({"beat": w["beat"], "who": w["who"], "planned_s": [round(a, 2), round(b, 2)], "laid_s": round(laid, 1)})
    return v, spans, reader, layout


def duck_curve(n: int, spans, depth_db: float, hold_s: float, ramp_s: float = 0.25) -> np.ndarray:
    """The mix's duck as the bible states it: 9 dB under the voice, 250 ms smoothing, held through short gaps."""
    act = np.zeros(n, bool)
    merged = []
    for a, b in sorted(spans):
        if merged and a - merged[-1][1] < hold_s:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    for a, b in merged:
        act[int(a * RATE): int(b * RATE)] = True
    g = np.where(act, 10 ** (-depth_db / 20), 1.0)
    k = int(ramp_s * RATE)
    w = np.hanning(2 * k + 1)
    w /= w.sum()
    pad = np.concatenate([np.full(k, g[0]), g, np.full(k, g[-1])])
    return np.convolve(pad, w, mode="valid")[:n], merged


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", type=Path, required=True)
    ap.add_argument("--media", type=Path, default=Path("D:/omnibus-media/33/score"))
    a = ap.parse_args(argv)
    SC = load_engine(a.engine)
    take = json.loads((a.media / "score.take.json").read_text(encoding="utf-8"))
    rundown = json.loads((EP / "rundown.json").read_text(encoding="utf-8"))
    echo = next(p for p in rundown["parts"] if p["id"] == "the-echo")
    std = dict(SC.STANDARD)
    rep, checks = {}, []

    def check(rule, ok, unit, **ev):
        checks.append({"rule": rule, "ok": bool(ok), "unit": unit, "evidence": ev})

    wav = {k: read(a.media / k) for k in take["outputs"]}
    # ---- lengths
    for fn, want in (("theme.wav", 18.0), ("credits.wav", 45.0), ("echo-bed-150.wav", 150.0),
                     ("echo-bed-150.mix.wav", 150.0), ("sting.wav", 0.8)):
        check("length", len(wav[fn]) == int(round(want * RATE)), fn, samples=len(wav[fn]), seconds=len(wav[fn]) / RATE,
              want_s=want)
    # ---- per cue: loudness, bands, breath, floor, repetition features
    feats = {}
    plan = {"theme.wav": ("main_title", SC.FEATURE_LUFS, 0.0, 0.8), "credits.wav": ("main_title", SC.FEATURE_LUFS, 0.0, 1.2),
            "echo-bed-150.mix.wav": ("bed", SC.bed_lufs(std), 4.0, 3.0)}
    for fn, (role, target, fi, fo) in plan.items():
        x = wav[fn]
        L = loudness(SC, x)
        an = SC.analyse_cue(x.astype(np.float32), role, fi, fo)
        feats[fn] = SC.rep_features(x)
        r = SC.self_repetition(feats[fn])
        live = np.flatnonzero(np.abs(x) > 1e-6)
        first, last = live[0] / RATE, live[-1] / RATE
        hiss = rms_db(band(x, 6000, 24000))
        hop = int(0.1 * RATE)
        ms = np.mean(SC._windows(x, hop) ** 2, axis=1)
        inner = ms[int(first / 0.1) + 1: int(last / 0.1)]
        quiet = SC._runs(SC._db(inner) <= SC.PRESENT_DBFS) if len(inner) else []
        hole = max(((b - a) * 0.1 for a, b in quiet), default=0.0)
        sec = np.mean(SC._windows(x, RATE)[: len(x) // RATE] ** 2, axis=1)
        rep[fn] = {"role": role, **L, "target_lufs": target, "lowmid_share": an["lowmid_share"],
                   "treble_share": an["treble_share"], "sub_share": an["sub_share"], "breath_db": an["breath_db"],
                   "first_sound_s": round(first, 3), "last_sound_s": round(last, 3),
                   "tail_last_200ms_dbfs": rms_db(x[-int(0.2 * RATE):]), "hiss_over_6k_dbfs": hiss,
                   "quietest_second_in_span_dbfs": round(db(sec[int(first) + 1: int(last)].min()), 1) if last - first > 3 else None,
                   "longest_hole_s": round(hole, 1), "self_repetition": r}
        check("cue-level", L["integrated_lufs"] is not None and abs(L["integrated_lufs"] - target) <= 0.5, fn,
              integrated_lufs=L["integrated_lufs"], target_lufs=target, tol=0.5)
        check("true-peak", L["true_peak_dbtp"] <= -1.0, fn, dbtp=L["true_peak_dbtp"], max=-1.0)
        check("music-treble", an["treble_share"] <= std["music_treble_max_share"] + 1e-9, fn, share=an["treble_share"],
              max=std["music_treble_max_share"])
        if role == "bed":
            check("bed-low-end", an["lowmid_share"] <= std["bed_lowmid_max_share"] + 1e-9, fn, share=an["lowmid_share"],
                  max=std["bed_lowmid_max_share"], shaped=True)
            check("bed-breathing", an["breath_judged"] and an["breath_db"] >= std["bed_breath_db"], fn,
                  spread_db=an["breath_db"], min_db=std["bed_breath_db"])
            check("music-holes", hole <= std["music_hole_max_s"], fn, longest_s=round(hole, 1), max_s=std["music_hole_max_s"])
            head = x[: int(1.5 * RATE)]
            check("music-entry", rms_db(head[: int(0.5 * RATE)]) < rms_db(head[int(1.0 * RATE):]) - 6, fn,
                  first_500ms_dbfs=rms_db(head[: int(0.5 * RATE)]), at_1_to_1p5s_dbfs=rms_db(head[int(1.0 * RATE):]),
                  composed_fade_s=4.0, min_fade_s=std["entry_fade_min_s"])
            check("music-exit", rms_db(x[-int(0.4 * RATE):]) <= -80, fn, last_400ms_dbfs=rms_db(x[-int(0.4 * RATE):]),
                  why="silent before x7 (no music under an account of violence)")
        check("score-repetition", r["loop"] is None, fn, loop=r["loop"], max_self_similarity=r["best"])
        check("noise-floor", hiss <= -72.0 and rep[fn]["tail_last_200ms_dbfs"] <= -72.0, fn,
              hiss_over_6k_dbfs=hiss, tail_dbfs=rep[fn]["tail_last_200ms_dbfs"], max_dbfs=-72.0,
              room_tone="none baked in")
    # the unshaped bed: the engine shapes it and levels it at the mix; its gain there comes to
    shaped = SC.bed_shape(wav["echo-bed-150.wav"], float(std["bed_lowmid_hz"]))
    g_mix = SC.bed_lufs(std) - SC.integrated_lufs(shaped)
    check("bed-engine-gain", abs(g_mix) <= 0.5, "echo-bed-150.wav", engine_level_gain_db=round(g_mix, 2),
          what="the engine's bed path (bed_shape then level to -32) on the delivered unshaped bed")
    check("bed-files-agree", float(np.max(np.abs(shaped - wav["echo-bed-150.mix.wav"]))) < 1e-5,
          "echo-bed-150.mix.wav", max_abs_diff=float(np.max(np.abs(shaped - wav["echo-bed-150.mix.wav"]))))
    # ---- the cross-cue matrix
    names = list(feats)
    matrix = {}
    for i, p in enumerate(names):
        for q in names[i + 1:]:
            r = SC.cross_repetition(feats[p], feats[q])
            matrix[f"{p} x {q}"] = {k: r.get(k) for k in ("duplicate", "score", "chroma", "env", "onset", "a_at_s", "b_at_s")}
    # the two theme cues against each other and the bed, also the theme against the credits' figure (28 to 38 s)
    fc = SC.rep_features(wav["credits.wav"][int(28 * RATE): int(38 * RATE)])
    r = SC.cross_repetition(feats["theme.wav"], fc)
    matrix["theme.wav x credits.wav[28-38 s]"] = {k: r.get(k) for k in ("duplicate", "score", "chroma", "env", "onset",
                                                                        "a_at_s", "b_at_s")}
    check("score-repetition", not any(v["duplicate"] for v in matrix.values()), "cross-cue", matrix=matrix)
    # ---- the phone-check under a stand-in voice, the bed as ducked
    t = float(echo["start_s"])
    for b in echo["beats"]:
        b["start_s"], t = t, t + float(b["dur_s"])
    t0 = B.BED_AT_S
    planned = B.planned_voice(rundown)
    voice, spans, reader, layout = stand_in_voice(SC, planned, t0)
    duck, merged = duck_curve(len(voice), spans, SC.DUCK_DB, float(std["duck_hold_s"]))
    # the founder's reader gate (2026-11-12), keyed here to the planned reader windows, as the mix keys it to E7's
    planned_reader = [(w["start_s"] - t0, w["end_s"] - t0) for w in planned
                      if w["who"] == "reader" and 0 <= w["start_s"] - t0 < 150.0]
    gate, closed = B.reader_gate(len(voice), planned_reader)
    bed = wav["echo-bed-150.mix.wav"]
    ducked = bed * duck * gate
    under = []
    for a_, b_ in planned_reader:
        seg = ducked[int(a_ * RATE): int(b_ * RATE)]
        edge = ducked[int((a_ - B.READER_GATE["lead_s"]) * RATE): int((b_ + B.READER_GATE["tail_s"]) * RATE)]
        under.append({"line_s": [round(a_, 2), round(b_, 2)], "max_abs": float(np.max(np.abs(seg))),
                      "with_lead_and_tail_max_abs": float(np.max(np.abs(edge)))})
    check("no-music-under-quote", all(u["max_abs"] == 0.0 and u["with_lead_and_tail_max_abs"] <= SC.DIGITAL_ZERO
                                         for u in under), "echo-bed-150 (gated)",
          measure="exactly 0 under the words; at or under the engine's digital zero (1e-6, -120 dBFS) with the lead and tail",
          ruling=B.READER_GATE["ruling"], lines=under, closed_windows=[[round(a_, 2), round(b_, 2)] for a_, b_ in closed],
          open_ramp_s=B.READER_GATE["open_ramp_s"], min_open_ramp_s=std["entry_fade_min_s"],
          not_under_bed="x2, x8 and x9 readings: no bed plays there at all")
    check("gate-reentry", B.READER_GATE["open_ramp_s"] >= std["entry_fade_min_s"], "echo-bed-150 (gated)",
          open_ramp_s=B.READER_GATE["open_ramp_s"], min_s=std["entry_fade_min_s"],
          what="every return of the bed after a quotation is an entry from no music (A29: at least 1.5 s)")
    ph = SC.phone_check(voice.astype(np.float32), ducked.astype(np.float32), spans)
    ev = ph["checks"][0]["evidence"]
    check("phone-check", ph["checks"][0]["ok"], "stand-in voice over the ducked bed",
          **{k: ev[k] for k in ("lines", "windows", "min_margin_db", "p10_margin_db", "median_margin_db",
                                "min_margin_required_db", "under", "worst")}, layout=layout, spans=spans,
          bed="as the mix places it: ducked 9 dB under every line and gated to silence under the reader's")
    # the worst case: the voice band of the stand-in lines (their speech windows' median) against the ducked bed's
    # loudest one-second window anywhere, as if a line fell on it
    lo, hi = SC.VOICE_BAND_HZ
    pb = lambda y: SC._filtered(y, lambda f: SC.phone_mag(f) * ((f >= lo) & (f <= hi)))  # noqa: E731
    vb, bb = pb(voice), pb(bed * 10 ** (-SC.DUCK_DB / 20))
    win = RATE
    vwin = np.array([np.mean(vb[s: s + win] ** 2) for s, e in ((int(a * RATE), 0) for a, _ in spans)])
    bwin = np.array([np.mean(bb[s: s + win] ** 2) for s in range(0, len(bb) - win, win // 2)])
    worst = db(np.median(vwin)) - db(bwin.max())
    check("phone-check-worst-case", worst >= SC.PHONE_VOICE_MARGIN_DB, "bed anywhere under a line",
          margin_db=round(worst, 1), min_db=SC.PHONE_VOICE_MARGIN_DB,
          at_s=round(float(np.argmax(bwin)) * 0.5, 1))
    # the bed in the voice's gaps (bed-under-voice: the gaps' level, the duck open)
    gap = np.ones(len(voice), bool)
    for a_, b_ in merged:
        gap[int(a_ * RATE): int(b_ * RATE)] = False
    gaps = (bed * gate)[gap & (gate > 0.999)]
    gl = SC.integrated_lufs(gaps)
    check("bed-under-voice", gl is None or gl <= SC.bed_lufs(std) + SC.TOL_DB, "echo-bed-150.mix.wav",
          gaps_lufs=gl, gaps_s=round(float((gap & (gate > 0.999)).sum()) / RATE, 1), max_lufs=SC.bed_lufs(std) + SC.TOL_DB,
          measured_on="the gated bed where no voice speaks and the gate is open")
    # ---- the sting
    st = wav["sting.wav"]
    tones = []
    for a_s, b_s in ((0.0, 0.3), (0.3, 0.8)):
        seg = st[int(a_s * RATE): int(b_s * RATE)]
        P = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 1 << 20))
        f = np.fft.rfftfreq(1 << 20, 1.0 / RATE)
        env = np.abs(seg)
        on = np.flatnonzero(env > env.max() * 0.1)
        tones.append({"hz": round(float(f[np.argmax(P)]), 2), "span_s": [a_s, b_s],
                      "audible_s": round((on[-1] - on[0]) / RATE, 3)})
    sl = SC.integrated_lufs(st)
    ratio = tones[1]["hz"] / tones[0]["hz"]
    check("sting", abs(sl - (-20.0)) <= 0.5 and abs(ratio - 1.5) < 0.002 and len(st) == int(0.8 * RATE), "sting.wav",
          integrated_lufs=sl, tones=tones, ratio=round(ratio, 4), true_peak_dbtp=true_peak_dbtp(st),
          over_5k_share=SC.band_shares(st)["treble_share"])
    # ---- per-part spectral summary (the arc)
    summary = {}
    for key, segs in SEGMENTS.items():
        x = wav[key + ".wav"]
        summary[key] = [{"part": nm, "from_s": s0, "to_s": s1, **spectral(SC, x[int(s0 * RATE): int(s1 * RATE)])}
                        for nm, s0, s1 in segs]
    phone_lufs = {}
    for fn in ("theme.wav", "credits.wav", "echo-bed-150.mix.wav"):
        y = SC._filtered(wav[fn], SC.phone_mag)
        phone_lufs[fn] = {"phone_lufs": SC.integrated_lufs(y), "full_lufs": rep[fn]["integrated_lufs"]}
    out = {"engine": {"file": str(a.engine), "used": "analyse_cue, bed_shape, integrated_lufs, rep_features, "
                      "self_repetition, cross_repetition, phone_check, phone_mag, STANDARD"},
           "ok": all(c["ok"] for c in checks), "checks": checks, "cues": rep, "spectral_summary": summary,
           "phone_simulation": phone_lufs, "reader_gate": {"contract": B.READER_GATE, "planned_voice": planned,
                                                           "closed_windows_bed_clock": closed}, "stand_in_voice": STAND_IN, "duck": {"depth_db": SC.DUCK_DB, "ramp_s": 0.25,
                                                                                 "hold_s": std["duck_hold_s"]}}
    (a.media / "audit.json").write_text(json.dumps(out, indent=1, ensure_ascii=False, default=float), encoding="utf-8")
    for c in checks:
        ev = {k: v for k, v in c["evidence"].items() if k not in ("matrix", "layout", "max_self_similarity", "tones", "spans",
                                                                 "worst", "lines", "ruling")}
        print(f"  {'PASS' if c['ok'] else 'FAIL'}  {c['rule']:24} {c['unit']:34} {json.dumps(ev, default=float)[:150]}")
    print("ALL PASS" if out["ok"] else "FAILURES")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
