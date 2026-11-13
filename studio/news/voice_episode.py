# Net-new in omnibus (E7, issue 33).
"""Voices a news episode's whole screenplay with the lifted narrator engine (studio/engine/narrator.py): every
narration line and every reader (testimony) line, across every cast voice the screenplay names (the narrator, a
slower variant such as the Echo's, and each reader), and writes the voicing manifest
``studio/news/voicing_manifest.py`` describes (schema ``omnibus-voicing/1``) at ``<film>/audio/voice.json``.

The stock engine's own CLI (``python -m studio.engine.narrator voice <film>``) voices only the narration, as one
voice, and writes A57's older manifest (``{"v": 1, ...}``); a news episode needs every reader voiced too, each as
its own cast voice, in the newer schema render.py (E9i) reads. This module is the "or its current equivalent" the
ticket allows: it calls the same engine (``narrator.identity``, ``narrator.narrator_problems``,
``narrator.voice_lines``, the same take cache and the same model lock) once per cast voice, then assembles the
result into the one manifest the show needs.

Three checks run before anything reaches the model:
- ``quote_problems``: a reader line's text must still hash to its own ``quote_sha256`` (studio/news/lints.py's
  quote-verbatim, re-checked here defensively): a line is never voiced as something other than the extract it
  cites, even if the screenplay was hand-edited after the lint last ran.
- A57 (``narrator.narrator_problems``), on every cast voice actually used, narrator and readers alike: an engine
  named, a pinned Kokoro voice, natural pitch, a speed in range.
- the pronunciation guide (``studio/pronunciation.json``, optional): a one-token respelling for a name, substituted
  into the text sent to the model only. It never touches the text a line is hashed against (``text_sha256``,
  ``quote_sha256``): the written word is what a caption shows and what the printed record carries.

Word timings: ``studio/engine/kokoro_worker.py`` reports each take's phoneme timeline when the pinned model
exposes phoneme durations; ``narrator.words_timed`` groups it into one span per written word (a respelling is
one token, so the count still matches) and says whether it had to fall back instead to a proportional split of
the line's measured length (a number read as several spoken words, or a model that reports no durations at
all): the manifest's top-level ``words_estimated`` lists every line id where that happened, so a line whose word
timings are a guess, not a measurement, is never mistaken for one.

This is the one heavy job the house allows at a time (CLAUDE.md rule 13): ``voice_episode`` takes
``studio/engine/vision.py``'s ``HeavyLock`` around the whole voicing loop (every cast voice, not per voice), and
refuses immediately, before anything is sent to the model, when another job already holds it.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import wave
from pathlib import Path

from studio.engine import narrator as NR
from studio.engine import vision as VIS
from studio.news import voicing_manifest as NVO

PRONUNCIATION_PATH = Path(__file__).resolve().parents[1] / "pronunciation.json"
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")


# --------------------------------------------------------------------------
# The pronunciation guide
# --------------------------------------------------------------------------

def load_pronunciation(path: Path | None = None) -> dict[str, str]:
    """{lowercased word: respelling} from ``studio/pronunciation.json``, or {} when the file is absent. A
    respelling must be one token (letters, apostrophes and hyphens only, no whitespace): ``apply_pronunciation``
    then never changes a line's word count."""
    p = Path(path) if path is not None else PRONUNCIATION_PATH
    if not p.exists():
        return {}
    raw = json.loads(p.read_text(encoding="utf-8"))
    out = {}
    for k, v in (raw.get("words") or {}).items():
        v = str(v).strip()
        if not v or re.search(r"\s", v):
            raise ValueError(f"pronunciation entry {k!r} -> {v!r} has whitespace: a respelling is one token "
                             "(hyphenate the syllables instead)")
        out[str(k).strip().lower()] = v
    return out


def apply_pronunciation(text: str, guide: dict[str, str]) -> str:
    """``text`` with every whole word the guide names replaced by its respelling (case-insensitive match; a word
    the guide does not name is untouched). Never changes the word count."""
    if not guide:
        return text
    return WORD.sub(lambda m: guide.get(m.group(0).lower(), m.group(0)), text)


# --------------------------------------------------------------------------
# What must be true before a line reaches the model
# --------------------------------------------------------------------------

def quote_problems(lines: list[dict]) -> list[str]:
    """Why a reader (testimony) line cannot be voiced, one per line ([] when every one can): its text must still
    hash to its own ``quote_sha256``, so a line already in the screenplay is never voiced as something other than
    the extract it cites."""
    out = []
    for ln in lines:
        if ln.get("kind") != "testimony":
            continue
        want, text = ln.get("quote_sha256"), ln.get("text") or ""
        if not want:
            out.append(f"{ln.get('id')}: a reader line carries quote_sha256 (the extract it cites)")
            continue
        got = NR.sha256_text(text)
        if got != want:
            out.append(f"{ln.get('id')}: its text does not hash to quote_sha256 (text sha256 {got[:12]}, "
                       f"quote_sha256 {want[:12]}): not voicing an extract that was edited after the fact")
    return out


