"""E6: the HTML builders (studio/graphics/typeset.py) - correct markup
for clean data, and escaping for untrusted data. Every value that lands
in a generated page (outlet names, headlines, speaker names) ultimately
comes from a JSON record on disk; this file proves a hostile string in
any of those fields never breaks out of its attribute or text node."""

from __future__ import annotations

from studio.graphics import clean, data, fixtures, typeset

CSS = {"tokens_css": "C:/fake/tokens.css", "frame_css": "C:/fake/frame.css"}
XSS = '"><img src=x onerror=alert(1)>'


def test_testcard_week_html_has_bar_rects_and_caption():
    html = typeset.testcard_html(fixtures.TESTCARD_WEEK, **CSS)
    assert '<rect class="b-left"' in html
    assert "OUTLETS CARRYING EACH DAY" in html  # caption text; the apostrophe after is entity-escaped
    assert "238 PLACED" in html
    assert clean.find_forbidden_effects(html) == []


def test_testcard_echo_html_has_no_measured_bars():
    html = typeset.testcard_html(fixtures.TESTCARD_ECHO, **CSS)
    assert "field--echo" in html
    assert ">1918<" in html
    assert 'class="s6"' in html  # decorative bars still present, just not from spec.bars


def test_testcard_html_escapes_hostile_caption():
    hostile = data.TestCardSpec(subtype="week", word="THE WEEK", week_line="x", bars=(1, 0, 0, 0, 0, 0, 0),
                                 placed=1, caption=XSS)
    html = typeset.testcard_html(hostile, **CSS)
    assert "<img src=x" not in html
    assert "&lt;img" in html or "&quot;" in html


def test_board_page_html_renders_rows_and_ladder_marks():
    pages = typeset.board_pages_html(fixtures.BOARD, **CSS)
    assert len(pages) == 1
    html = pages[0]
    assert "NPR" in html
    assert "Congo" in html or "AP News" in html
    assert clean.find_forbidden_effects(html) == []


def test_board_page_html_escapes_hostile_outlet_and_headline():
    hostile_row = data.BoardRow(rung="center", outlet=XSS, headline=XSS, headline_sha256="0" * 64)
    spec = data.BoardSpec(head_left="THE WEIGHT", head_right="WEEK 1", rows=(hostile_row,), untitled={})
    html = typeset.board_pages_html(spec, **CSS)[0]
    assert "<img src=x" not in html
    assert "&lt;img" in html


def test_board_untitled_rung_renders_outlet_name_only():
    html = typeset.board_pages_html(fixtures.BOARD, **CSS)[0]
    # fixtures.BOARD has no untitled rungs; use week 33-shaped data for this check.
    spec = data.BoardSpec(head_left="A", head_right="B", rows=(), untitled={"far-left": ["Tehran Times"]})
    html2 = typeset.board_pages_html(spec, **CSS)[0]
    assert "Tehran Times" in html2


def test_lower_third_html_escapes_hostile_speaker():
    spec = data.LowerThirdSpec(id="lt-x", place=XSS, date="1 Jan 2026", speaker_name=XSS, role=XSS)
    html = typeset.lower_third_html(spec, **CSS)
    assert "<img src=x" not in html
    assert "&lt;img" in html


def test_lower_third_html_has_both_tiers():
    html = typeset.lower_third_html(
        data.LowerThirdSpec(id="lt-1", place="The White House", date="14 Jun 1951",
                             speaker_name="Harry S. Truman", role="President"),
        **CSS,
    )
    assert "THE WHITE HOUSE" in html
    assert "Harry S. Truman" in html
    assert "PRESIDENT" in html or "President" in html


def test_count_card_html_multiple_rows_and_escaping():
    spec = data.CountCardSpec(id="cw-1", eyebrow="THE WEIGHT", week_label="WEEK 33",
                               rows=(data.CountRow(hero="39", context=XSS),
                                     data.CountRow(hero="4", context="Israel")))
    html = typeset.count_card_html(spec, **CSS)
    assert ">39<" in html
    assert ">4<" in html
    assert "<img src=x" not in html


def test_day_bars_html_renders_slate_and_caption():
    spec = data.DayBarSpec(day="Monday 2 Nov", slate="MON 02 NOV 2026", bars=(0, 0, 2, 6, 3, 5, 0),
                            placed=16, unplaced=8, caption="OUTLETS CARRYING THE DAY'S LEAD \u00b7 16 PLACED")
    html = typeset.day_bars_html(spec, **CSS)
    assert "MON 02 NOV 2026" in html
    assert "16 PLACED" in html
    assert clean.find_forbidden_effects(html) == []


def test_clock_html_hands_rotate_to_time():
    html = typeset.clock_html(fixtures.CLOCK, **CSS)
    assert "rotate(269.95)" in html
    assert "rotate(359.4)" in html
    assert "rotate(324.0)" in html


def test_clock_layer_html_dial_has_no_hands():
    html = typeset.clock_layer_html(fixtures.CLOCK, layer="dial", **CSS)
    assert "hand-sec" not in html


def test_clock_layer_html_hands_only_has_no_dial_circle():
    html = typeset.clock_layer_html(fixtures.CLOCK, layer="hands", **CSS)
    assert 'class="dial"' not in html
    assert "hand-sec" in html


def test_credits_html_includes_every_line_escaped():
    spec = data.CreditsSpec(lines=("Explorer 1 footage", XSS))
    html = typeset.credits_html(spec, **CSS)
    assert "Explorer 1 footage" in html
    assert "<img src=x" not in html


def test_end_board_html_has_week_and_licence():
    html = typeset.end_board_html(fixtures.END_BOARD, **CSS)
    assert ">32<" in html
    assert "MMXXVI" in html
    assert "omnibus.voidvision.org" in html


def test_title_macro_html_full_and_partial_reveal():
    tm = data.TitleMacroSpec(lines=("A SHORT LINE OF VERBATIM TEXT",), week_line="WEEK 1 CLOSED", rate_cps=74.3)
    full = typeset.title_macro_html(tm, **CSS)
    assert "A SHORT LINE OF VERBATIM TEXT" in full
    partial = typeset.title_macro_html(tm, reveal_rows=0, reveal_chars=5, **CSS)
    assert "A SHOR" not in partial  # cut at 5 chars, not 6
    assert "WEEK 1 CLOSED" not in partial  # a later row than the one being struck


def test_title_macro_html_escapes_hostile_line():
    tm = data.TitleMacroSpec(lines=(XSS,), week_line="x", rate_cps=74.3)
    html = typeset.title_macro_html(tm, **CSS)
    assert "<img src=x" not in html
