"""E6: data extraction (studio/graphics/data.py) against the real week-33
record, rundown and echo pick already committed in this repo - no
browser, just JSON already on disk."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from studio.graphics import data

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def week():
    return json.loads((ROOT / "data" / "week-33.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rundown():
    return json.loads((ROOT / "episodes" / "33" / "rundown.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def echo_pick():
    return json.loads((ROOT / "episodes" / "33" / "echo-pick.json").read_text(encoding="utf-8"))


def test_testcard_the_week(rundown):
    tc = data.testcard_spec(rundown, "week", issue=33)
    assert tc.word == "THE WEEK"
    assert tc.bars == (3, 8, 59, 64, 20, 36, 9)
    assert tc.placed == 199
    assert sum(tc.bars) == 199


def test_testcard_echo_has_no_bars(rundown):
    tc = data.testcard_spec(rundown, "echo", issue=33)
    assert tc.bars is None
    assert tc.year == "1952"


def test_all_testcards_four_subtypes(rundown):
    cards = data.all_testcards(rundown, issue=33)
    assert [c.subtype for c in cards] == ["week", "weight", "echo", "margins"]


def test_day_bars_seven_days(rundown):
    days = data.day_bars(rundown)
    assert len(days) == 7
    assert days[0].bars == (0, 0, 2, 6, 3, 5, 0)
    assert days[0].placed == 16


def test_board_spec_rows_and_untitled(rundown, week):
    board = data.board_spec(rundown, week, issue=33)
    assert board.head_right == "WEEK 33"
    assert len(board.rows) >= 1
    rungs = [r.rung for r in board.rows]
    assert "far-left" not in rungs   # the untitled rung has no row
    assert board.untitled.get("far-left") == ["Tehran Times"]


def test_claim_term_card_matches_the_tickets_own_example(week):
    cc = data.claim_term_card(week, issue=33, date_line="AS OF 8 NOV 2026")
    assert cc.id == "cw-1"
    by_context = {row.context.split(",")[0]: row.hero for row in cc.rows}
    assert by_context["Iran"] == "39"
    assert by_context["Israel"] == "4"
    assert by_context["inflation"] == "1"
    assert all("46" in row.context for row in cc.rows)


def test_weight_known_count_cards(rundown):
    cards = data.weight_known_count_cards(rundown, issue=33, date_line="x")
    assert len(cards) == 2
    assert cards[0].id == "cw-2"
    assert cards[0].rows[0].hero == "76"
    assert cards[1].id == "cw-3"
    assert cards[1].rows[0].hero == "46"


def test_echo_comparison_card(rundown):
    card = data.echo_comparison_card(rundown, issue=33, date_line="x")
    assert card is not None
    heroes = {row.context: row.hero for row in card.rows}
    assert heroes["Kefauver"] == "19,800"
    assert heroes["Truman"] == "15,927"


def test_all_count_cards_includes_cw1_through_cw4(rundown, week):
    cards = data.all_count_cards(rundown, week, issue=33, date_line="x")
    ids = [c.id for c in cards]
    assert ids == ["cw-1", "cw-2", "cw-3", "cw-4"]


def test_lower_thirds_join_rundown_and_echo_pick(rundown, echo_pick):
    thirds = data.lower_thirds(rundown, echo_pick)
    assert len(thirds) >= 1
    names = [lt.speaker_name for lt in thirds]
    assert any("Truman" in n for n in names)
    for lt in thirds:
        assert lt.place and lt.date


def test_end_board_spec(week):
    eb = data.end_board_spec(week)
    assert eb.issue == 33
    assert eb.roman_year == "MMXXVI"


def test_title_macro_spec(rundown):
    tm = data.title_macro_spec(rundown)
    assert len(tm.lines) == 7
    assert tm.rate_cps == pytest.approx(74.3)
    assert "VANCE" in tm.lines[2]
