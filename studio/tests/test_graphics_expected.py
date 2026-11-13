"""E6: what counts-match expects on screen (studio/graphics/expected.py),
read from data/week-33.json and echo-pick, never from the rundown's or
the typesetter's copies."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from studio.graphics import expected

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def week():
    return json.loads((ROOT / "data" / "week-33.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def echo_pick():
    return json.loads((ROOT / "episodes" / "33" / "echo-pick.json").read_text(encoding="utf-8"))


def test_resolve_walks_dotted_paths_with_indices(week):
    assert expected.resolve(week, "days[0].lead.source_count") == 24
    assert expected.resolve(week, "lead.claim.terms[1].term") == "Israel"
    with pytest.raises((KeyError, IndexError)):
        expected.resolve(week, "days[9].lead")


def test_testcard_bars_from_the_record(week):
    assert expected.testcard_bars(week, "week") == [3, 8, 59, 64, 20, 36, 9]
    assert expected.testcard_bars(week, "weight") == [1, 3, 13, 23, 10, 12, 3]
    assert expected.testcard_bars(week, "margins") == [1, 5, 9, 6, 3, 1, 6]
    assert expected.testcard_caption_counts(week, "weight") == {"placed": 65, "unplaced": 11}


def test_day_bar_placed_and_title_src_counts(week):
    assert [expected.day_bar_placed(week, f"days[{i}].lead.buckets") for i in range(7)] == [16, 18, 43, 10, 33, 60, 19]
    assert expected.title_source_counts(week) == [24, 30, 53, 15, 34, 68, 31]


def test_board_rows_from_lead_board(week):
    rows = expected.board_rows(week)
    assert len(rows) == 6
    assert rows[0] == ("left", "Mother Jones") and rows[-1] == ("far-right", "Breitbart News")


def test_count_card_numbers(week, echo_pick):
    assert expected.count_card_numbers(week, echo_pick, "cw-1") == ["39", "46", "4", "46", "1", "46"]
    assert expected.count_card_numbers(week, echo_pick, "cw-2") == ["76"]
    assert expected.count_card_numbers(week, echo_pick, "cw-3") == ["46", "89"]
    assert expected.count_card_numbers(week, echo_pick, "cw-4") == ["19800", "15927"]


def test_numerals_in_strips_separators():
    assert expected.numerals_in("OUTLETS CARRYING THE CLAIM · 65 PLACED · 11 UNPLACED") == ["65", "11"]
    assert expected.numerals_in("19,800") == ["19800"]
    assert expected.numerals_in("Kefauver") == []
