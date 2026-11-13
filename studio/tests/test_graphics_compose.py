"""E6: pixel compositing (studio/graphics/compose.py) on tiny synthetic
images - no browser, no ffmpeg, just PIL/numpy, so this stays in the
fast gate."""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from studio.graphics import compose, layout, motion


def _solid(size=(40, 40), color=(200, 100, 50, 255)):
    return Image.new("RGBA", size, color)


def _alpha(img):
    return np.asarray(img)[..., 3]


def test_presets_are_generators_not_lists():
    # A thousand-frame roll must stream to the encoder, never sit in RAM.
    gen = compose.step_frames(_solid(), hold_frames=3)
    assert not isinstance(gen, list)
    assert len(list(gen)) == 3


def test_step_frames_repeats_the_same_pixels():
    img = _solid()
    frames = list(compose.step_frames(img, hold_frames=5))
    assert len(frames) == 5
    assert all(np.array_equal(np.asarray(f), np.asarray(img)) for f in frames)


def test_step_frames_rejects_zero_hold():
    with pytest.raises(ValueError):
        list(compose.step_frames(_solid(), hold_frames=0))


def test_wipe_travels_across_the_box_not_the_frame():
    # A 100 px frame whose lower third occupies x 60..90: the edge starts at
    # the box, never reveals right of it early, and the last frame shows it all.
    img = _solid((100, 10))
    frames = list(compose.wipe_frames(img, (60, 0, 30, 10), duration_ms=240))
    assert len(frames) == motion.wipe_frame_count(240) == 7
    first = _alpha(frames[0])
    assert first[:, 60:].max() == 255 and first[:, 60 + 30 // 7 + 1:].max() == 0
    assert _alpha(frames[-1])[:, :90].min() == 255
    widths = [int((_alpha(f)[0] > 0).sum()) for f in frames]
    assert widths == sorted(widths)


def _board_fixture():
    base = Image.new("RGBA", (60, 60), (10, 10, 10, 255))
    full = base.copy()
    full.paste(Image.new("RGBA", (40, 10), (250, 0, 0, 255)), (10, 5))    # row 0 card
    full.paste(Image.new("RGBA", (20, 5), (0, 250, 0, 255)), (10, 16))    # row 0 outlet
    full.paste(Image.new("RGBA", (40, 10), (0, 0, 250, 255)), (10, 30))   # row 1 card
    full.paste(Image.new("RGBA", (20, 5), (250, 250, 0, 255)), (10, 41))  # row 1 outlet
    rows = [((10, 5, 40, 10), (10, 16, 20, 5)), ((10, 30, 40, 10), (10, 41, 20, 5))]
    return base, full, rows


def test_flap_rows_land_over_the_static_page_and_hold():
    base, full, rows = _board_fixture()
    frames = list(compose.flap_frames(base, full, rows, hold_frames=90))
    total = motion.flap_total_frames(2)
    assert len(frames) == total + 90
    # Frame 0: nothing has fallen; the page (base) is there, not a blank.
    assert np.array_equal(np.asarray(frames[0]), np.asarray(base))
    # Settled: every row whole, identical to the typeset page.
    assert np.array_equal(np.asarray(frames[-1]), np.asarray(full))


def test_flap_card_hinges_from_its_top_edge():
    base, full, rows = _board_fixture()
    frames = list(compose.flap_frames(base, full, rows, hold_frames=1))
    t0 = motion.flap_row_timing(0)
    mid = np.asarray(frames[t0.start_frame + 3])
    assert tuple(mid[5, 20][:3]) == (250, 0, 0)          # top edge drawn
    assert tuple(mid[14, 20][:3]) == (10, 10, 10)        # bottom edge not yet
    # The outlet cuts in only when its card seats.
    assert tuple(mid[17, 15][:3]) == (10, 10, 10)


def test_flap_second_row_starts_400ms_after_the_first():
    base, full, rows = _board_fixture()
    frames = list(compose.flap_frames(base, full, rows, hold_frames=1))
    t1 = motion.flap_row_timing(1)
    assert t1.start_frame == 12
    assert tuple(np.asarray(frames[t1.start_frame])[30, 20][:3]) == (10, 10, 10)
    assert tuple(np.asarray(frames[t1.end_frame + 2])[35, 20][:3]) == (0, 0, 250)


def test_rotate_layer_turns_clockwise_about_the_pivot():
    hand = Image.new("RGBA", (41, 41), (0, 0, 0, 0))
    hand.paste(Image.new("RGBA", (1, 15), (255, 255, 255, 255)), (20, 5))   # points to 12
    turned = np.asarray(compose.rotate_layer(hand, 90, (20, 20)))
    assert turned[20, 30, 3] > 200    # now points to 3 o'clock
    assert turned[10, 20, 3] < 50
    assert compose.rotate_layer(hand, 360, (20, 20)) is hand


def test_second_hand_layer_is_at_12_on_the_airtime_frame():
    hand = Image.new("RGBA", (41, 41), (0, 0, 0, 0))
    hand.paste(Image.new("RGBA", (1, 15), (255, 255, 255, 255)), (20, 5))
    angles = layout.sweep_second_angles(54)
    frames = list(compose.second_hand_frames(hand, angles, (20, 20)))
    assert len(frames) == 181
    assert np.array_equal(np.asarray(frames[180]), np.asarray(hand))
    assert np.asarray(frames[0])[10, 20, 3] < 50   # 54 s: pointing toward 11, not 12


def test_dial_frames_turn_hour_and_minute_hands_over_the_base():
    base = Image.new("RGBA", (41, 41), (240, 230, 210, 255))
    stick = Image.new("RGBA", (41, 41), (0, 0, 0, 0))
    stick.paste(Image.new("RGBA", (2, 15), (0, 0, 0, 255)), (19, 5))   # centred on the pivot x
    angles = layout.sweep_hand_angles(20, 59, 54)
    frames = list(compose.clock_dial_frames(base, stick, stick, angles, (20, 20)))
    assert len(frames) == 181
    last = np.asarray(frames[-1])
    assert last[10, 20, 0] < 50 and last[20, 10, 0] < 50    # minute at 12, hour at 9 (21:00)


def test_credits_roll_frames_integer_3px_steps():
    strip = Image.new("RGBA", (4, 30), (0, 0, 0, 255))
    for y in range(30):
        strip.putpixel((0, y), (y, 0, 0, 255))
    frames = list(compose.credits_roll_frames(strip, 10))
    tops = [np.asarray(f)[0, 0, 0] for f in frames]
    assert tops[:3] == [0, 3, 6]
    assert tops[-1] == 20


def _paper(rows, adv_px=4, h=6):
    w = 4 + adv_px * max(len(r) for r in rows) + 4
    full = Image.new("RGBA", (w, h * len(rows)), (240, 235, 220, 255))
    boxes, advances = [], []
    for i, r in enumerate(rows):
        for k in range(len(r)):
            full.paste(Image.new("RGBA", (adv_px - 1, h - 2), (20, 20, 20, 255)), (4 + k * adv_px, i * h + 1))
        boxes.append((4, i * h, adv_px * len(r), h))
        advances.append([4 + (k + 1) * adv_px for k in range(len(r))])
    return full, boxes, advances


def test_typed_paper_reveals_by_measured_advance_at_the_rate():
    rows = ["ABCDEFGHIJ", "KLMNO"]
    full, boxes, advances = _paper(rows)
    frames = list(compose.typed_paper_frames(full, rows, boxes, advances, 30.0, total_s=1.0, platen_s=0.060))
    assert len(frames) == 30
    # 30 cps at 30 fps: one character a frame; frame 5 shows 5 of row 0.
    f5 = np.asarray(frames[5])
    assert f5[3, 4 + 4 * 4 + 1, 0] == 20 and f5[3, 4 + 5 * 4 + 1, 0] == 240
    # Every frame is paper all over (full-frame ground), never transparent.
    assert all(_alpha(f).min() == 255 for f in frames)
    # Row 1 waits for row 0's last strike plus the 60 ms platen step.
    start1 = layout.typed_row_starts(rows, 30.0)[1]
    assert start1 == pytest.approx(10 / 30 + 0.060)
    before = np.asarray(frames[int(start1 * 30)])
    assert before[6 + 3, 5, 0] == 240
    assert np.array_equal(np.asarray(frames[-1]), np.asarray(full))


def test_typed_paper_refuses_misaligned_advances_and_a_short_window():
    rows = ["ABC"]
    full, boxes, advances = _paper(rows)
    with pytest.raises(ValueError):
        list(compose.typed_paper_frames(full, rows, boxes, [advances[0][:2]], 30.0, total_s=1.0))
    with pytest.raises(ValueError):
        list(compose.typed_paper_frames(full, rows, boxes, advances, 3.0, total_s=0.5))
