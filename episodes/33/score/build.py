"""void omnibus issue 33, E8: render the score (theme, credits theme, Echo bed, sting) from score.yaml.

    python episodes/33/score/build.py --engine <document studio/engine/score.py> [--out D:/omnibus-media/33/score]

The notes are played by void document's pinned sampler, unchanged: score-tools whole.py (its seeded humaniser and its
block overlap-add convolution) over render.py and void-history's score.py (render_note: the nearest pinned sample,
pitched, held, released). The instruments are score-tools library.yaml's blocks by name, plus the few samples of the
same CC0 libraries that score.yaml adds with their own sha256 pins. The room is written by code here (synth_room), not
measured, so every sound in these files is a CC0 recording or this script's own synthesis. The sting is pure synthesis.

Levelling follows the engine (document studio/engine/score.py, passed as --engine and pinned by sha256): a featured cue
is set to its integrated target; the bed is band-shaped with the engine's bed_shape (A29 refined) and set so the shaped
bed measures its target, and is written twice: unshaped (what the engine's mix shapes and levels; its gain then comes to
about 0 dB) and shaped (the mix-ready copy for a hand edit). Output: 48 kHz mono 24-bit WAV and score.take.json.
"""
from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, "2")       # modest threads: the laptop's governor (one heavy job, cool CPU)

import argparse
import copy
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

import numpy as np
import yaml

HERE = Path(__file__).resolve().parent
SCORE_TOOLS = Path(os.environ.get("SCORE_TOOLS", "C:/Users/aacri/document-work/score-tools"))
sys.path.insert(0, str(SCORE_TOOLS))
import whole as W  # noqa: E402  (humanise, ola_convolve; imports render.py and void-history score.py)
import render as R  # noqa: E402
import wio  # noqa: E402

S = R.S
RATE = 48000
DARK_HZ = 7500.0     # every music cue: the engine's treble shelf (6 dB at 5 kHz) and a gentle 2nd-order roll-off here
#                      (no air layer, no bow hiss: the founder's "a lot less treble"; the sting is a pure tone, untouched)
STING = {"tones_hz": [659.2551, 659.2551 * 1.5], "durs_s": [0.300, 0.500], "attack_s": 0.015,
         "release_s": [0.050, 0.110], "target_lufs": -20.0,
         "why": "E5 then the B a pure fifth above (3:2): the second tone sits in the broadcast line-up tone's register "
                "(988.9 Hz, by 1 kHz); the theme is centred on E, so the sting is its open fifth and never clashes"}


