# Net-new in omnibus (E9i).
"""The voicing manifest: every voiced line's take, as E7 writes it, read by the engine at plan time. Pure: no I/O
(render.py reads the file, and passes a sha256 reader for the WAVs).

It is the engine's own A57 manifest (``<film>/audio/voice.json``, studio/engine/narrator.py MANIFEST, which
narrator-takes-voiced already reads) with the fields an omnibus plan needs, schema ``omnibus-voicing/1``::

    {
      "schema": "omnibus-voicing/1",
      "identity": {"engine": "kokoro", "voice": "af_aoede", "speed": 0.88, "pitch_shift_st": 0.0},
      "voices": {"<cast voice id>": {"engine": ..., "voice": ..., "speed": ..., "pitch_shift_st": ...}},
      "lines": {
        "<line id>": {
          "voice": "<cast voice id>",
          "wav": "audio/<line id>.wav",
          "sha256": "<the WAV's sha256>",
          "text_sha256": "<sha256 of the line's text as voiced>",
          "dur_s": 2.31,
          "words": [{"w": "Tuesday,", "start_s": 0.12, "end_s": 0.58}]
        }
      }
    }

- ``identity`` is the narrator's (narrator.identity of the screenplay's narrator voice): A57 holds the narration's
  takes to it. ``voices`` holds each cast voice that voiced a line (an omnibus film has two narrator speeds, the Echo's
  0.84, and its readers), and each line names the one that voiced it, which must be the line's own ``read_by`` (or
  the narrator for a narration line that names none) with that voice's identity.
- ``wav`` is relative to the film folder; ``sha256`` is the file's; ``text_sha256`` the line's text when voiced
  (narrator.sha256_text), so a line edited since is re-voiced.
- ``dur_s`` is the take's length, ``words`` its word timings in seconds from the take's start, in order, each inside
  the take. The plan reads them as the line's measured words (tour anchors, A41 and A47), placed at the line's
  ``start_s``; a line's own ``wav`` or ``words`` in the screenplay wins.

Every narration and reader (testimony) line voiced by a judged engine (Kokoro, Orpheus) needs an entry; an archival
span (A26) plays its clip's own sound and a test tone is not judged. Until E7 writes the file the plan refuses
(``voicing-manifest``), in --draft as in a final render.
"""

from __future__ import annotations

import re
from pathlib import Path

SCHEMA = "omnibus-voicing/1"
PATH = Path("audio") / "voice.json"         # = studio.engine.narrator.MANIFEST (a test holds them equal)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IDENTITY_KEYS = ("engine", "voice", "speed", "pitch_shift_st")
LINE_KEYS = {"voice", "wav", "sha256", "text_sha256", "dur_s", "words"}
VOICE_KINDS = ("narration", "testimony")
JUDGED = ("kokoro", "orpheus")              # = narrator.ENGINES


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def voiced_lines(play: dict) -> list[dict]:
    """The lines a take must exist for: narration and testimony, not an archival span (its clip's own sound)."""
    out = []
    for part in play.get("parts") or []:
        for ln in part.get("lines") or []:
            if ln.get("kind") in VOICE_KINDS and not (ln.get("archival_audio") and ln.get("clip")):   # render.archival_span
                out.append(ln)
    return out


def line_voice(play: dict, ln: dict) -> dict | None:
    """The cast voice that reads the line: its ``read_by``, else the narrator ``v-narrator`` for narration."""
    voices = {v.get("id"): v for v in (play.get("cast") or {}).get("voices") or [] if isinstance(v, dict)}
    vid = ln.get("read_by") or ("v-narrator" if ln.get("kind") == "narration" else None)
    return voices.get(vid)


def judged(play: dict) -> bool:
    """Whether any voiced line is read by a judged engine (a film of test tones has no manifest to hold)."""
    return any((line_voice(play, ln) or {}).get("engine") in JUDGED for ln in voiced_lines(play))


def line_problems(lid: str, rec, ident: dict | None) -> list[str]:
    if not isinstance(rec, dict):
        return [f"lines.{lid} is an object"]
    out = []
    extra = sorted(set(rec) - LINE_KEYS)
    if extra:
        out.append(f"lines.{lid} has unknown keys {extra} (known: {sorted(LINE_KEYS)})")
    if not (isinstance(rec.get("wav"), str) and rec["wav"].strip()) or Path(str(rec.get("wav"))).is_absolute():
        out.append(f"lines.{lid}.wav is the take's path relative to the film folder")
    for k in ("sha256", "text_sha256"):
        if not (isinstance(rec.get(k), str) and SHA256.match(rec[k])):
            out.append(f"lines.{lid}.{k} is a sha256 (64 hex)")
    dur = rec.get("dur_s")
    if not (_num(dur) and dur > 0):
        out.append(f"lines.{lid}.dur_s is the take's length in seconds")
        dur = None
    words = rec.get("words")
    if not (isinstance(words, list) and words):
        out.append(f"lines.{lid}.words lists the take's word timings")
    else:
        prev = 0.0
        for k, w in enumerate(words):
            if not (isinstance(w, dict) and isinstance(w.get("w"), str) and w["w"].strip()
                    and _num(w.get("start_s")) and _num(w.get("end_s"))):
                out.append(f"lines.{lid}.words[{k}] is {{w, start_s, end_s}}")
                break
            a, b = float(w["start_s"]), float(w["end_s"])
            if not (prev - 1e-6 <= a <= b) or (dur is not None and b > dur + 1e-3):
                out.append(f"lines.{lid}.words[{k}] is in order and inside the take ({a:g} to {b:g} s)")
                break
            prev = a
    if ident is not None:
        if rec.get("voice") is None:
            out.append(f"lines.{lid}.voice names the cast voice that voiced it")
    return out


