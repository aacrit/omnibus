"""E6: data extraction (studio/graphics/data.py) against the real week-33
record, rundown and echo pick already committed in this repo - no
browser, just JSON already on disk."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from studio.graphics import data, layout

ROOT = Path(__file__).resolve().parents[2]


def _load(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def week():
    return _load("data/week-33.json")


@pytest.fixture(scope="module")
def rundown():
    return _load("episodes/33/rundown.json")


@pytest.fixture(scope="module")
def echo_pick():
    return _load("episodes/33/echo-pick.json")


@pytest.fixture(scope="module")
def rights():
    return _load("episodes/33/rights-ledger.json")


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
    assert days[0].bars_field == "days[0].lead.buckets"


def test_board_spec_rows_untitled_and_labels(rundown, week):
    board = data.board_spec(rundown, week, issue=33, rung_labels=layout.load_lean_label_text())
    assert board.head_right == "WEEK 33"
    assert [r.rung for r in board.rows] == ["left", "center-left", "center", "center-right", "right", "far-right"]
    assert board.untitled.get("far-left") == ["Tehran Times"]
    assert board.rung_labels["center-left"] == "Center-Left"


# ---- count cards ------------------------------------------------------------

def test_as_of_line_matches_spec_3_7():
    assert data.as_of_line("2026-11-08T22:16:50.309638+00:00") == "AS OF 08 NOV 2026"
    assert data.as_of_line("2026-10-26T01:00:00Z") == "AS OF 26 OCT 2026"


def test_claim_term_card_matches_the_tickets_own_example(week):
    cc = data.claim_term_card(week, issue=33, date_line="AS OF 08 NOV 2026")
    by_context = {row.context.split(",")[0]: row.hero for row in cc.rows}
    assert by_context == {"Iran": "39", "Israel": "4", "inflation": "1"}
    assert all(row.context.endswith("of 46 titled headlines") for row in cc.rows)


def test_weight_known_cards_never_double_their_of(rundown):
    cards = data.weight_known_count_cards(rundown, issue=33, date_line="AS OF 08 NOV 2026")
    assert [c.id for c in cards] == ["cw-2", "cw-3"]
    assert cards[1].rows[0].context == "titled headlines of 89 articles"
    assert "of 89" in cards[1].rows[0].context and cards[1].rows[0].context.count("89") == 1


def test_weight_known_card_whose_context_lacks_its_of_is_refused(rundown):
    broken = copy.deepcopy(rundown)
    for p in broken["parts"]:
        for b in p.get("beats", []):
            if b.get("id") == "weight-known":
                b["count_cards"][1]["context"] = "titled headlines"
    with pytest.raises(ValueError):
        data.weight_known_count_cards(broken, issue=33, date_line="x")


def test_count_card_hold_is_words_over_three_plus_one_and_a_half(rundown, week, echo_pick):
    cards = {c.id: c for c in data.all_count_cards(rundown, week, echo_pick, issue=33)}
    # cw-2: "76" (1) + "outlets in the claim's records" (5) + "AS OF 08 NOV 2026" (5) = 11 words.
    assert cards["cw-2"].words == 11
    assert cards["cw-2"].hold_s == pytest.approx(11 / 3 + 1.5)
    assert all(c.date_line == "AS OF 08 NOV 2026" for k, c in cards.items() if k != "cw-4")


def test_echo_card_takes_its_date_and_basis_from_echo_pick(rundown, echo_pick):
    card = data.echo_comparison_card(rundown, echo_pick, issue=33)
    assert card.id == "cw-4" and card.echo is True and card.eyebrow == "THE ECHO"
    assert [(r.context, r.hero) for r in card.rows] == [("Kefauver", "19,800"), ("Truman", "15,927")]
    assert card.date_line == "11 MAR 1952 · STATE CANVASS, PRINTED 1953"
    # The card names what was counted (echo-pick's own `what`), not bare candidate names;
    # it sits only on the first row, since typeset shows it once, not per row.
    what = echo_pick["counts_on_screen"][0]["what"]
    assert card.rows[0].qualifier == what
    assert all(r.qualifier is None for r in card.rows[1:])
    assert "New Hampshire Democratic" in what


def test_echo_card_refuses_values_that_disagree_with_echo_pick(rundown, echo_pick):
    pick = copy.deepcopy(echo_pick)
    pick["counts_on_screen"][0]["values"]["Kefauver"] = 19801
    with pytest.raises(ValueError):
        data.echo_comparison_card(rundown, pick, issue=33)


def test_all_count_cards_includes_cw1_through_cw4(rundown, week, echo_pick):
    assert [c.id for c in data.all_count_cards(rundown, week, echo_pick, issue=33)] == ["cw-1", "cw-2", "cw-3", "cw-4"]


# ---- lower thirds ---------------------------------------------------------

def test_normalise_source_id_strips_parentheticals():
    assert data.normalise_source_id("src-eisenhower-19521024 (transcribed from the scan)") == (
        "src-eisenhower-19521024", "transcribed from the scan")
    assert data.normalise_source_id("src-fr-19510130") == ("src-fr-19510130", "")


def test_every_reader_beat_gets_a_lower_third(rundown, echo_pick):
    thirds = data.lower_thirds(rundown, echo_pick)
    assert [lt.id for lt in thirds] == ["lt-echo-x2", "lt-echo-x3", "lt-echo-x6", "lt-echo-x8", "lt-echo-x9"]
    by_id = {lt.id: lt for lt in thirds}
    assert by_id["lt-echo-x8"].speaker_name == "Dwight D. Eisenhower"
    assert by_id["lt-echo-x2"].speaker_name == ""          # a period document, no speaker
    assert all(lt.echo and lt.place and lt.date for lt in thirds)


def test_dot_labels_come_from_the_reader_voice(rundown, echo_pick):
    thirds = {lt.id: lt for lt in data.lower_thirds(rundown, echo_pick)}
    assert all(lt.dot_labels[0] == "COMPUTER VOICE" for lt in thirds.values())   # Kokoro reads the quotes
    assert thirds["lt-echo-x8"].dot_labels == ("COMPUTER VOICE", "TRANSCRIBED PAGE")
    assert thirds["lt-echo-x3"].dot_labels == ("COMPUTER VOICE",)
    assert not any("RECONSTRUCTED" in lab for lt in thirds.values() for lab in lt.dot_labels)


def test_voice_dot_label_rules():
    assert data.voice_dot_label({"engine": "kokoro", "voice": "am_michael"}) == "COMPUTER VOICE"
    assert data.voice_dot_label({"engine": "clone", "founder": True}) == "SYNTHESISED VOICE"
    with pytest.raises(ValueError):
        data.voice_dot_label({"engine": "mystery"})


def test_unknown_reader_voice_fails(rundown, echo_pick):
    broken = copy.deepcopy(rundown)
    broken["voices"]["reader"] = {"engine": "somebody"}
    with pytest.raises(ValueError):
        data.lower_thirds(broken, echo_pick)


def test_a_reader_beat_that_cannot_be_joined_raises(rundown, echo_pick):
    pick = copy.deepcopy(echo_pick)
    pick["period_perspectives"] = [p for p in pick["period_perspectives"] if "eisenhower" not in p["source"]]
    pick["period_documents"] = [d for d in pick["period_documents"] if "eisenhower" not in d["id"]]
    with pytest.raises(ValueError, match="echo-x8"):
        data.lower_thirds(rundown, pick)


# ---- clock ----------------------------------------------------------------

def test_clock_from_release_sweeps_the_last_six_seconds():
    clk = data.clock_spec_for_release(data.parse_release("2026-11-16T21:00:00Z"), nominal=True)
    assert (clk.hour, clk.minute, clk.second) == (20, 59, 54)
    assert clk.date_line == "MON 16 NOV 2026 · UTC"
    assert clk.release == "2026-11-16T21:00:00Z" and clk.release_nominal is True


def test_release_must_carry_an_offset_and_a_whole_second():
    with pytest.raises(ValueError):
        data.parse_release("2026-11-16T21:00:00")
    with pytest.raises(ValueError):
        data.parse_release("2026-11-16T21:00:00.5Z")


# ---- credits ------------------------------------------------------------

def test_credits_use_each_items_credit_then_voice_then_disclosures(rundown, rights):
    cs = data.credits_spec(rundown, rights)
    credits = []
    for item in rights["items"]:
        if item["credit"] not in credits:
            credits.append(item["credit"])
    assert list(cs.lines[:len(credits)]) == credits
    titles = {i["title"] for i in rights["items"]} - set(credits)
    assert not titles & set(cs.lines)                       # never the item title
    voice = cs.lines[len(credits)]
    assert voice == "Narrated by a computer voice, Kokoro af_aoede; quotations read by Kokoro am_michael"
    assert "untitled occupied rung: far-left (Tehran Times)" in cs.lines
    disclosures = next(p for p in rundown["parts"] if p["id"] == "credits")["disclosures"]
    assert list(cs.lines[len(credits) + 1:]) == disclosures


def test_credits_raise_rather_than_slice(rundown):
    many = {"items": [{"id": f"i{n}", "credit": f"Credit {n}"} for n in range(41)]}
    with pytest.raises(ValueError):
        data.credits_spec(rundown, many)


def test_voice_credit_line_for_the_founder():
    line = data.voice_credit_line({"narrator": {"founder": True}, "reader": {"engine": "kokoro", "voice": "am_michael"}})
    assert line.startswith("Narrated in the founder's voice, synthesised with their consent")


def test_end_board_spec(week):
    eb = data.end_board_spec(week)
    assert eb.issue == 33
    assert eb.roman_year == "MMXXVI"
    assert eb.licence == "CC BY-SA 4.0"


def test_title_macro_spec(rundown):
    tm = data.title_macro_spec(rundown)
    assert len(tm.lines) == 7
    assert tm.rate_cps == pytest.approx(74.3)
    assert tm.print_window_s == pytest.approx(11.4)
    assert sum(len(x) for x in tm.lines) == 651


def test_title_macro_refuses_a_rate_over_the_cap(rundown):
    broken = copy.deepcopy(rundown)
    next(p for p in broken["parts"] if p["id"] == "title")["strike"]["rate_cps"] = 100.5
    with pytest.raises(ValueError):
        data.title_macro_spec(broken)
