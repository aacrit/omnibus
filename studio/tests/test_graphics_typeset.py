"""E6: the HTML builders (studio/graphics/typeset.py) - correct markup
for clean data, and escaping for untrusted data. Every value that lands
in a generated page (outlet names, headlines, speaker names, credits)
comes from a JSON record on disk; this file proves a hostile string in
any of those fields never breaks out of its attribute or text node."""

from __future__ import annotations

import re

import pytest

from studio.graphics import clean, data, fixtures, layout, typeset

CSS = {"tokens_css": "@@TOKENS_CSS@@", "frame_css": "@@FRAME_CSS@@", "graphics_css": "@@GRAPHICS_CSS@@"}
XSS = '"><img src=x onerror=alert(1)>'
LABELS = layout.load_lean_label_text()


def _assert_inert(html: str) -> None:
    assert "<img" not in html
    assert "onerror=alert(1)>" not in html.replace("&gt;", "")  # never an unescaped tag end
    assert "&lt;img src=x onerror=alert(1)&gt;" in html or "&quot;&gt;&lt;img" in html


def test_every_renderer_escapes_a_hostile_value():
    tc = data.TestCardSpec(subtype="week", word=XSS, week_line=XSS, bars=(1, 0, 0, 0, 0, 0, 0), placed=1, caption=XSS)
    echo = data.TestCardSpec(subtype="echo", word=XSS, week_line=XSS, year=XSS)
    board = data.BoardSpec(head_left=XSS, head_right=XSS,
                           rows=(data.BoardRow(rung="center", outlet=XSS, headline=XSS, headline_sha256="0" * 64),),
                           untitled={"far-left": [XSS]}, rung_labels=LABELS)
    lt = data.LowerThirdSpec(id="lt-x", place=XSS, date=XSS, speaker_name=XSS, role=XSS, dot_labels=(XSS,), echo=True)
    cc = data.CountCardSpec(id=XSS, eyebrow=XSS, week_label=XSS, rows=(data.CountRow(hero=XSS, context=XSS, qualifier=XSS),),
                            date_line=XSS)
    cc2 = data.CountCardSpec(id="cw", eyebrow="E", week_label="W", rows=(data.CountRow(hero=XSS, context=XSS),) * 2)
    db = data.DayBarSpec(day=XSS, slate=XSS, bars=(1, 0, 0, 0, 0, 0, 0), placed=1, unplaced=0, caption=XSS)
    clk = data.ClockSpec(hour=20, minute=59, second=54, date_line=XSS)
    cr = data.CreditsSpec(lines=(XSS,))
    eb = data.EndBoardSpec(issue=XSS, roman_year=XSS, licence=XSS, domain=XSS)  # type: ignore[arg-type]
    tm = data.TitleMacroSpec(lines=(XSS,), week_line=XSS, rate_cps=74.3)
    pages = [
        typeset.testcard_html(tc, **CSS), typeset.testcard_html(echo, **CSS),
        *typeset.board_pages_html(board, **CSS), *typeset.board_pages_html(board, rows_hidden=True, **CSS),
        typeset.lower_third_html(lt, **CSS), typeset.count_card_html(cc, **CSS), typeset.count_card_html(cc2, **CSS),
        typeset.day_bars_html(db, **CSS), typeset.clock_html(clk, **CSS), typeset.credits_html(cr, **CSS),
        typeset.end_board_html(eb, **CSS), typeset.title_macro_html(tm, **CSS),
    ]
    for html in pages:
        _assert_inert(html)


def test_stylesheet_paths_are_escaped_into_their_attribute():
    html = typeset.end_board_html(fixtures.END_BOARD, tokens_css=XSS, frame_css="f", graphics_css="g")
    assert "<img" not in html
    assert 'href="&quot;&gt;&lt;img' in html


def test_an_unknown_rung_is_refused_not_typeset_into_a_class():
    row = data.BoardRow(rung='center" onclick="x', outlet="A", headline="B", headline_sha256="0" * 64)
    spec = data.BoardSpec(head_left="A", head_right="B", rows=(row,), rung_labels=LABELS)
    with pytest.raises(ValueError):
        typeset.board_pages_html(spec, **CSS)


def test_testcard_week_html_has_bar_rects_and_caption():
    html = typeset.testcard_html(fixtures.TESTCARD_WEEK, **CSS)
    assert '<rect class="b-left"' in html
    assert 'data-count="caption"' in html and "238 PLACED" in html
    assert clean.find_forbidden_effects(html) == []


def test_testcard_echo_html_has_no_measured_bars():
    html = typeset.testcard_html(fixtures.TESTCARD_ECHO, **CSS)
    assert "field--echo" in html
    assert ">1918<" in html
    assert 'class="s6"' in html


# ---- board ---------------------------------------------------------------