def sha_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def load_engine(path: Path):
    spec = importlib.util.spec_from_file_location("engine_score", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def instruments(m: dict, lib: dict) -> dict:
    out = {}
    for name, blk in m["instruments"].items():
        base = copy.deepcopy(lib[blk["from_library"]])
        base["samples"] = list(base["samples"]) + list(blk.get("add_samples") or [])
        base["library_block"] = blk["from_library"]
        out[name] = base
    return out


def synth_room(cfg: dict) -> np.ndarray:
    """A room written by code: unity direct sound, six early reflections, then seeded noise decaying at rt60 (60 dB),
    its top (over about 3 kHz) dying at hf_rt60, scaled so the tail's energy sits wet_db under the direct sound."""
    rng = np.random.default_rng(int(cfg["seed"]))
    n = int((float(cfg["rt60_s"]) * 1.2 + 0.1) * RATE)
    t = np.arange(n) / RATE
    noise = rng.standard_normal(n)
    N = 1 << int(np.ceil(np.log2(2 * n)))
    F = np.fft.rfft(noise, N)
    f = np.fft.rfftfreq(N, 1.0 / RATE)
    lp = 1.0 / np.sqrt(1.0 + (f / 3000.0) ** 4)
    low = np.fft.irfft(F * lp, N)[:n]
    high = np.fft.irfft(F * np.sqrt(np.maximum(0.0, 1.0 - lp ** 2)) / np.sqrt(1.0 + (f / 7000.0) ** 4), N)[:n]
    pre = float(cfg["predelay_ms"]) / 1000.0
    tt = np.maximum(0.0, t - pre)
    tail = low * 10 ** (-3.0 * tt / float(cfg["rt60_s"])) + high * 10 ** (-3.0 * tt / float(cfg["hf_rt60_s"]))
    fade_in = np.clip((t - pre) / 0.03, 0.0, 1.0)            # the diffuse field builds over 30 ms after the pre-delay
    tail *= 0.5 - 0.5 * np.cos(np.pi * fade_in)
    tail *= np.sqrt(10 ** (float(cfg["wet_db"]) / 10) / np.sum(tail ** 2))
    h = tail.copy()
    h[0] += 1.0
    for ms, g in ((7.3, 0.30), (11.9, -0.24), (17.1, 0.19), (23.6, -0.15), (31.2, 0.11), (41.7, -0.08)):
        h[int(round(ms / 1000.0 * RATE))] += g
    return h


def render_cue(name: str, cue: dict, insts: dict, room: np.ndarray, darken=None) -> tuple[np.ndarray, dict]:
    n = int(round(float(cue["length_s"]) * RATE))
    rng = np.random.default_rng(int(cue["seed"]))
    ext, events = {}, []
    for row in cue["notes"]:
        inst, note, at, dur, vel = row[0], row[1], float(row[2]), float(row[3]), float(row[4])
        rel = float(row[5]) if len(row) > 5 else float(insts[inst].get("release_s", 0.3))
        key = f"{inst}|{rel:g}"
        if key not in ext:
            ext[key] = dict(insts[inst], release_s=rel)
        events.append((key, S.note_to_midi(note), at, dur, vel))
    played = W.humanise(events, ext, rng)            # whole.py's humaniser, seeded per cue
    cache, loops, shifts, looped = {}, 0, [], []
    dry = np.zeros(n + RATE * 4, np.float64)
    for key, midi, at, dur, vel in played:
        inst = key.split("|")[0]
        if inst not in cache:
            cache[inst] = S.instrument_samples(inst, insts[inst])
        blk = ext[key]
        s = S._nearest(cache[inst], midi)
        ratio = 2.0 ** ((midi - s.midi) / 12.0)
        shifts.append(midi - s.midi)
        if s.kind == "sustain" and (dur + float(blk["release_s"])) * s.sr * ratio > len(s.x):
            loops += 1                                # the sampler had to loop a steady region (reported; we aim at 0)
            looped.append([inst, int(midi), round(at, 2), round(dur, 2), round(len(s.x) / s.sr / ratio - float(blk['release_s']), 2)])
        y = S.render_note(cache[inst], blk, midi, dur, vel, RATE)
        y = y * 10 ** ((float(blk.get("gain_db", 0.0)) + R.HEADROOM_DB) / 20)
        i0 = int(round(at * RATE))
        dry[i0:i0 + len(y)] += y[: max(0, len(dry) - i0)]
    wet = W.ola_convolve(dry, room)[:n]
    if darken is not None:
        wet = darken(wet)
    if cue.get("start_fade_s"):
        a, b = (int(round(v * RATE)) for v in cue["start_fade_s"])
        wet[:a] = 0.0
        wet[a:b] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(b - a) / (b - a))
    if cue.get("end_fade_s"):
        a, b = (int(round(v * RATE)) for v in cue["end_fade_s"])
        wet[a:b] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(b - a) / (b - a))
        wet[b:] = 0.0
    info = {"notes": len(played), "sampler_loops": loops, "looped_notes": looped,
            "max_shift_semitones": int(max(abs(v) for v in shifts)) if shifts else 0,
            "shift_histogram": {str(k): int(v) for k, v in zip(*np.unique(np.abs(shifts), return_counts=True))}}
    return wet, info


