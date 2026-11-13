# Net-new in omnibus (E3).
"""The news lints (studio/news/lints.py, schema.py): one pass fixture passes every rule; each fail fixture fails
exactly the rules it names. Plus the show profile's tweaks to the lifted engine (cadence, description, motion)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent / "fixture_news"))

import episode as EP  # noqa: E402

from studio.engine import cadence as CAD  # noqa: E402
from studio.engine import description as DSC  # noqa: E402
from studio.news import lints as NL  # noqa: E402
from studio.news import profile as SHOW  # noqa: E402

BLOCKING_RULES = set(NL.RULES) - set(NL.DEFERRED)


def run(play, assets, inputs):
    return NL.checks(play, assets, inputs=inputs)


def failing_rules(res):
    return {c["rule"] for c in res if not c["ok"] and c["severity"] == "block"}


def test_the_pass_fixture_passes_every_rule():
    res = run(*EP.episode())
    assert failing_rules(res) == set(), [c for c in res if not c["ok"] and c["severity"] == "block"]
    passed = {c["rule"] for c in res if c["ok"] and c["severity"] == "block"}
    # every rule is exercised, not skipped (news-inputs is checked through the file path below)
    assert BLOCKING_RULES - {"news-inputs"} <= passed, BLOCKING_RULES - passed


@pytest.mark.parametrize("name", sorted(EP.FAIL))
def test_each_fail_fixture_fails_exactly_its_rules(name):
    play, assets, inputs, rules = EP.failing(name)
    got = failing_rules(run(play, assets, inputs))
    assert got == rules


def test_every_blocking_rule_has_a_fail_fixture():
    covered = set().union(*(r for _, r in EP.FAIL.values())) | {"news-inputs"}
    assert BLOCKING_RULES <= covered, BLOCKING_RULES - covered


def test_news_inputs_read_from_files_and_refuse_when_missing(tmp_path):
    play, assets, inputs = EP.episode()
    for name, key in (("week.json", "record"), ("rundown.json", "rundown"), ("echo-pick.json", "echo")):
        (tmp_path / name).write_text(json.dumps(inputs[key]), encoding="utf-8")
    res = NL.checks(play, assets, film=tmp_path)
    assert failing_rules(res) == set()
    assert any(c["rule"] == "news-inputs" and c["ok"] for c in res)
    play["news"]["week"] = "missing.json"
    assert failing_rules(NL.checks(play, assets, film=tmp_path)) == {"news-inputs"}


def test_deferred_rules_are_declared_not_implemented():
    res = run(*EP.episode())
    deferred = {c["rule"]: c for c in res if c["severity"] == "not_implemented"}
    assert set(deferred) == {"clock-true", "sources-last", "no-youtube"}


def test_a_document_screenplay_gets_no_news_lints():
    play, assets, inputs = EP.episode()
    play["show"] = "document"
    assert NL.checks(play, assets, inputs=inputs) == []


def test_party_names_of_1952_are_allowed_and_names_match_whole_words():
    play, assets, inputs = EP.episode()
    EP.line(play, "L-echo")["text"] = "October 1952. Doerr and the Democratic ticket went to the wards."
    assert failing_rules(run(play, assets, inputs)) == set()


# -- against the real week 33 record and rundown ---------------------------------------------------------------


def real_inputs():
    return {"record": json.loads((ROOT / "data/week-33.json").read_text(encoding="utf-8")),
            "rundown": json.loads((ROOT / "episodes/33/rundown.json").read_text(encoding="utf-8")),
            "echo": json.loads((ROOT / "episodes/33/echo-pick.json").read_text(encoding="utf-8"))}


def test_week_33_title_lines_and_board_pass_against_the_record():
    inp = real_inputs()
    title = next(p for p in inp["rundown"]["parts"] if p["id"] == "title")
    assert NL.expected_title_lines(inp["record"]) == title["title_lines"]
    assert NL.expected_week_line(inp["record"]) == title["week_line"]
    rows = [{k: r[k] for k in ("rung", "outlet", "headline", "headline_sha256")} for r in inp["record"]["lead"]["board"]]
    play = {"parts": [{"id": "w", "shots": [{"id": "B", "kind": "graphic", "subtype": "board", "data_ref": "lead.board",
                                             "shows": {"rows": rows}}]}]}
    res = NL.board_checks(play, inp)
    assert all(c["ok"] for c in res), res


def test_week_33_no_bridge_list_comes_from_the_rundown():
    names = NL.bridge_list(real_inputs())
    assert "Vance" in names and "Troy Jackson" in names and "Democratic" not in names


def test_week_33_reader_hashes_are_extracts():
    inp = real_inputs()
    ex = NL._hashes_under(inp["rundown"])
    reader = [x for p in inp["rundown"]["parts"] for b in p.get("beats") or [] for x in b.get("reader") or []]
    assert reader and all(NL.sha256_text(x["text"]) == x["quote_sha256"] in ex for x in reader)


# -- the show profile's tweaks ------------------------------------------------------------------------------------


def test_30_fps_only_where_the_show_allows_it():
    with pytest.raises(CAD.RateError, match="24 or 30000/1001"):
        CAD.parse_rate(30)
    om = SHOW.masters({"show": "omnibus"})
    assert CAD.parse_rate(30, om) == CAD.BROADCAST and CAD.parse_rate("30/1", om) == CAD.BROADCAST
    assert CAD.native_master(30.0, None, om) == CAD.BROADCAST
    assert CAD.native_master(29.97, None, om) == CAD.NTSC
    assert CAD.native_master(30.0, None) == CAD.NTSC        # document: unchanged
    assert CAD.resolve(30, [], om)["name"] == "30"


def test_profiles_carry_loudness_brand_and_links():
    om, doc = SHOW.of({"show": "omnibus"}), SHOW.of({})
    assert (om["target_lufs"], om["target_tp"]) == (-16.0, -1.5) and doc["target_lufs"] == -18.0
    rec = SHOW.record(om, {"issue": 33})
    assert rec["sources_page"] == "https://omnibus.voidvision.org/e/33/sources"
    assert rec["correct_page"] == "https://omnibus.voidvision.org/e/33/correct"
    assert SHOW.wordmark_text(om) == "void omnibus"
    assert SHOW.problems({"show": "omnibus"}) and not SHOW.problems({"show": "omnibus", "issue": 33})
    with pytest.raises(SHOW.ShowError):
        SHOW.of({"show": "nope"})


def test_description_links_to_the_shows_own_pages():
    src = {"v": 2, "title": "Week 33", "slug": "week-33", "shots": [], "show": SHOW.record(SHOW.of({"show": "omnibus"}),
                                                                                          {"issue": 33})}
    text = DSC.compose(src)["text"]
    assert "document.voidvision.org" not in text and "void document" not in text
    assert "https://omnibus.voidvision.org/e/33/correct" in text
    doc = DSC.compose({"v": 2, "title": "X", "slug": "x", "shots": []})["text"]
    assert "https://document.voidvision.org/f/x/correct/" in doc


def test_the_title_card_draws_the_shows_wordmark():
    from studio.engine import render as R
    shot = {"id": "S1", "kind": "card", "card": "title", "text": ["Week 33", "void omnibus"], "_part_kind": "title"}
    assert R.card_text_check(shot, 1920, 1080, show=dict(SHOW.of({"show": "omnibus"})))["missing"] == []
    assert R.card_text_check(shot, 1920, 1080)["missing"]        # document's draws "void document"


def test_apply_show_sets_the_programme_loudness():
    from studio.engine import render as R
    try:
        R.apply_show(SHOW.of({"show": "omnibus"}))
        assert R.TARGET_LUFS == -16.0 and abs(R.VOICE_TP - (-20.0 + 14.5 - 1.3)) < 1e-9
    finally:
        R.apply_show(SHOW.of({}))
    assert R.TARGET_LUFS == -18.0


ATTACK = '"><img src=x onerror=alert(1)>'


def test_hostile_text_is_data_not_markup():
    """No renderer here emits HTML; a hostile string in a screenplay is read as text and reported verbatim."""
    play, assets, inputs = EP.episode()
    EP.line(play, "L-mon")["text"] = ATTACK
    res = run(play, assets, inputs)
    assert failing_rules(res) == set()
