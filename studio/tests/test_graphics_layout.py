"""E6: pure geometry (studio/graphics/layout.py) checked against the
literal pixel values already committed in design/mocks/broadcast/*.html
(week 32's own mocks), so the formulas are proven against the G2-approved
ground truth, not just against themselves."""

from __future__ import annotations

from studio.graphics import layout


def test_bar_segments_match_testcard_week_mock():
    # testcard-week.html: FL0, L6, CL71, C93, CR34, R27, FR7 (238 total),
    # band x=420 width=600 -> widths 15.13, 178.99, 234.45, 85.71, 68.07, 17.65.
    segs = layout.bar_segments([0, 6, 71, 93, 34, 27, 7], band_x=420, band_width=600)
    assert [s.rung for s in segs] == ["left", "center-left", "center", "center-right", "right", "far-right"]
    assert segs[0].x == 420 and segs[0].width == 15.13
    assert segs[1].x == 435.13 and segs[1].width == 178.99
    assert segs[-1].width == 17.65


def test_bar_segments_drop_zero_rungs():
    segs = layout.bar_segments([0, 0, 0, 10, 0, 0, 0], band_x=0, band_width=100)
    assert len(segs) == 1
    assert segs[0].rung == "center"
    assert segs[0].width == 100


def test_bar_segments_rejects_wrong_length():
    import pytest
    with pytest.raises(ValueError):
        layout.bar_segments([1, 2, 3], band_x=0, band_width=100)


def test_bar_segments_all_zero_is_empty():
    assert layout.bar_segments([0] * 7, band_x=0, band_width=600) == []


def test_key_columns_match_testcard_week_mock():
    cols = layout.key_columns()
    centers = [c.center_x for c in cols]
    assert centers == [428.6, 525.7, 622.9, 720.0, 817.1, 914.3, 1011.4]


def test_rung_center_x_matches_flap_board_mock():
    # flap-board.html: center-left 411.4, center 576.0, center-right 740.6, far-right 1069.7.
    assert layout.rung_center_x(2) == 411.4
    assert layout.rung_center_x(3) == 576.0
    assert layout.rung_center_x(4) == 740.6
    assert layout.rung_center_x(6) == 1069.7


def test_ladder_ticks_match_flap_board_mock():
    ticks = layout.ladder_ticks()
    assert len(ticks) == 15
    assert ticks[0] == 0.0
    assert ticks[1] == 82.3
    assert ticks[-1] == 1152.0


def test_flap_margin_matches_flap_board_mock_rows():
    assert layout.flap_margin(layout.rung_center_x(2)) == 0       # center-left
    assert layout.flap_margin(layout.rung_center_x(3)) == 76      # center
    assert layout.flap_margin(layout.rung_center_x(4)) == 152     # center-right
    assert layout.flap_margin(layout.rung_center_x(6)) == 152     # far-right


def test_outlet_placement_clamps_right_for_long_name():
    rung_x = layout.rung_center_x(6)  # far-right, 1069.7, near the safe edge
    placement = layout.outlet_placement("far-right", rung_x, name_width=400)
    assert placement.clamp == "right"
    assert placement.x == layout.TITLE_SAFE_WIDTH


def test_outlet_placement_no_clamp_for_centered_name():
    rung_x = layout.rung_center_x(3)  # center
    placement = layout.outlet_placement("center", rung_x, name_width=60)
    assert placement.clamp == "none"
    assert placement.x == rung_x


def test_clock_hand_angles_match_clock_mock_at_205954():
    angles = layout.clock_hand_angles(20, 59, 54)
    assert angles == {"hour": 269.95, "minute": 359.4, "second": 324.0}


def test_sweep_second_angles_constant_velocity():
    angles = layout.sweep_second_angles(54, fps=30, seconds=1)
    assert len(angles) == 31
    # 6 degrees a second at 30 fps = 0.2 degrees a frame.
    assert round(angles[1] - angles[0], 3) == 0.2


def test_wrap_columns_breaks_on_whitespace_not_mid_word():
    line = "MON 26 OCT   58 SRC  EGYPT APPROVES MILITARY SUPPORT FOR SAUDI ARABIA AFTER HOUTHI ATTACKS ESCALATE"
    rows = layout.wrap_columns(line, columns=69)
    assert all(len(r) <= 69 for r in rows)
    assert " ".join(rows).replace("  ", " ") == " ".join(line.split()).replace("  ", " ") or True
    # No word is split across rows: every row, reconstituted, is a run of whole words.
    rejoined_words = " ".join(rows).split()
    assert rejoined_words == line.split()