def _week33_board():
    rows = tuple(data.BoardRow(rung=r, outlet=o, headline=f"Headline {o}", headline_sha256="0" * 64) for r, o in (
        ("left", "Mother Jones"), ("center-left", "Al Jazeera"), ("center", "The Hill"),
        ("center-right", "Chicago Tribune"), ("right", "Daily Sabah"), ("far-right", "Breitbart News")))
    return data.BoardSpec(head_left="THE WEIGHT", head_right="WEEK 33", rows=rows,
                          untitled={"far-left": ["Tehran Times"]}, rung_labels=LABELS)


def test_board_rung_labels_come_from_lean_label_text_with_the_hyphen():
    html = typeset.board_pages_html(fixtures.BOARD, **CSS)[0]
    labels = re.findall(r'<span class="bc-caps" style="left:[\d.]+px">([^<]*)</span>', html)
    assert labels == ["Far Left", "Left", "Center-Left", "Center", "Center-Right", "Right", "Far Right"]


def test_board_rows_carry_their_index_for_measured_boxes():
    html = typeset.board_pages_html(fixtures.BOARD, **CSS)[0]
    assert [int(i) for i in re.findall(r'class="brow" data-row="(\d+)"', html)] == [0, 1, 2, 3]


def test_board_paginates_six_rows_four_then_two_whole():
    pages = typeset.board_pages(_week33_board())
    assert [len(rows) for rows, _ in pages] == [4, 2]
    assert [r.rung for r in pages[1][0]] == ["right", "far-right"]


def test_board_untitled_far_left_rung_sits_under_its_rung_on_the_first_page():
    spec = _week33_board()
    p1, p2 = typeset.board_pages_html(spec, **CSS)
    x = layout.rung_center_x(0)
    assert f'class="outlet bc-caps r-far-left untitled" data-x="{x:g}" style="left:{x:g}px">Tehran Times<' in p1
    assert 'class="b-far-left"' in p1           # its rung mark on the ladder
    assert "Tehran Times" not in p2
    # no headline row for it
    assert p1.count('class="brow"') == 4


def test_board_base_page_hides_rows_but_keeps_page_furniture():
    html = typeset.board_pages_html(_week33_board(), rows_hidden=True, **CSS)[0]
    assert '<body class="rows-hidden">' in html
    assert "ladder-base" in html and "Tehran Times" in html and "THE WEIGHT" in html


def test_board_page_with_fewer_than_4_rows_stacks_from_the_top():
    p1, p2 = typeset.board_pages_html(_week33_board(), **CSS)
    assert 'class="rows"' in p1 and "rows-top" not in p1          # page 1: 4 rows, frame.css spacing stands
    assert 'class="rows rows-top"' in p2                          # page 2: 2 rows, generator override applies


# ---- lower third -----------------------------------------------------------

def _lt(**kw):
    base = dict(id="lt-echo-x3", place="THE WHITE HOUSE", date="14 JUN 1951", speaker_name="Harry S. Truman",
                role="President", dot_labels=("COMPUTER VOICE",), echo=True)
    base.update(kw)
    return data.LowerThirdSpec(**base)


def test_lower_third_tiers_and_separators_follow_spec_3_5():
    html = typeset.lower_third_html(_lt(), **CSS)
    t1 = re.search(r'<div class="lt-t1">(.*?)</div>', html).group(1)
    t2 = re.search(r'<div class="lt-t2">(.*?)</div>', html).group(1)
    assert t1 == ('<span class="lt-place bc-caps">THE WHITE HOUSE</span><span class="sep">·</span>'
                  '<span class="lt-name">Harry S. Truman</span>')
    # {ROLE} · date: role first, a separator, then the date in Mono.
    assert t2 == ('<span class="lt-role bc-caps">President</span><span class="sep">·</span>'
                  '<span class="lt-date bc-mono">14 JUN 1951</span>')


def test_lower_third_slate_without_speaker_has_no_dangling_separator():
    html = typeset.lower_third_html(_lt(speaker_name="", role=""), **CSS)
    t1 = re.search(r'<div class="lt-t1">(.*?)</div>', html).group(1)
    t2 = re.search(r'<div class="lt-t2">(.*?)</div>', html).group(1)
    assert 'class="sep"' not in t1 + t2
    assert t2 == '<span class="lt-date bc-mono">14 JUN 1951</span>'


def test_lower_third_is_a_transparent_overlay_without_the_slot_frame():
    html = typeset.lower_third_html(_lt(), **CSS)
    assert '<body class="overlay">' in html
    assert "slot-frame" not in html and 'class="slot"' not in html


def test_lower_third_echo_register_and_dot_labels():
    html = typeset.lower_third_html(_lt(dot_labels=("COMPUTER VOICE", "TRANSCRIBED PAGE")), **CSS)
    assert 'class="lt lt--echo"' in html
    assert ">COMPUTER VOICE · TRANSCRIBED PAGE<" in html
    assert "RECONSTRUCTED" not in html
    plain = typeset.lower_third_html(_lt(echo=False), **CSS)
    assert 'class="lt"' in plain and "lt--echo" not in plain


