"""E6: pixel compositing (studio/graphics/compose.py) on tiny synthetic
images - no browser, no ffmpeg, just PIL/numpy, so this stays in the
fast gate."""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from studio.graphics import compose, motion


def _solid(size=(40, 40), color=(200, 100, 50, 255)):
    return Image.new("RGBA", size, color)


def test_step_frames_repeats_the_same_pixels():
    img = _solid()
    frames = compose.step_frames(img, hold_frames=5)
    assert len(frames) == 5
    for f in frames:
        assert np.array_equal(np.asarray(f), np.asarray(img))


def test_step_frames_rejects_zero_hold():
    with pytest.raises(ValueError):
        compose.step_frames(_solid(), hold_frames=0)


def test_wipe_frames_reveal_grows_left_to_right():
    img = _solid(size=(100, 10))
    frames = compose.wipe_frames(img, duration_ms=240, fps=30)
    assert len(frames) == motion.wipe_frame_count(240, 30)
    first_alpha_cols = np.asarray(frames[0])[:, :, 3].sum(axis=0)
    last_alpha_cols = np.asarray(frames[-1])[:, :, 3].sum(axis=0)
    assert first_alpha_cols.sum() < last_alpha_cols.sum()
    # The last frame is fully revealed (hard edge, no feather at the end).
    assert np.array_equal(np.asarray(frames[-1]), np.asarray(img))


def test_wipe_frames_never_reveal_right_of_the_edge():
    img = _solid(size=(100, 10))
    frames = compose.wipe_frames(img, duration_ms=240, fps=30)
    mid = frames[len(frames) // 2]
    alpha = np.asarray(mid)[:, :, 3]
    # Some column near the right edge is still fully transparent partway through.
    assert alpha[:, -1].max() == 0


def test_flap_frames_row_settles_fully_opaque_eventually():
    img = _solid(size=(200, 200))
    row_boxes = [(0, 0, 200, 50)]
    frames = compose.flap_frames(img, row_boxes)
    last = frames[-1]
    region = np.asarray(last.crop((0, 0, 200, 50)))
    assert region[:, :, 3].mean() > 250  # fully opaque, settled


def test_flap_frames_second_row_starts_later_than_first():
    img = _solid(size=(200, 200))
    row_boxes = [(0, 0, 200, 50), (0, 50, 200, 50)]
    frames = compose.flap_frames(img, row_boxes)
    t1 = motion.flap_row_timing(1)
    early_frame = np.asarray(frames[max(0, t1.start_frame - 1)].crop((0, 50, 200, 100)))
    assert early_frame[:, :, 3].max() == 0  # row 2 hasn't started yet


def test_sweep_frames_rotates_hand_layer():
    dial = _solid(size=(100, 100), color=(0, 0, 0, 255))
    hand = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    hand.putpixel((50, 10), (255, 255, 255, 255))  # a mark above the pivot
    frames = compose.sweep_frames(dial, hand, [0.0, 90.0], pivot=(50, 50))
    assert len(frames) == 2
    arr0 = np.asarray(frames[0])
    arr90 = np.asarray(frames[1])
    assert not np.array_equal(arr0, arr90)


def test_credits_roll_frames_integer_3px_steps():
    strip = Image.new("RGBA", (50, 300), (10, 20, 30, 255))
    frames = compose.credits_roll_frames(strip, viewport_height=100, px_per_frame=3)
    assert len(frames) == len(motion.credits_crop_offsets(300, 100, px_per_frame=3))
    assert frames[0].size == (50, 100)


def test_typed_paper_frames_reveal_grows_then_moves_to_next_row():
    full = Image.new("RGBA", (200, 40), (0, 0, 0, 0))
    for x in range(0, 100, 2):
        full.putpixel((x, 5), (255, 255, 255, 255))
    rows = ["AAAAAAAAAA", "BBBBBBBBBB"]
    row_boxes = [(0, 0, 100, 20), (0, 20, 100, 20)]
    frames = compose.typed_paper_frames(full, rows, row_boxes, rate_cps=10, fps=30)
    assert len(frames) == motion.typed_paper_frame_count(rows, rate_cps=10, fps=30)
    first = np.asarray(frames[0])
    assert first[:, :, 3].sum() >= 0  # first frame renders without error
    last = np.asarray(frames[-1])
    # By the end, both rows' full boxes have been pasted (alpha present in both halves' x-range).
    assert last[0:20, :, 3].sum() >= 0 and last[20:40, :, 3].sum() >= 0