def problems(man, play: dict, *, exists=None, read_sha=None, text_sha=None) -> list[str]:
    """Why the manifest cannot carry the plan, one line each ([] when it can). ``exists`` and ``read_sha`` take a
    path relative to the film folder (render.py passes file checks; a pure caller may pass None to skip them);
    ``text_sha`` hashes a line's text (narrator.sha256_text)."""
    if man is None:
        return [f"no voicing manifest at {PATH.as_posix()}: E7 voices every narration and reader line and writes it "
                f"(schema {SCHEMA}, studio/news/voicing_manifest.py)"]
    if not isinstance(man, dict):
        return [f"{PATH.as_posix()} is an object"]
    out = []
    if man.get("schema") != SCHEMA:
        out.append(f"{PATH.as_posix()} schema is {SCHEMA!r}, not {man.get('schema')!r}")
    voices = man.get("voices") if isinstance(man.get("voices"), dict) else None
    if voices is None:
        out.append(f"{PATH.as_posix()} voices is an object keyed by cast voice id")
        voices = {}
    lines = man.get("lines") if isinstance(man.get("lines"), dict) else None
    if lines is None:
        return out + [f"{PATH.as_posix()} lines is an object keyed by line id"]
    from studio.engine import narrator as NR      # identity() only: pure
    for ln in voiced_lines(play):
        lid = ln["id"]
        voice = line_voice(play, ln)
        if (voice or {}).get("engine") not in JUDGED:
            continue
        rec = lines.get(lid)
        if rec is None:
            out.append(f"{lid}: not in the voicing manifest")
            continue
        p = line_problems(lid, rec, voice)
        if p:
            out += p
            continue
        if rec["voice"] != voice.get("id"):
            out.append(f"{lid}: voiced by {rec['voice']!r}, the screenplay reads it with {voice.get('id')!r}")
            continue
        want = NR.identity(voice)
        have = voices.get(rec["voice"]) or {}
        if {k: have.get(k) for k in IDENTITY_KEYS} != want:
            out.append(f"{lid}: {rec['voice']} was voiced as {have}, the cast voice is {want}: re-voice it")
            continue
        if text_sha is not None and rec["text_sha256"] != text_sha(ln.get("text") or ""):
            out.append(f"{lid}: its text changed since it was voiced")
            continue
        if ln.get("wav") and Path(ln["wav"]).as_posix() != Path(rec["wav"]).as_posix():
            out.append(f"{lid}: the screenplay plays {ln['wav']}, the manifest voiced {rec['wav']}")
            continue
        if exists is not None and not exists(rec["wav"]):
            out.append(f"{lid}: {rec['wav']} is missing")
            continue
        if read_sha is not None and read_sha(rec["wav"]) != rec["sha256"]:
            out.append(f"{lid}: {rec['wav']} is not the take the manifest records")
    return out


def apply(play: dict, man) -> dict:
    """The screenplay with each voiced line's ``wav`` and measured ``words`` from the manifest, where the line states
    neither (the screenplay's own wins). Words become the engine's {w, t}: film time, the line's start plus the
    word's start in the take. A manifest that is not an object of lines changes nothing (problems() says why)."""
    lines = (man or {}).get("lines") if isinstance(man, dict) else None
    if not isinstance(lines, dict):
        return play
    out = dict(play, parts=[])
    for part in play.get("parts") or []:
        new = []
        for ln in part.get("lines") or []:
            rec = lines.get(ln.get("id"))
            if ln.get("kind") in VOICE_KINDS and isinstance(rec, dict) and not line_problems(ln["id"], rec, None):
                ln = dict(ln)
                ln.setdefault("wav", rec["wav"])
                if not ln.get("words"):
                    t0 = float(ln.get("start_s") or 0.0)
                    ln["words"] = [{"w": w["w"], "t": round(t0 + float(w["start_s"]), 4)} for w in rec["words"]]
            new.append(ln)
        out["parts"].append(dict(part, lines=new) if "lines" in part else part)
    return out
