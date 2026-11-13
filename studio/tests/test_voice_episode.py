# Net-new in omnibus (E7, issue 33).
"""studio/news/voice_episode.py: the whole episode (narration and every reader, each its own cast voice) voiced
through the lifted narrator engine, A57 and quote-verbatim re-checked before anything reaches the model, a
pronunciation respelling never changing a line's word count or its hash, and the omnibus voicing manifest written
in the schema render.py (E9i) reads."""

from __future__ import annotations

import hashlib
import json
import wave

import pytest

from studio.engine import narrator as NR
from studio.engine import vision as VIS
from studio.news import voice_episode as VE
from studio.news import voicing_manifest as NVO

AOEDE = {"id": "v-narrator", "engine": "kokoro", "voice": "af_aoede", "speed": 0.88}
READER = {"id": "v-reader-x", "engine": "kokoro", "voice": "am_michael", "speed": 0.86, "for": "sp-x"}


def h(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def play_with(narration_text="Tuesday, the third.", reader_text="Prices rose.", reader_hash=None):
    return {"cast": {"speakers": [{"id": "sp-x", "name": "X"}], "voices": [AOEDE, READER]},
            "parts": [{"lines": [
                {"id": "N1", "kind": "narration", "read_by": "v-narrator", "text": narration_text, "dur_s": 2.0},
                {"id": "R1", "kind": "testimony", "read_by": "v-reader-x", "speaker": "sp-x", "source": "src-1",
                 "text": reader_text, "quote_sha256": reader_hash if reader_hash is not None else h(reader_text),
                 "dur_s": 1.5}]}]}


# --------------------------------------------------------------------------
# The pronunciation guide
# --------------------------------------------------------------------------


def test_pronunciation_entries_must_be_one_token(tmp_path):
    p = tmp_path / "pron.json"
    p.write_text(json.dumps({"words": {"Mamdani": "mahm dah nee"}}), encoding="utf-8")
    with pytest.raises(ValueError, match="one token"):
        VE.load_pronunciation(p)


def test_pronunciation_substitutes_whole_words_case_insensitively_and_keeps_word_count():
    guide = VE.load_pronunciation()                       # the real studio/pronunciation.json
    assert guide["mamdani"] == "Mahm-dah-nee" and guide["hegseth"] == "Heg-seth"
    text = "Hegseth and HEGSETH met Massie."
    out = VE.apply_pronunciation(text, guide)
    assert out == "Heg-seth and Heg-seth met Mass-ee."
    assert len(out.split()) == len(text.split())


def test_a_word_the_guide_does_not_name_is_untouched():
    assert VE.apply_pronunciation("Tuesday, the third.", {"mamdani": "Mahm-dah-nee"}) == "Tuesday, the third."
    assert VE.apply_pronunciation("x", {}) == "x"


# --------------------------------------------------------------------------
# What must be true before a line reaches the model
# --------------------------------------------------------------------------


def test_quote_problems_catches_a_stale_or_missing_quote_hash():
    assert VE.quote_problems([{"id": "R1", "kind": "testimony", "text": "a", "quote_sha256": h("a")}]) == []
    (p,) = VE.quote_problems([{"id": "R1", "kind": "testimony", "text": "a", "quote_sha256": h("edited")}])
    assert "R1" in p and "edited after the fact" in p
    (p,) = VE.quote_problems([{"id": "R1", "kind": "testimony", "text": "a"}])
    assert "carries quote_sha256" in p
    assert VE.quote_problems([{"id": "N1", "kind": "narration", "text": "a"}]) == []       # narration is exempt


def test_group_lines_skips_a_voice_that_is_not_kokoro():
    play = {"cast": {"voices": [AOEDE, dict(READER, engine="orpheus")]},
            "parts": [{"lines": [{"id": "N1", "kind": "narration", "read_by": "v-narrator", "text": "x"},
                                 {"id": "R1", "kind": "testimony", "read_by": "v-reader-x", "text": "y"}]}]}
    lines = NVO.voiced_lines(play)
    groups = VE.group_lines(play, lines)
    assert set(groups) == {"v-narrator"} and [ln["id"] for ln in groups["v-narrator"]] == ["N1"]


# --------------------------------------------------------------------------
# The listen-free checks
# --------------------------------------------------------------------------


def test_plan_diff_flags_over_15_percent_either_way():
    assert VE.plan_diff(2.3, 2.0) == {"plan_dur_s": 2.0, "diff_pct": 15.0, "over_15pct": False}
    assert VE.plan_diff(2.31, 2.0)["over_15pct"] is True
    assert VE.plan_diff(1.0, None) == {"plan_dur_s": None, "diff_pct": None, "over_15pct": False}


def test_word_outliers_flags_a_word_far_from_the_lines_own_median():
    words = [{"w": "one", "start_s": 0.0, "end_s": 0.3}, {"w": "two", "start_s": 0.3, "end_s": 0.6},
             {"w": "three", "start_s": 0.6, "end_s": 0.9}, {"w": "stuck", "start_s": 0.9, "end_s": 2.9}]
    assert VE.word_outliers(words) == ["stuck"]
    assert VE.word_outliers(words[:2]) == []                          # too few words to have a median


def test_wav_seconds_reads_a_real_wav(tmp_path):
    f = tmp_path / "x.wav"
    with wave.open(str(f), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 24000)
    assert VE.wav_seconds(f) == 1.0


# --------------------------------------------------------------------------
# The whole episode, with a stub worker (no Kokoro installed in the studio test env)
# --------------------------------------------------------------------------

RUNTIME = {"kokoro-onnx": "0.6.1", "onnxruntime": "1.31.1", "espeak-ng": "1.52.0"}


def probe(python=None):
    return dict(RUNTIME)


def _folder_and_lock(tmp_path):
    lock = NR.load_lock()
    folder = tmp_path / "models"
    folder.mkdir()
    for f in lock["files"]:
        (folder / f["name"]).write_bytes(f["name"].encode())
    return folder, dict(lock, files=[dict(f, size=len(f["name"]), sha256=NR.sha256_path(folder / f["name"]))
                                     for f in lock["files"]])


def _stub_runner(seconds_per_job=1.0):
    def runner(jobs, files, out, **kw):
        n = 24000 * int(seconds_per_job)
        timings = {}
        for j in jobs:
            with wave.open(str(out / f"{j['id']}.wav"), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(b"\x00\x00" * n)
            words = j["text"].split()
            t, spans = 0.0, []
            for k, wd in enumerate(words):
                if k:
                    spans.append((" ", t, t))
                step = seconds_per_job / max(len(words), 1)
                spans.append((wd[0], t, t + step))
                t += step
            timings[j["id"]] = [list(s) for s in spans]
        return {"ok": [j["id"] for j in jobs], "failed": {}, "timing": {"audio_s": seconds_per_job * len(jobs)},
               "timings": timings}
    return runner


def test_voice_episode_writes_every_voiced_line_and_the_manifest(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_HEAVY_LOCK", str(tmp_path / "HEAVY.lock"))
    film = tmp_path / "film"
    film.mkdir()
    (film / "screenplay.json").write_text(json.dumps(play_with()), encoding="utf-8")
    folder, lock = _folder_and_lock(tmp_path)
    media = tmp_path / "media"
    res = VE.voice_episode(film, media_root=media, cache=tmp_path / "cache", folder=folder, lock=lock,
                           runner=_stub_runner(2.0), prober=probe)
    man = json.loads((film / "audio" / "voice.json").read_text(encoding="utf-8"))
    assert man == res["manifest"] and man["schema"] == "omnibus-voicing/1"
    assert set(man["voices"]) == {"v-narrator", "v-reader-x"}
    assert man["identity"] == NR.identity(AOEDE)
    assert man["media"] == media.as_posix()                                # the ledgers' own "media" convention
    n1, r1 = man["lines"]["N1"], man["lines"]["R1"]
    assert n1["voice"] == "v-narrator" and r1["voice"] == "v-reader-x"
    assert n1["wav"] == "audio/N1.wav" and (film / n1["wav"]).exists() and (media / "N1.wav").exists()
    assert n1["text_sha256"] == h("Tuesday, the third.") and n1["sha256"] == NR.sha256_path(film / n1["wav"])
    assert [w["w"] for w in n1["words"]] == "Tuesday, the third.".split()
    assert NVO.problems(man, play_with(), exists=lambda rel: (film / rel).exists(),
                        read_sha=lambda rel: NR.sha256_path(film / rel), text_sha=NR.sha256_text) == []
    assert res["lines"]["N1"]["plan_dur_s"] == 2.0 and res["total_voiced_s"] == pytest.approx(4.0, abs=0.01)
    assert not (tmp_path / "HEAVY.lock").exists()                           # released once the loop is done
    assert "words_estimated" in man and res["words_estimated_count"] == len(man["words_estimated"])


def test_voice_episode_refuses_when_another_job_holds_the_lock(tmp_path, monkeypatch):
    lock_path = tmp_path / "HEAVY.lock"
    monkeypatch.setenv("DOCUMENT_HEAVY_LOCK", str(lock_path))
    lock_path.write_text(json.dumps({"group": "other", "job": "a render", "pid": -1}), encoding="utf-8")
    film = tmp_path / "film"
    film.mkdir()
    (film / "screenplay.json").write_text(json.dumps(play_with()), encoding="utf-8")

    def never(*a, **k):
        raise AssertionError("the model ran while another job held HEAVY.lock")

    with pytest.raises(VIS.MissingModel, match="HEAVY.lock is held"):
        VE.voice_episode(film, media_root=tmp_path / "media", cache=tmp_path / "cache", runner=never, prober=probe)
    assert lock_path.read_text(encoding="utf-8") == json.dumps({"group": "other", "job": "a render", "pid": -1})


def test_voice_episode_refuses_a_stale_quote_before_the_model_runs(tmp_path):
    film = tmp_path / "film"
    film.mkdir()
    (film / "screenplay.json").write_text(json.dumps(play_with(reader_hash="0" * 64)), encoding="utf-8")

    def never(*a, **k):
        raise AssertionError("the model ran on a line whose quote did not verify")

    with pytest.raises(NR.NarratorError, match="edited after the fact"):
        VE.voice_episode(film, media_root=tmp_path / "media", cache=tmp_path / "cache", runner=never, prober=probe)


def test_voice_episode_pronunciation_changes_the_sound_not_the_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_HEAVY_LOCK", str(tmp_path / "HEAVY.lock"))
    film = tmp_path / "film"
    film.mkdir()
    play = play_with(narration_text="Massie spoke.")
    (film / "screenplay.json").write_text(json.dumps(play), encoding="utf-8")
    folder, lock = _folder_and_lock(tmp_path)
    seen = []

    def runner(jobs, files, out, **kw):
        seen.extend(j["text"] for j in jobs)
        return _stub_runner(1.0)(jobs, files, out, **kw)

    res = VE.voice_episode(film, media_root=tmp_path / "media", cache=tmp_path / "cache", folder=folder, lock=lock,
                           runner=runner, prober=probe, pronunciation={"massie": "Mass-ee"})
    assert any("Mass-ee spoke." == t for t in seen)                       # the model heard the respelling
    assert res["manifest"]["lines"]["N1"]["text_sha256"] == h("Massie spoke.")   # the record keeps the written word
    assert [w["w"] for w in res["manifest"]["lines"]["N1"]["words"]] == ["Massie", "spoke."]
