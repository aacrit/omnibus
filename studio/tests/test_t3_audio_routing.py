"""Show bible v2 j (ticket 3): sot/nat bus routing, the bible's own-sound levels, the room-tone floor and dead-air
promoted to block. Pure-function and small-array tests only: no plan, no build_plan, no render. The laptop has a CPU
fault (docs/decisions/), so the render-path integration (build_mix routing a real archive_video shot to sot or nat,
a full --stems render) is left to CI's sharded studio-full, which already exercises build_mix and write_stem_files
through test_stems.py and the news render fixtures."""
from __future__ import annotations

import numpy as np
import pytest

from studio.engine import journal as J
from studio.engine import render as R
from studio.news import lints as NL


# --------------------------------------------------------------------------
# shot_audio_role: the v2 role (sot/nat/muted), v1 sound.mode compat, the default
# --------------------------------------------------------------------------


@pytest.mark.parametrize("sound,want", [
    (None, "nat"),
    ({}, "nat"),
    ({"mode": "own"}, "nat"),
    ({"mode": "mute"}, "muted"),
    ({"role": "sot"}, "sot"),
    ({"role": "nat"}, "nat"),
    ({"role": "muted"}, "muted"),
    ({"role": "sot", "mode": "mute"}, "sot"),       # the v2 role always wins over a stray v1 mode
])
def test_shot_audio_role(sound, want):
    assert R.shot_audio_role(sound) == want


def test_shot_audio_role_falls_back_to_v1_on_an_unrecognised_role():
    assert R.shot_audio_role({"role": "bogus"}) == "nat"
    assert R.shot_audio_role({"role": "bogus", "mode": "mute"}) == "muted"


# --------------------------------------------------------------------------
# _own_sound_under_vo: a clip's own span judged against the narrator's spans (bible j: nat under VO)
# --------------------------------------------------------------------------


def test_own_sound_under_vo():
    assert R._own_sound_under_vo(10.0, 12.0, [(9.0, 13.0)])             # entirely covered
    assert R._own_sound_under_vo(10.0, 12.0, [(10.5, 11.5)])            # exactly at the share floor (1.0 of 2.0 s)
    assert not R._own_sound_under_vo(10.0, 12.0, [(11.9, 12.0)])        # a sliver
    assert not R._own_sound_under_vo(10.0, 12.0, [])


# --------------------------------------------------------------------------
# _translation_envelope: full for TRANSLATION_FULL_S, ramped, then the duck gain (bible j: foreign-language SOT)
# --------------------------------------------------------------------------


def test_translation_envelope_full_then_duck():
    sr = R.AUDIO_RATE
    n = int(3.0 * sr)
    env = R._translation_envelope(n, 0.0, -6.0)
    g_full, g_duck = 10 ** (0.0 / 20), 10 ** (-6.0 / 20)
    assert env[0] == pytest.approx(g_full, rel=1e-5)
    assert env[int(1.0 * sr)] == pytest.approx(g_full, rel=1e-5)        # still full at 1.0 s (inside TRANSLATION_FULL_S)
    assert env[int(2.5 * sr)] == pytest.approx(g_duck, rel=1e-5)        # past the ramp, at the duck level
    ramp = env[int(R.TRANSLATION_FULL_S * sr): int((R.TRANSLATION_FULL_S + R.TRANSLATION_DUCK_RAMP_S) * sr)]
    assert np.all(np.diff(ramp) <= 1e-9)                                # never overshoots on the way down


def test_translation_envelope_shorter_than_full_s_never_ducks():
    n = int(0.5 * R.AUDIO_RATE)
    env = R._translation_envelope(n, 0.0, -6.0)
    assert np.allclose(env, 10 ** (0.0 / 20))


def test_translation_duck_lufs_table():
    assert R.TRANSLATION_DUCK_LUFS == {"official": -24.0, "ours": -18.0}
    assert R.SOT_LUFS == R.DIALOGUE_LUFS                                 # bible j: SOT at the narrator's own level


# --------------------------------------------------------------------------
# The stems manifest: sot is new, clips becomes nat (the file; the dict key stays "clips")
# --------------------------------------------------------------------------


def test_stem_buses_declares_sot_and_nat_files():
    files = dict(R.STEM_BUSES)
    assert files["sot.wav"] == "sot"
    assert files["nat.wav"] == "clips"
    assert "clips.wav" not in files


# --------------------------------------------------------------------------
# dead_air_lints: bible v2 j, omnibus only; block over DEAD_AIR_MAX_S; a declared silence is at most 6 s
# --------------------------------------------------------------------------


def _plan(*, news=True, silences=None):
    return {"show": ({"news": news} if news is not None else None), "silences": silences or []}


def test_dead_air_skips_a_non_news_show():
    j = J.Journal(film="t3-dead-air-doc")
    mix = np.zeros(R.AUDIO_RATE * 5, np.float32)
    assert R.dead_air_lints(j, _plan(news=False), mix) == []
    assert R.dead_air_lints(j, {}, mix) == []


def test_dead_air_blocks_an_undeclared_gap_over_the_floor():
    j = J.Journal(film="t3-dead-air-block")
    mix = np.zeros(R.AUDIO_RATE * 5, np.float32)
    assert R.dead_air_lints(j, _plan(), mix) == ["dead-air"]


def test_dead_air_allows_a_gap_under_the_floor():
    j = J.Journal(film="t3-dead-air-short")
    n = R.AUDIO_RATE * 5
    mix = np.zeros(n, np.float32)
    mix[: int(1.0 * R.AUDIO_RATE)] = 0.2            # sound for the first second, then under 2.0 s of true silence
    mix[int(1.0 * R.AUDIO_RATE): int(2.5 * R.AUDIO_RATE)] = 0.0
    mix[int(2.5 * R.AUDIO_RATE):] = 0.2
    assert R.dead_air_lints(j, _plan(), mix) == []


