"""E6: the test card's static SVG skeleton and the clock dial's ticks,
checked against the literal markup in design/mocks/broadcast/*.html."""

from __future__ import annotations

from studio.graphics import svgparts


def test_castellation_rects_match_testcard_week_mock_corners():
    rects = svgparts.castellation_rects("tc-cast-a", "tc-cast-b")
    assert '<rect class="tc-cast-a" x="0" y="0" width="60" height="30"/>' in rects
    assert '<rect class="tc-cast-b" x="0" y="1050" width="60" height="30"/>' in rects
    assert '<rect class="tc-cast-b" x="60" y="0" width="60" height="30"/>' in rects
    assert '<rect class="tc-cast-a" x="0" y="0" width="30" height="60"/>' in rects
    assert '<rect class="tc-cast-b" x="1410" y="0" width="30" height="60"/>' in rects
    assert '<rect class="tc-cast-b" x="0" y="60" width="30" height="60"/>' in rects


def test_castellation_rect_count():
    rects = svgparts.castellation_rects("a", "b")
    # 24 top + 24 bottom + 18 left + 18 right.
    assert rects.count("<rect") == 24 + 24 + 18 + 18


def test_grid_path_matches_testcard_week_mock():
    path = svgparts.grid_path()
    assert path.startswith("M60 30V1050")
    assert "M120 30V1050" in path
    assert "M1380 30V1050" in path
    assert "M30 60H1410" in path
    assert "M30 1020H1410" in path
    assert "M1440" not in path  # the castellated border, not the grid, owns the outer edge


def test_frame_rect_and_disc_match_mock():
    assert svgparts.frame_rect() == '<rect class="tc-frame" x="30" y="30" width="1380" height="1020"/>'
    assert svgparts.centre_disc() == '<circle class="tc-disc" cx="720" cy="540" r="390"/>'


def test_staircase_rects_six_steps_192px():
    rects = svgparts.staircase_rects()
    assert rects.count("<rect") == 6
    assert '<rect class="s1" x="144" y="960" width="192" height="12"/>' in rects
    assert '<rect class="s6" x="1104" y="960" width="192" height="12"/>' in rects


def test_clock_ticks_match_mock_at_minute_zero_and_one():
    ticks = {t["minute"]: t for t in svgparts.clock_ticks()}
    # clock.html: minute 0, hour tick (really a quarter), x1=0 y1=-70 x2=0 y2=-92 width7.
    t0 = ticks[0]
    assert t0["category"] == "quarter"
    assert t0["width"] == 7.0
    assert t0["x1"] == 0.0 and t0["y1"] == -70.0
    assert t0["x2"] == 0.0 and t0["y2"] == -92.0
    # minute 1: x1=8.99 y1=-85.53 x2=9.62 y2=-91.50 width1.4.
    t1 = ticks[1]
    assert t1["category"] == "minute"
    assert t1["width"] == 1.4
    assert t1["x1"] == 8.99 and t1["y1"] == -85.53
    assert t1["x2"] == 9.62 and t1["y2"] == -91.5


def test_clock_ticks_sixty_total():
    assert len(svgparts.clock_ticks()) == 60


def test_clock_ticks_svg_is_well_formed_lines():
    svg = svgparts.clock_ticks_svg()
    assert svg.count("<line") == 60