def sting() -> np.ndarray:
    parts = []
    for hz, d, rel in zip(STING["tones_hz"], STING["durs_s"], STING["release_s"]):
        k = int(round(d * RATE))
        t = np.arange(k) / RATE
        y = np.sin(2 * np.pi * hz * t)
        env = np.ones(k)
        a, r = int(STING["attack_s"] * RATE), int(rel * RATE)
        env[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
        env[k - r:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(r) / r)
        parts.append(y * env)
    return np.concatenate(parts)


def level_to(x: np.ndarray, measured_on: np.ndarray, target: float, SC) -> tuple[np.ndarray, float]:
    lufs = SC.integrated_lufs(measured_on)
    g = target - lufs
    return x * 10 ** (g / 20), g


def decoded_sha(x32: np.ndarray) -> str:
    return hashlib.sha256(f"{RATE}:1:".encode() + np.ascontiguousarray(x32.astype(np.float32)).tobytes()).hexdigest()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", type=Path, required=True, help="document's studio/engine/score.py (origin/main)")
    ap.add_argument("--engine-rev", default="", help="the document commit the engine file was read from")
    ap.add_argument("--out", type=Path, default=Path("D:/omnibus-media/33/score"))
    a = ap.parse_args(argv)
    t_start = time.time()
    SC = load_engine(a.engine)
    m = yaml.safe_load((HERE / "score.yaml").read_text(encoding="utf-8"))
    lib = yaml.safe_load((SCORE_TOOLS / "library.yaml").read_text(encoding="utf-8"))
    insts = instruments(m, lib)
    probe = {"slug": m["slug"], "tempo_bpm": m["tempo_bpm"], "instruments": insts}
    bad = R.validate_instruments(probe)
    if bad:
        print("instrument blocks fail the rights rules:\n  " + "\n  ".join(bad))
        return 1
    a.out.mkdir(parents=True, exist_ok=True)
    outputs, cues_rec = {}, {}
    for name, cue in m["cues"].items():
        room = synth_room(m["rooms"][cue["room"]])
        x, info = render_cue(name, cue, insts, room, darken=lambda y: SC._filtered(y, lambda f: SC.shelf_mag(
            f, SC.TREBLE_HZ, SC.TREBLE_SHELF_DB) * SC.butter_mag(f, DARK_HZ, 2, "low")))
        rec = {"role": cue["role"], "length_s": cue["length_s"], "room": cue["room"], "seed": cue["seed"], **info}
        if cue["role"] == "bed":
            shaped = SC.bed_shape(x, float(SC.STANDARD["bed_lowmid_hz"]))
            x, g = level_to(x, shaped, float(cue["target_lufs"]), SC)
            shaped = shaped * 10 ** (g / 20)
            files = {f"{name}.wav": x, f"{name}.mix.wav": shaped}
            rec.update(gain_db=round(g, 2), target_lufs=cue["target_lufs"],
                       files={f"{name}.wav": "unshaped: the engine's bed input (it band-shapes and levels at the mix)",
                              f"{name}.mix.wav": "band-shaped with the engine's bed_shape at "
                                                 f"{SC.STANDARD['bed_lowmid_hz']:g} Hz and levelled: as the mix places "
                                                 "it before the duck (for a hand edit; do not shape it again)"})
        else:
            x, g = level_to(x, x, float(cue["target_lufs"]), SC)
            files = {f"{name}.wav": x}
            rec.update(gain_db=round(g, 2), target_lufs=cue["target_lufs"])
        for fn, y in files.items():
            y = y.astype(np.float32)
            wio.write(a.out / fn, y, RATE, subtype="PCM_24")
            back, _ = wio.read(a.out / fn)
            outputs[fn] = {"sha256": sha_file(a.out / fn), "decoded_sha256": decoded_sha(back.astype(np.float32)),
                           "samples": int(len(back)), "seconds": round(len(back) / RATE, 6), "cue": name}
        cues_rec[name] = rec
        print(f"  {name:16} {cue['length_s']:7.2f} s  {info['notes']:3d} notes  loops {info['sampler_loops']}  "
              f"max shift {info['max_shift_semitones']}  gain {g:+.2f} dB")
    st = sting()
    st, g = level_to(st, st, STING["target_lufs"], SC)
    wio.write(a.out / "sting.wav", st.astype(np.float32), RATE, subtype="PCM_24")
    back, _ = wio.read(a.out / "sting.wav")
    outputs["sting.wav"] = {"sha256": sha_file(a.out / "sting.wav"), "decoded_sha256": decoded_sha(back.astype(np.float32)),
                            "samples": int(len(back)), "seconds": round(len(back) / RATE, 6), "cue": "sting"}
    cues_rec["sting"] = {"role": "sting", "synthesis": "two sine tones written by build.py (no sample)", **STING,
                         "gain_db": round(g, 2)}

    used = sorted({s["file"] for blk in insts.values() for s in blk["samples"]})
    samples = []
    for name, blk in insts.items():
        for s in blk["samples"]:
            samples.append({"instrument": name, "library_block": blk["library_block"], "file": s["file"],
                            "sounding_note": s["note"], "sha256": s["sha256"], "url": s["url"],
                            "pinned_in": "score-tools library.yaml" if s in lib[blk["library_block"]]["samples"]
                            else "episodes/33/score/score.yaml (add_samples)",
                            "licence": "CC0 1.0 Universal", "licence_source": blk["licence_source"],
                            "credit_line": blk["credit_line"]})
    voidhistory = Path(S.__file__)
    take = {
        "what": "void omnibus issue 33, E8: the score's manifest (theme, credits theme, Echo bed, sting)",
        "issue": 33, "rate": RATE, "format": "WAV, mono, PCM 24-bit",
        "media_dir": str(a.out).replace("\\", "/"),
        "outputs": outputs, "cues": cues_rec,
        "pins": {
            "whole.py": {"path": str(SCORE_TOOLS / "whole.py").replace("\\", "/"), "sha256": sha_file(SCORE_TOOLS / "whole.py"),
                         "used": "humanise (seeded), ola_convolve"},
            "library.yaml": {"path": str(SCORE_TOOLS / "library.yaml").replace("\\", "/"),
                             "sha256": sha_file(SCORE_TOOLS / "library.yaml"), "used": "instrument blocks by name"},
            "render.py": {"sha256": sha_file(SCORE_TOOLS / "render.py"), "used": "HEADROOM_DB, validate_instruments"},
            "wio.py": {"sha256": sha_file(SCORE_TOOLS / "wio.py"), "used": "WAV read and write"},
            "void-history score.py": {"path": str(voidhistory).replace("\\", "/"), "sha256": sha_file(voidhistory),
                                      "used": "render_note, instrument_samples (the sampler)"},
            "engine score.py": {"source": f"document@{a.engine_rev or 'unknown'}:studio/engine/score.py",
                                "sha256": sha_file(a.engine), "used": "bed_shape, integrated_lufs (levelling)"},
            "build.py": {"sha256": sha_file(Path(__file__))},
            "score.yaml": {"sha256": sha_file(HERE / "score.yaml")},
        },
        "samples": samples, "sample_files": len(used),
        "rooms": {k: {**v, "kind": "synthesised by build.py synth_room (no measured impulse response)"}
                  for k, v in m["rooms"].items()},
        "room_tone": "none baked in: each cue is music only; the programme's room comes from the picture's own sound "
                     "and the title's CC0 room (E5)",
        "render_s": round(time.time() - t_start, 1),
    }
    (a.out / "score.take.json").write_text(json.dumps(take, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"  sting            {len(st) / RATE:7.3f} s  gain {g:+.2f} dB")
    print(f"wrote {a.out}  ({take['render_s']} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