def group_lines(play: dict, lines: list[dict]) -> dict[str, list[dict]]:
    """``lines`` grouped by the id of the cast voice that reads each (``voicing_manifest.line_voice``); a line
    whose voice is missing, or is not a Kokoro voice (an Orpheus voice's takes are made outside this engine, a
    test tone is not judged), is left out of every group."""
    out: dict[str, list[dict]] = {}
    for ln in lines:
        voice = NVO.line_voice(play, ln)
        if voice and voice.get("engine") == "kokoro":
            out.setdefault(voice["id"], []).append(ln)
    return out


# --------------------------------------------------------------------------
# A take's measured length, and the listen-free checks
# --------------------------------------------------------------------------

def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def plan_diff(dur_s: float, plan_dur_s: float | None) -> dict:
    """How far a take's measured length sits from the screenplay's planned ``dur_s`` ({diff_pct: None} when the
    line names no plan). The draft render absorbs the difference (it retimes to the take); this is only a flag
    for a line whose take ran far from what was planned (over 15%, ticket E7)."""
    if not plan_dur_s:
        return {"plan_dur_s": None, "diff_pct": None, "over_15pct": False}
    diff = (dur_s - plan_dur_s) / plan_dur_s
    return {"plan_dur_s": round(plan_dur_s, 3), "diff_pct": round(diff * 100, 1), "over_15pct": abs(diff) > 0.15}


