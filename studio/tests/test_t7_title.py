# Net-new in omnibus (show bible v2, ticket 7).
"""``studio/news/title.py`` (the recompositor) and ``studio/news/lints.py``'s ``title-lines-from-rundown``.

The pure-function tests below are checked, line for line, against issue 35's real rundown and echo pick
(``episodes/35/rundown.json``, ``echo-pick.json``, PR #43): the recompositor's output equals the issue 35
screenplay's title part exactly, so this is not a made-up expectation. The lint tests reuse the v2 fixture
(``fixture_news/episode_v2.py``), whose title part is itself built by ``title.recompose`` (so the fixture can
never silently drift from this module)."""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixture_news"))
import episode_v2 as EP2  # noqa: E402

from studio.news import lints as NL  # noqa: E402
from studio.news import title as TITLE  # noqa: E402

# Issue 35's real rundown and echo pick (PR #43, t9b/screenplay-35), trimmed to what this module reads.
ISSUE_35_RUNDOWN = {
    "schema": "omnibus.rundown/2",
    "edition": {"issue": 35, "cutoff_utc": "2026-11-21T14:17:37Z",
                "archive_commit": "b8dcf8752b2ddbb903c3e9a0ed05f29d3a98d82c",
                "window": {"from": "2026-11-16", "to": "2026-11-21"}},
    "stories": [
        {"rank": 1, "place": "KERCH", "slug": "THE BRIDGE IS STRUCK THREE TIMES", "slot": "lead"},
        {"rank": 2, "place": "BRUSSELS", "slug": "THE UK AND EU SIGN THREE DEALS", "slot": "package_2"},
        {"rank": 3, "place": "THE GULF", "slug": "QESHM IS STRUCK, DRONES AT BASES", "slot": "package_3"},
        {"rank": 4, "place": "SHENZHEN", "slug": "THREE LEADERS SIGN A DECLARATION", "slot": "package_4"},
        {"rank": 5, "place": "THE HAGUE", "slug": "COURT FINDS GENOCIDE IN MYANMAR", "slot": "package_5"},
        {"rank": 6, "place": "RIYADH", "slug": "MISSILES ARE STOPPED OVER RIYADH", "slot": "brief_1"},
    ],
    "echo": {"id": "yalta-conference-1945", "bank_commit": "e635665870796d6a37061be47f850260894f5565"},
}
ISSUE_35_ECHO_PICK = {"year": 1945}
ISSUE_35_WANT = {
    "title_lines": [
        "1  KERCH      THE BRIDGE IS STRUCK THREE TIMES",
        "2  BRUSSELS   THE UK AND EU SIGN THREE DEALS",
        "3  THE GULF   QESHM IS STRUCK, DRONES AT BASES",
        "4  SHENZHEN   THREE LEADERS SIGN A DECLARATION",
        "5  THE HAGUE  COURT FINDS GENOCIDE IN MYANMAR",
        "   AROUND THE WORLD",
        "   THE ECHO       1945",
    ],
    "week_line": "ISSUE 35   16 TO 21 NOV 2026   CLOSED SAT 21 NOV 14:17 UTC",
    "signon": "This is void omnibus. The week of sixteen November, on the record.",
}


def test_recompose_matches_issue_35_verbatim():
    assert TITLE.recompose(ISSUE_35_RUNDOWN, ISSUE_35_ECHO_PICK) == ISSUE_35_WANT


def test_rank_line_formula():
    assert TITLE.rank_line(1, "SHENZHEN", "THREE LEADERS SIGN A DECLARATION") == \
        "1  SHENZHEN   THREE LEADERS SIGN A DECLARATION"
    assert TITLE.rank_line(2, "KERCH", "THE BRIDGE IS STRUCK THREE TIMES") == \
        "2  KERCH      THE BRIDGE IS STRUCK THREE TIMES"


def test_rank_line_refuses_an_over_length_slug_or_line():
    with pytest.raises(ValueError, match="32"):
        TITLE.rank_line(1, "SHENZHEN", "X" * 33)
    with pytest.raises(ValueError, match="48"):
        TITLE.rank_line(1, "A VERY LONG PLACE NAME INDEED", "X" * 20)


def test_echo_line_verbatim():
    assert TITLE.echo_line(1945) == "   THE ECHO       1945"
    assert TITLE.echo_line("1962") == "   THE ECHO       1962"


def test_briefs_line_is_fixed():
    assert TITLE.BRIEFS_LINE == "   AROUND THE WORLD"


def test_packages_in_rank_order_excludes_briefs_and_sorts_by_rank():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    rundown["stories"].reverse()      # out of order on purpose: the function sorts, never trusts list order
    got = [s["rank"] for s in TITLE.packages_in_rank_order(rundown)]
    assert got == [1, 2, 3, 4, 5]      # brief_1 (rank 6) is never a package line


def test_packages_in_rank_order_raises_on_a_malformed_story():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    del rundown["stories"][0]["slug"]
    with pytest.raises(ValueError, match="slug"):
        TITLE.packages_in_rank_order(rundown)


@pytest.mark.parametrize("n,want", [(1, "one"), (9, "nine"), (10, "ten"), (16, "sixteen"), (19, "nineteen"),
                                     (20, "twenty"), (21, "twenty-one"), (30, "thirty"), (31, "thirty-one")])
def test_spoken_cardinal(n, want):
    assert TITLE.spoken_cardinal(n) == want


@pytest.mark.parametrize("n", [0, 32, -1, 1.5, True])
def test_spoken_cardinal_refuses_out_of_range(n):
    with pytest.raises(ValueError):
        TITLE.spoken_cardinal(n)