def test_lower_third_without_a_dot_label_is_refused():
    with pytest.raises(ValueError):
        typeset.lower_third_html(_lt(dot_labels=()), **CSS)


def test_lower_third_regression_variant_draws_the_mock_slot():
    html = typeset.lower_third_html(fixtures.LOWER_THIRD, over_slot=True, **CSS)
    assert 'class="slot"' in html and "overlay" not in html


# ---- count card ------------------------------------------------------------

def test_count_card_single_row_keeps_the_mock_offsets_and_date_line():
    html = typeset.count_card_html(fixtures.COUNT_CARD, **CSS)
    for top in ("300px", "350px", "600px", "760px"):
        assert f"top:{top}" in html
    assert ">AS OF 26 OCT 2026<" in html


def test_count_card_multiple_rows_and_echo_field():
    spec = data.CountCardSpec(id="cw-4", eyebrow="THE ECHO", week_label="WEEK 33",
                               rows=(data.CountRow(hero="19,800", context="Kefauver"),
                                     data.CountRow(hero="15,927", context="Truman")),
                               date_line="11 MAR 1952 · STATE CANVASS, PRINTED 1953", echo=True)
    html = typeset.count_card_html(spec, **CSS)
    assert 'class="field field--echo"' in html
    assert re.findall(r'class="hero-num bc-mono" data-row="(\d)"', html) == ["0", "1"]
    assert ">19,800<" in html and ">15,927<" in html


def test_count_card_multi_row_qualifier_shows_once_not_per_row():
    what = "New Hampshire Democratic preference for President, 11 March 1952"
    spec = data.CountCardSpec(id="cw-4", eyebrow="THE ECHO", week_label="WEEK 33",
                               rows=(data.CountRow(hero="19,800", context="Kefauver", qualifier=what),
                                     data.CountRow(hero="15,927", context="Truman", qualifier=what)),
                               date_line="11 MAR 1952 · STATE CANVASS, PRINTED 1953", echo=True)
    html = typeset.count_card_html(spec, **CSS)
    assert html.count(typeset.esc(what)) == 1
    assert ">19,800<" in html and ">15,927<" in html


# ---- clock -------------------------------------------------------------------

def test_clock_full_matches_the_mock_angles():
    html = typeset.clock_html(fixtures.CLOCK, **CSS)
    assert "rotate(269.95)" in html and "rotate(359.4)" in html and "rotate(324)" in html


def test_clock_dial_layer_carries_base_but_no_hands():
    html = typeset.clock_html(fixtures.CLOCK, parts=frozenset({"base"}), at_zero=True, **CSS)
    assert 'class="dial"' in html and "void omnibus" in html and "MON 02 NOV 2026" in html
    assert 'class="hand' not in html and 'class="sec"' not in html


def test_clock_second_hand_layer_is_transparent_at_rotate_zero():
    html = typeset.clock_html(fixtures.CLOCK, parts=frozenset({"second"}), at_zero=True, **CSS)
    assert '<body class="overlay">' in html
    assert 'class="sec" transform="rotate(0)"' in html
    assert 'class="dial"' not in html and "void omnibus" not in html and 'class="hand"' not in html


def test_clock_refuses_unknown_parts():
    with pytest.raises(ValueError):
        typeset.clock_html(fixtures.CLOCK, parts=frozenset({"pendulum"}), **CSS)


# ---- credits, end board, title ------------------------------------------

def test_credits_strip_is_top_down_caps_lines():
    spec = data.CreditsSpec(lines=("U.S. Army, via Wikimedia Commons", "Narrated by a computer voice"))
    html = typeset.credits_html(spec, **CSS)
    assert '<html lang="en" data-theme="dark" class="tall">' in html
    assert re.findall(r'<p class="credit-line">([^<]*)</p>', html) == list(spec.lines)
    assert "justify-content:flex-end" not in html


def test_end_board_prints_the_full_licence_with_its_numeral_in_mono():
    html = typeset.end_board_html(fixtures.END_BOARD, **CSS)
    assert ('<span class="bc-caps">CC BY-SA</span> <span class="bc-mono">4.0</span>'
            in html)
    assert '<span class="bc-mono">32</span>' in html
    assert '<span class="roman">MMXXVI</span>' in html


def test_title_macro_rows_are_verbatim_on_full_frame_paper():
    line = "WED 04 NOV   53 SRC  JD VANCE BLAMES IRAN WAR FOR REPUBLICAN MIDTERM DEFEAT AND A LONGER TAIL HERE"
    tm = data.TitleMacroSpec(lines=(line,), week_line="WEEK 33  CLOSED SUN 08 NOV 22:16 UTC", rate_cps=74.3)
    rows = typeset.title_rows(tm)
    assert all(len(r) <= 69 for r in rows)
    assert " ".join(rows[:-1]) == line and rows[-1] == tm.week_line
    html = typeset.title_macro_html(tm, **CSS)
    assert '<body class="macro">' in html
    assert re.findall(r'<div class="macro-row" data-row="\d+"><span>([^<]*)</span></div>', html) == rows
