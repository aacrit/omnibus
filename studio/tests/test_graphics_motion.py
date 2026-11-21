"""E6: motion timing math (studio/graphics/motion.py) at 30 fps, per the
bible's presets - flap (180 ms fall, rows 400 ms apart), wipe (240 ms hard
edge), step (one frame, never counts up), sweep (constant angular
velocity), credits roll (3 px/frame, integer), the title's typed-paper
macro (characters at the strike rate). No browser, no ffmpeg."""

from __future__ import annotations

import pytest

from studio.graphics import motion


def test_ms_to_frames_at_30fps():
    assert motion.ms_to_frames(180) == 5   # 180ms * 30/1000 = 5.4 -> round 5
    assert motion.ms_to_frames(240) == 7   # 7.2 -> round 7
    assert motion.ms_to_frames(400) == 12


def test_flap_row_timing_rows_start_400ms_apart():
    t0 = motion.flap_row_timing(0)
    t1 = motion.flap_row_timing(1)
    t2 = motion.flap_row_timing(2)
    assert t0.start_frame == 0
    assert t1.start_frame == 12   # 400ms at 30fps
    assert t2.start_frame == 24
    assert t0.fall_frames == motion.ms_to_frames(180)


def test_flap_progress_before_during_after():
    t = motion.flap_row_timing(0)
    assert motion.flap_progress(0, t) == 0.0
    assert 0.0 < motion.flap_progress(t.start_frame + 1, t) < 1.0
    assert motion.flap_progress(t.end_frame, t) == 1.0
    assert motion.flap_progress(t.end_frame + 100, t) == 1.0


def test_flap_total_frames_covers_last_row():
    total = motion.flap_total_frames(4)
    last = motion.flap_row_timing(3)
    assert total == last.end_frame + 3   # landing, one 3% rebound frame, seated


def test_flap_total_frames_zero_rows():
    assert motion.flap_total_frames(0) == 0


def test_wipe_reveal_fraction_linear_hard_edge():
    n = motion.wipe_frame_count(240)
    assert motion.wipe_reveal_fraction(0, duration_ms=240) == pytest.approx(1 / n)
    assert motion.wipe_reveal_fraction(n - 1, duration_ms=240) == 1.0
    assert motion.wipe_reveal_fraction(n, duration_ms=240) == 1.0  # clamped, never exceeds


def test_step_frame_index_is_always_zero():
    assert motion.step_frame_index(1) == 0
    assert motion.step_frame_index(90) == 0


def test_step_frame_index_rejects_non_positive_hold():
    with pytest.raises(ValueError):
        motion.step_frame_index(0)


def test_sweep_angle_constant_velocity():
    assert motion.sweep_angle(0) == 0
    assert motion.sweep_angle(1) == 6.0
    assert motion.sweep_angle(10) == 60.0


def test_sweep_angle_wraps_at_360():
    assert motion.sweep_angle(60) == 0.0  # 60s * 6deg/s = 360 -> wraps to 0


def test_credits_crop_offsets_are_integer_3px_steps():
    offsets = motion.credits_crop_offsets(strip_height=1200, viewport_height=1080)
    assert offsets[0] == 0
    assert offsets[1] == 3
    assert offsets[-1] == 120  # 1200 - 1080


def test_credits_crop_offsets_short_strip_is_single_frame():
    assert motion.credits_crop_offsets(strip_height=900, viewport_height=1080) == [0]


def test_typed_paper_frame_count_scales_with_text_length():
    short = motion.typed_paper_frame_count(["AB"], rate_cps=74.3)
    long = motion.typed_paper_frame_count(["AB" * 20], rate_cps=74.3)
    assert long > short


def test_typed_paper_frame_count_week33_fourteen_rows_positive():
    # week 33's declared rate (rundown.json title.strike.rate_cps = 74.3)
    # and its 14 wrapped rows (from 7 verbatim lines + the week line) -
    # here checked only for a positive, finite frame count, the row-
    # wrapping itself is layout.wrap_columns's job (test_graphics_layout).
    rows = ["X" * 69] * 14
    n = motion.typed_paper_frame_count(rows, rate_cps=74.3)
    assert n > 0


def test_flap_scale_falls_with_gravity_then_rebounds_once():
    t = motion.flap_row_timing(0)
    scales = [motion.flap_scale(f, t) for f in range(t.end_frame + 4)]
    assert scales[0] == 0.0
    fall = scales[1:t.end_frame]
    steps = [b - a for a, b in zip(fall, fall[1:])]
    assert all(b > a for a, b in zip(steps, steps[1:]))   # accelerating into the stop
    assert scales[t.end_frame] == 1.0
    assert scales[t.end_frame + 1] == motion.FLAP_REBOUND == 0.97
    assert scales[t.end_frame + 2:] == [1.0, 1.0]