def word_outliers(words: list[dict], *, ratio: float = 2.5) -> list[str]:
    """The written words (from ``words``, ``{w, start_s, end_s}``) whose seconds-per-character sits more than
    ``ratio`` times away from the line's own median: a listen-free stand-in for an ear, catching a word the model
    stumbled or paused badly on without anyone playing the take back. A line too short to have a median (fewer
    than 3 words) is never flagged."""
    if len(words) < 3:
        return []
    rates = []
    for w in words:
        n = max(len(w["w"]), 1)
        rates.append((w["w"], max(float(w["end_s"]) - float(w["start_s"]), 0.0) / n))
    rates.sort(key=lambda r: r[1])
    median = rates[len(rates) // 2][1]
    if median <= 0:
        return []
    return [w for w, r in rates if r > median * ratio or r < median / ratio]


# --------------------------------------------------------------------------
# Voicing the whole episode
# --------------------------------------------------------------------------

def voice_episode(film: Path, *, out: Path | None = None, cache: Path | None = None, threads: int = NR.THREADS,
                  max_rss_mb: float = NR.MAX_RSS_MB, python: str | None = None, folder: Path | None = None,
                  pronunciation: dict[str, str] | None = None, runner=NR.run_worker, prober=NR.probe_runtime,
                  lock: dict | None = None, media_root: Path | None = None) -> dict:
    """Voice every narration and reader line of ``film``'s screenplay.json, across every cast voice it names,
    under the house ``HeavyLock`` (refuses at once, before anything reaches the model, when another job holds
    it). Each take's WAV is written under ``media_root`` (default ``out``, default ``<film>/audio``) and copied
    to ``<film>/audio/<line id>.wav`` so the manifest's own path (relative to the film folder, as
    ``voicing_manifest`` requires) resolves the same way render.py's does. Writes the manifest to
    ``<film>/audio/voice.json`` (``voicing_manifest.PATH``, schema ``omnibus-voicing/1``), plus two fields
    outside what ``voicing_manifest`` validates (extra top-level keys, never a line's own): ``media``, where
    ``media_root`` actually put the WAVs (as a ledger's own ``media`` field records its asset root, screenplay.json
    ``ledgers.*.media``), and ``words_estimated``, the line ids whose word timings are a proportional guess
    (``narrator.words_timed``'s fallback), not a measurement.

    Raises ``NR.NarratorError`` if any reader line's quote is stale, or any cast voice used fails A57
    (``narrator.narrator_problems``); ``VIS.MissingModel`` if the lock is held; neither ever reaches the model.
    Returns {"manifest", "report"}: the written manifest document, and a per-line report (measured length
    against the screenplay's planned ``dur_s``, and a listen-free word-outlier flag) plus the lines flagged over
    15% from plan."""
    film = Path(film)
    play = json.loads((film / "screenplay.json").read_text(encoding="utf-8"))
    lines = NVO.voiced_lines(play)
    qp = quote_problems(lines)
    if qp:
        raise NR.NarratorError("; ".join(qp))
    groups = group_lines(play, lines)
    if not groups:
        raise NR.NarratorError("no narration or reader line is read by a Kokoro cast voice: nothing to voice")
    guide = load_pronunciation() if pronunciation is None else pronunciation
    media_root = Path(media_root) if media_root else (Path(out) if out else film / "audio")
    dest_dir = film / "audio"
    cache = Path(cache) if cache else NR.cache_dir(film)
    orig_text = {ln["id"]: ln.get("text") or "" for ln in lines}
    voices_doc: dict[str, dict] = {}
    lines_doc: dict[str, dict] = {}
    per_line_report: dict[str, dict] = {}
    voices_timing: dict[str, dict] = {}
    words_estimated: list[str] = []
    with VIS.HeavyLock(f"E7 voice episode {film.name} ({len(lines)} lines, {len(groups)} cast voices)"):
        for vid, group in groups.items():
            voice = NVO.line_voice(play, group[0])
            problems = NR.narrator_problems(voice, lock)
            if problems:
                raise NR.NarratorError(f"{vid}: " + "; ".join(problems))
            synth_lines = [{"id": ln["id"], "text": apply_pronunciation(orig_text[ln["id"]], guide)} for ln in group]
            res = NR.voice_lines(synth_lines, voice, cache=cache, film=film, threads=threads, max_rss_mb=max_rss_mb,
                                 python=python, folder=folder, runner=runner, prober=prober, lock=lock)
            voices_doc[vid] = NR.identity(voice)
            voices_timing[vid] = res["timing"]
            for ln in group:
                lid = ln["id"]
                info = res["lines"][lid]
                media_root.mkdir(parents=True, exist_ok=True)
                media_wav = media_root / f"{lid}.wav"
                if Path(info["wav"]) != media_wav:
                    shutil.copyfile(info["wav"], media_wav)
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest_wav = dest_dir / f"{lid}.wav"
                if media_wav != dest_wav:
                    shutil.copyfile(media_wav, dest_wav)
                dur_s = wav_seconds(dest_wav)
                synth_text = apply_pronunciation(orig_text[lid], guide)
                timeline = [tuple(e) for e in (info.get("timeline") or [])]
                words, estimated = NR.words_timed(synth_text, timeline, total_s=dur_s)
                words = [dict(w, w=orig) for w, orig in zip(words, orig_text[lid].split())]  # the written word
                if estimated:
                    words_estimated.append(lid)
                lines_doc[lid] = {"voice": vid, "wav": dest_wav.relative_to(film).as_posix(),
                                  "sha256": NR.sha256_path(dest_wav), "text_sha256": NR.sha256_text(orig_text[lid]),
                                  "dur_s": round(dur_s, 3), "words": words}
                per_line_report[lid] = dict(plan_diff(dur_s, ln.get("dur_s")), dur_s=round(dur_s, 3),
                                            word_outliers=word_outliers(words))
    narrator_voice_id = next((ln.get("read_by") or "v-narrator" for ln in lines if ln.get("kind") == "narration"
                              and (ln.get("read_by") or "v-narrator") in voices_doc), None)
    manifest = {"schema": NVO.SCHEMA, "identity": voices_doc.get(narrator_voice_id) or next(iter(voices_doc.values())),
               "voices": voices_doc, "lines": lines_doc, "media": media_root.as_posix(),
               "words_estimated": sorted(words_estimated)}
    (film / NVO.PATH).parent.mkdir(parents=True, exist_ok=True)
    (film / NVO.PATH).write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    flagged = [lid for lid, r in per_line_report.items() if r["over_15pct"]]
    short = [lid for lid in flagged if (per_line_report[lid]["diff_pct"] or 0) < 0]
    total_s = sum(r["dur_s"] for r in per_line_report.values())
    plan_s = sum(r["plan_dur_s"] for r in per_line_report.values() if r["plan_dur_s"] is not None)
    return {"manifest": manifest, "manifest_path": str(film / NVO.PATH), "lines": per_line_report,
           "flagged_over_15pct": flagged, "flagged_short": short, "flagged_long": [l for l in flagged if l not in short],
           "total_voiced_s": round(total_s, 2), "total_plan_s": round(plan_s, 2),
           "words_estimated_count": len(words_estimated), "voices_timing": voices_timing}


# --------------------------------------------------------------------------
# The command line
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.news.voice_episode", description=__doc__.split("\n\n")[0])
    ap.add_argument("film")
    ap.add_argument("--media-root")
    ap.add_argument("--cache")
    ap.add_argument("--threads", type=int, default=NR.THREADS)
    ap.add_argument("--max-rss-mb", type=float, default=NR.MAX_RSS_MB)
    a = ap.parse_args(argv)
    try:
        res = voice_episode(Path(a.film), media_root=Path(a.media_root) if a.media_root else None,
                            cache=Path(a.cache) if a.cache else None, threads=a.threads, max_rss_mb=a.max_rss_mb)
    except (NR.NarratorError, VIS.MissingModel) as e:
        print(f"voice_episode: {e}", file=sys.stderr)
        return 2
    print(json.dumps({k: res[k] for k in ("total_voiced_s", "total_plan_s", "flagged_short", "flagged_long",
                                          "words_estimated_count", "manifest_path")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
