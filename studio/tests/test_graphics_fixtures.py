"""E6: the week-32 regression fixture's numbers are cross-checked against
`data/week-32.json` itself (the copy - board headlines, the count card's
context sentence - is transcribed from the committed G2 mocks; see
studio/graphics/fixtures.py's own docstring for why)."""

from __future__ import annotations

import json
from pathlib import Path

from studio.graphics import fixtures

ROOT = Path(__file__).resolve().parents[2]


def _week32():
    return json.loads((ROOT / "data" / "week-32.json").read_text(encoding="utf-8"))


def test_the_week_bars_equal_summed_day_buckets():
    week = _week32()
    summed = [sum(day["lead"]["buckets"][i] for day in week["days"]) for i in range(7)]
    assert list(fixtures.TESTCARD_WEEK.bars) == summed
    assert fixtures.TESTCARD_WEEK.placed == sum(summed)


def test_the_weight_bars_equal_lead_rung_counts():
    week = _week32()
    assert list(fixtures.TESTCARD_WEIGHT.bars) == week["lead"]["rung_counts"]


def test_board_rows_match_week32_lead_board():
    week = _week32()
    record_rows = {r["rung"]: r for r in week["lead"]["board"]}
    for row in fixtures.BOARD.rows:
        rec = record_rows[row.rung]
        assert row.outlet == rec["outlet"]
        assert row.headline == rec["headline"]
        assert row.headline_sha256 == rec["sha256"]


def test_the_margins_bars_equal_summed_story_buckets():
    week = _week32()
    summed = [sum(s["buckets"][i] for s in week["margins"]["stories"]) for i in range(7)]
    assert list(fixtures.TESTCARD_MARGINS.bars) == summed


def test_count_card_hero_matches_cover_numbers():
    week = _week32()
    stat = next(c for c in week["cover_numbers"] if c["context"] == "cases")
    assert fixtures.COUNT_CARD.rows[0].hero == stat["stat"]


def test_end_board_issue_matches_week_record():
    week = _week32()
    assert fixtures.END_BOARD.issue == week["issue"]