def test_dead_air_passes_a_declared_silence_at_or_under_six_seconds():
    j = J.Journal(film="t3-dead-air-declared")
    mix = np.zeros(R.AUDIO_RATE * 5, np.float32)
    assert R.dead_air_lints(j, _plan(silences=[(0.0, 5.0)]), mix) == []


def test_dead_air_blocks_a_declared_silence_over_six_seconds():
    j = J.Journal(film="t3-dead-air-overlong")
    mix = np.zeros(R.AUDIO_RATE * 7, np.float32)
    assert R.dead_air_lints(j, _plan(silences=[(0.0, 6.5)]), mix) == ["dead-air"]


def test_dead_air_is_a_warning_under_draft():
    j = J.Journal(film="t3-dead-air-draft")
    mix = np.zeros(R.AUDIO_RATE * 5, np.float32)
    assert R.dead_air_lints(j, _plan(), mix, draft=True) == []


# --------------------------------------------------------------------------
# room_tone_lints: bible v2 j, omnibus only; the amb bus at or under -72 dBFS, with no gap
# --------------------------------------------------------------------------


def _room_tone(n_s: float, dbfs: float) -> np.ndarray:
    n = int(n_s * R.AUDIO_RATE)
    return (10 ** (dbfs / 20)) * np.sin(2 * np.pi * 100 * np.arange(n) / R.AUDIO_RATE).astype(np.float32)


def test_room_tone_skips_a_non_news_show_or_a_missing_amb_bus():
    j = J.Journal(film="t3-room-tone-doc")
    assert R.room_tone_lints(j, _plan(news=False), _room_tone(1.0, -40.0)) == []
    assert R.room_tone_lints(j, _plan(), None) == []


def test_room_tone_passes_a_quiet_continuous_floor():
    j = J.Journal(film="t3-room-tone-ok")
    assert R.room_tone_lints(j, _plan(), _room_tone(3.0, -80.0)) == []


def test_room_tone_blocks_above_the_floor():
    j = J.Journal(film="t3-room-tone-loud")
    assert R.room_tone_lints(j, _plan(), _room_tone(3.0, -40.0)) == ["room-tone-floor"]


def test_room_tone_blocks_a_gap_in_the_recording_itself():
    j = J.Journal(film="t3-room-tone-gap")
    amb = _room_tone(5.0, -80.0)
    amb[R.AUDIO_RATE: R.AUDIO_RATE * 4] = 0.0        # a 3 s true-silence gap inside the room-tone bus
    assert R.room_tone_lints(j, _plan(), amb) == ["room-tone-floor"]


def test_room_tone_is_a_warning_under_draft():
    j = J.Journal(film="t3-room-tone-draft")
    assert R.room_tone_lints(j, _plan(), _room_tone(3.0, -40.0), draft=True) == []


# --------------------------------------------------------------------------
# echo_bed_ending_checks (studio/news/lints.py): wired into checks() now that ticket 1 (PR #36) has merged the
# signoff segment. Tested directly here (not through NL.checks(), which needs a full episode's rundown/record
# inputs); the real schema decides v1 vs v2 (SC.spine) from the play's own "issue" field, no monkeypatch needed.
# --------------------------------------------------------------------------


def _echo_play(bed_end: float, signoff_start: float, *, bed_start: float = 0.0, theme=None, no_bed=False, issue=35):
    echo_shots = [] if no_bed else [{"id": "E1", "kind": "card", "start_s": bed_start, "dur_s": max(bed_end - bed_start, 0.1)}]
    parts = [{"id": "echo1", "segment": "echo", "shots": echo_shots or [{"id": "E0", "kind": "card", "start_s": 0.0, "dur_s": 0.1}]},
             {"id": "signoff1", "segment": "signoff", "shots": [{"id": "S1", "kind": "card", "start_s": signoff_start, "dur_s": 5.0}]}]
    music = [] if no_bed else [{"id": "echo-bed", "kind": "music", "start_s": bed_start, "end_s": bed_end}]
    if theme:
        music.append({"id": "theme", "kind": "music", "role": "main_title", "start_s": theme[0], "end_s": theme[1]})
    return {"issue": issue, "parts": parts, "music": music}


def test_echo_bed_ending_is_inert_on_the_frozen_v1_spine():
    # issue 33 (SC.V1_ISSUES) reads as v1, which has no signoff segment at all: inert, never blocking
    res = NL.echo_bed_ending_checks(_echo_play(10.0, 12.0, issue=33))
    assert all(c["ok"] for c in res)


def test_echo_bed_ending_passes_a_clean_closer():
    res = NL.echo_bed_ending_checks(_echo_play(bed_end=10.0, signoff_start=12.5))
    assert all(c["ok"] for c in res), res


def test_echo_bed_ending_blocks_too_little_room_before_signoff():
    res = NL.echo_bed_ending_checks(_echo_play(bed_end=10.0, signoff_start=11.0))
    assert any(not c["ok"] for c in res)


def test_echo_bed_ending_blocks_an_overlap_with_the_theme():
    res = NL.echo_bed_ending_checks(_echo_play(bed_end=10.0, signoff_start=13.0, theme=(9.0, 15.0)))
    assert any(not c["ok"] for c in res)


def test_echo_bed_ending_fails_with_no_bed_cue():
    res = NL.echo_bed_ending_checks(_echo_play(bed_end=10.0, signoff_start=13.0, no_bed=True))
    assert any(not c["ok"] for c in res)


def test_echo_bed_ending_passes_trivially_with_no_echo_part():
    res = NL.echo_bed_ending_checks({"issue": 35, "parts": [], "music": []})
    assert all(c["ok"] for c in res)