def test_week_line_truncates_the_cutoff_to_the_minute_never_rounds():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    rundown["edition"]["cutoff_utc"] = "2026-11-21T14:17:59Z"   # 59 seconds past the minute: still prints 14:17
    assert TITLE.week_line(rundown) == ISSUE_35_WANT["week_line"]


def test_week_line_accepts_a_cutoff_with_no_seconds():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    rundown["edition"]["cutoff_utc"] = "2026-11-21T14:17Z"
    assert TITLE.week_line(rundown) == ISSUE_35_WANT["week_line"]


def test_week_line_spans_two_months_when_the_window_does():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    rundown["edition"]["window"] = {"from": "2026-10-29", "to": "2026-11-02"}
    rundown["edition"]["cutoff_utc"] = "2026-11-02T12:00:00Z"
    assert TITLE.week_line(rundown) == "ISSUE 35   29 OCT TO 2 NOV 2026   CLOSED MON 2 NOV 12:00 UTC"


def test_echo_year_prefers_the_echo_pick_then_the_rundowns_own_then_the_bank_id():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    assert TITLE.echo_year(rundown, {"year": 1945}) == "1945"
    assert TITLE.echo_year(rundown, None) == "1945"             # falls back to the id's -YYYY suffix
    assert TITLE.echo_year(rundown, {"year": 1962}) == "1962"   # the echo pick wins when it disagrees
    rundown["echo"]["year"] = 1952
    assert TITLE.echo_year(rundown, None) == "1952"


def test_echo_year_raises_with_none_of_the_three():
    rundown = copy.deepcopy(ISSUE_35_RUNDOWN)
    rundown["echo"] = {"id": "cuban-missile-crisis"}      # no -YYYY suffix, no year field
    with pytest.raises(ValueError, match="year"):
        TITLE.echo_year(rundown, None)


def test_signon_line_is_a_cardinal_day_and_month_ending_on_the_tagline():
    assert TITLE.signon_line(ISSUE_35_RUNDOWN) == ISSUE_35_WANT["signon"]
    assert TITLE.signon_line(ISSUE_35_RUNDOWN).endswith(TITLE.TAGLINE_CLAUSE)


def test_the_taglines_clause_is_derived_not_duplicated():
    assert TITLE.TAGLINE == "The week, on the record."
    assert TITLE.TAGLINE_CLAUSE == "on the record."
    assert TITLE.SIGNON_TEMPLATE.endswith(TITLE.TAGLINE_CLAUSE)


def test_recompose_has_no_em_dash_and_no_literal_hex():
    want = TITLE.recompose(ISSUE_35_RUNDOWN, ISSUE_35_ECHO_PICK)
    text = " ".join(want["title_lines"]) + want["week_line"] + want["signon"]
    assert "—" not in text and "--" not in text


# --------------------------------------------------------------------------
# The lint, over the v2 fixture (fixture_news/episode_v2.py): a smaller, targeted check that the lint is wired
# into checks() and reads the right part and lines; the fixture's own FAIL cases (ticket 7's three) are already
# exercised by test_news_lints.py's generic fail-fixture machinery.
# --------------------------------------------------------------------------


def test_the_rule_is_registered_and_never_in_the_die_list():
    assert "title-lines-from-rundown" in NL.RULES
    assert "title-lines-from-rundown" not in NL.DIED
    assert "title-lines-verbatim" in NL.DIED and "title-lines-verbatim" not in NL.RULES


def test_title_lines_checks_passes_the_v2_fixture():
    play, _, inputs = EP2.episode()
    res = NL.title_lines_checks(play, inputs)
    assert res and all(c["ok"] and c["rule"] == "title-lines-from-rundown" and c["severity"] == "block" for c in res)


def test_title_lines_checks_is_a_noop_without_a_rundown_2():
    play, _, inputs = EP2.episode()
    assert NL.title_lines_checks(play, {**inputs, "rundown": {"schema": "omnibus.rundown/1"}}) == []
    assert NL.title_lines_checks(play, {**inputs, "rundown": None}) == []


def test_title_lines_checks_is_a_noop_with_no_title_part():
    play, _, inputs = EP2.episode()
    play = copy.deepcopy(play)
    play["parts"] = [p for p in play["parts"] if p["segment"] != "title"]
    assert NL.title_lines_checks(play, inputs) == []


def test_title_lines_checks_names_a_missing_shot_or_signon():
    play, _, inputs = EP2.episode()
    play = copy.deepcopy(play)
    title_part = next(p for p in play["parts"] if p["segment"] == "title")
    title_part["shots"] = [s for s in title_part["shots"] if s["id"] != "T-MACRO"]
    title_part["lines"] = []
    res = NL.title_lines_checks(play, inputs)
    assert {c["unit"] for c in res if not c["ok"]} == {"part p-title", "part p-title.signon"}


def test_title_lines_checks_catches_a_tampered_line_through_checks():
    """End to end through ``checks()`` (not just the one function), confirming the rule reaches the public API
    the render pipeline and ``python -m studio.news.lints`` both call."""
    play, assets, inputs = EP2.episode()
    play, assets, inputs = copy.deepcopy(play), copy.deepcopy(assets), copy.deepcopy(inputs)
    for p in play["parts"]:
        if p["segment"] == "title":
            for s in p["shots"]:
                if s.get("shows", {}).get("week_line"):
                    s["shows"]["week_line"] = "WRONG"
    res = NL.checks(play, assets, inputs=inputs)
    bad = {c["rule"] for c in res if not c["ok"] and c["severity"] == "block"}
    assert "title-lines-from-rundown" in bad