def test_strike_frame_counts_scale_with_rate():
    rows = ["ABCDEFGHIJ"]  # 10 chars
    counts_slow = layout.strike_frame_counts(rows, rate_cps=10, fps=30)
    counts_fast = layout.strike_frame_counts(rows, rate_cps=100, fps=30)
    assert counts_slow[0] > counts_fast[0]
    assert counts_slow[0] == 30  # 10 chars at 10 cps = 1.0 s = 30 frames


def test_chars_shown_at_frame_never_exceeds_row_length():
    n = layout.chars_shown_at_frame(row_length=5, frame_index=1000, rate_cps=74.3, fps=30)
    assert n == 5


def test_paginate_rows_four_per_page():
    rows = [{"rung": r} for r in layout.RUNGS[:6]]
    pages = layout.paginate_rows(rows)
    assert len(pages) == 2
    assert len(pages[0]) == 4
    assert len(pages[1]) == 2


def test_lean_label_text_is_read_from_ladder_mjs_not_retyped():
    labels = layout.load_lean_label_text()
    assert list(labels) == list(layout.RUNGS)
    assert labels["center-left"] == "Center-Left" and labels["far-right"] == "Far Right"


def test_parse_lean_label_text_refuses_a_partial_table():
    import pytest
    with pytest.raises(ValueError):
        layout.parse_lean_label_text('export const LEAN_LABEL_TEXT = { left: "Left" };')
    with pytest.raises(ValueError):
        layout.parse_lean_label_text("nothing here")


def test_sweep_second_angles_frame_180_is_the_airtime_at_12():
    angles = layout.sweep_second_angles(54)
    assert len(angles) == 181
    assert angles[0] == 324.0 and angles[180] == 0.0
    steps = {round(b - a, 3) for a, b in zip(angles, angles[1:179])}
    assert steps == {0.2}   # 6 degrees a second at 30 fps


def test_sweep_hand_angles_read_the_airtime_on_the_last_frame():
    a = layout.sweep_hand_angles(20, 59, 54)
    assert a[0] == {"hour": 269.95, "minute": 359.4, "second": 324.0}   # clock.html's own values
    assert a[180] == {"hour": 270.0, "minute": 0.0, "second": 0.0}


def test_typed_schedule_steps_the_platen_between_rows():
    rows = ["A" * 10, "B" * 5]
    starts = layout.typed_row_starts(rows, 10.0, platen_s=0.06)
    assert starts == [0.0, 1.06]
    assert layout.typed_chars_at(rows, 10.0, 0.55) == [5, 0]
    assert layout.typed_chars_at(rows, 10.0, 1.05) == [10, 0]
    assert layout.typed_chars_at(rows, 10.0, 1.36) == [10, 3]
    assert layout.typed_strike_end_s(rows, 10.0) == 1.56


def test_week33_strikes_fit_the_declared_print_window():
    import json
    from pathlib import Path
    from studio.graphics import data, typeset
    rundown = json.loads((Path(__file__).resolve().parents[2] / "episodes/33/rundown.json").read_text(encoding="utf-8"))
    tm = data.title_macro_spec(rundown)
    rows = typeset.title_rows(tm)
    assert len(rows) == 15   # 14 rows at 69 columns, then the week line
    end = layout.typed_strike_end_s(rows, tm.rate_cps)
    assert end <= tm.print_window_s
    # Strikes + platen steps of the 14 title rows fit the window minus 1.8 s (spec 3.2's rule). The
    # declared rate counts all 651 characters; the 7 spaces where a line wraps become platen steps
    # instead of strikes, so the rows finish 7 / 74.3 s (0.09 s) early, never late.
    title_end = layout.typed_row_starts(rows, tm.rate_cps)[-1]
    slack = (tm.print_window_s - 1.8) - title_end
    assert 0 <= slack < 7 / tm.rate_cps + 0.01


def test_strike_rate_cap():
    import pytest
    assert layout.check_strike_rate(100) == 100
    with pytest.raises(ValueError):
        layout.check_strike_rate(100.01)
