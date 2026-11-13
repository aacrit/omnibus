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
    assert set(deferred) == {"clock-true", "sources-last", "no-youtube", "no-bridge-reverse"}
    assert all(c["evidence"]["what"] and c["evidence"]["deferred_to"] for c in deferred.values())


def test_a_naive_date_time_is_imprecise_never_utc():
    lo, hi, precise = NL.instant("2026-03-02T11:30:00")
    assert not precise and (hi - lo).total_seconds() > 24 * 3600
    assert NL.instant("2026-03-02T11:30:00Z")[2]


def test_items_under_a_late_part_are_judged_against_the_episode():
    play, assets, inputs = EP.episode()
    EP.part(play, "p-margins")["as_of"] = "2026-03-08"
    assets["st-margin"]["date"] = "2026-03-08T23:30:00+00:00"
    bad = [c for c in run(play, assets, inputs) if c["rule"] == "as-of" and not c["ok"]]
    units = {c["unit"] for c in bad}
    assert "part p-margins" in units and "S-MARGIN" in units
    item = next(c for c in bad if c["unit"] == "S-MARGIN")
    assert item["evidence"]["as_of"] == EP.AS_OF                  # clamped to the episode's instant


def test_a_reader_line_takes_its_date_from_the_extract():
    play, assets, inputs = EP.episode()
    EP.line(play, "R2").pop("date")
    inputs["echo"]["period_documents"][0]["date"] = "1952-11-04"
    assert failing_rules(run(play, assets, inputs)) == set()


def test_week_33_rundown_spine_and_bridge_list_read():
    names = NL.bridge_list(real_inputs())
    rx = NL.bridge_matchers(names)
    hit = lambda t: sorted({nm for nm, r in rx if r.search(NL.fold(t))})  # noqa: E731
    assert hit("The Iranian delegation") == ["Iran"]
    assert hit("TRUMP spoke") == ["Trump"]
    assert hit("The Jefferson-Jackson Day Dinner") == []          # word rule: "Troy Jackson" only in full
    assert hit("The Democratic and Republican tickets") == []      # founder ruling: the 1952 party names
    assert hit("Kiev in 1952") == ["Kyiv"]                         # a period spelling of a listed place


def test_the_spine_trusts_labels_only_in_order():
    play, _, _ = EP.episode()
    from studio.news import schema as SC
    assert SC.segments(play) == [p["segment"] for p in play["parts"]]
    EP.part(play, "p-margins")["segment"] = "credits"
    seg = SC.segments(play)
    assert seg[6] is None and seg[-1] == "credits"


def test_archival_gain_reads_the_shows_voice_ceiling_at_call_time():
    from studio.engine import render as R
    m = {"input_tp": -3.0}
    try:
        R.apply_show(SHOW.of({"show": "omnibus"}))
        assert abs(R._archival_total(10.0, m, 0.0) - (R.VOICE_TP + 3.0)) < 1e-9
        assert abs(R.VOICE_TP_FLOOR - (R.VOICE_TP - R.VOICE_TP_FLOOR_BELOW)) < 1e-9 and R.VOICE_TP_FLOOR < -7.0
    finally:
        R.apply_show(SHOW.of({}))
    assert R.VOICE_TP_FLOOR == -7.0 and abs(R._archival_total(10.0, m, 0.0) - (-4.8 + 3.0)) < 1e-9


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


def test_a_document_title_card_draws_the_house_wordmark_whatever_the_profile():
    from studio.engine import render as R
    shot = {"id": "S1", "kind": "card", "card": "lockup", "text": [], "_part_kind": "chapter"}
    from studio.engine import motion as M
    assert R.card_text_check(shot, 1920, 1080, show=dict(SHOW.of({}))) == R.card_text_check(shot, 1920, 1080)
    assert R.show_lockup(dict(SHOW.of({}))) == M.LOCKUP_BRAND and R.show_wordmark(dict(SHOW.of({}))) == M.WORDMARK


ATTACK = '"><img src=x onerror=alert(1)>'


def test_hostile_text_is_data_not_markup():
    """No renderer here emits HTML; a hostile string in a screenplay is read as text and reported verbatim."""
    play, assets, inputs = EP.episode()
    EP.line(play, "L-mon")["text"] = ATTACK
    res = run(play, assets, inputs)
    assert failing_rules(res) == set()


# -- S4: founder ruling A (2026-11-13), picture_published_by_edition ----------------------------------------------


def _week_pic(published_at, *, date="2026-03-02", label="item", shot_label="item"):
    """The pass fixture with a picture of Monday's own event on Monday's part (horizon 2 Mar 12:00 UTC)."""
    play, assets, inputs = EP.episode()
    want = NL.edition_dot_label(date, published_at)
    item = {"id": "st-mon", "date": date, "published_at": published_at, "licence": "public domain", "title": "Council"}
    if label:
        item["dot_label"] = {"text": want if label == "item" else label, "why": "ruling A"}
    assets["st-mon"] = item
    sh = {"id": "S-MON-PIC", "kind": "archive_video", "asset": "st-mon", "start_s": 25.0, "dur_s": 5.0}
    if shot_label:
        sh["dot_label"] = want if shot_label == "item" else shot_label
    EP.part(play, "p-mon")["shots"].append(sh)
    return NL.published_by_edition_checks(play, assets)


def _bad(res):
    return [c for c in res if not c["ok"] and c["severity"] == "block"]


def test_the_dot_label_reads_filmed_and_published_days():
    assert NL.edition_dot_label("2026-11-02", "2026-11-05T04:06:35Z") == "FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026"


def test_a_week_picture_published_by_the_edition_cutoff_passes_with_its_dot_label():
    res = _week_pic("2026-03-05T09:00:00+00:00")
    assert not _bad(res), res
    assert any(c["rule"] == "picture_published_by_edition" and c["ok"] and c["evidence"]["checked"] == 1 for c in res)


def test_a_week_picture_published_by_the_horizon_needs_no_label():
    assert not _bad(_week_pic("2026-03-02T10:00:00+00:00", label=None, shot_label=None))


def test_a_week_picture_after_the_edition_cutoff_fails():
    bad = _bad(_week_pic("2026-03-09T09:00:00+00:00"))
    assert bad and any("edition cutoff" in pr for pr in bad[0]["evidence"]["problems"])


def test_a_week_picture_of_a_later_event_fails():
    bad = _bad(_week_pic("2026-03-05T09:00:00+00:00", date="2026-03-04"))
    assert bad and any("not dated to a day on or before" in pr for pr in bad[0]["evidence"]["problems"])


def test_a_week_picture_without_its_dot_label_fails_on_the_item_and_the_shot():
    probs = _bad(_week_pic("2026-03-05T09:00:00+00:00", label=None, shot_label=None))[0]["evidence"]["problems"]
    assert any("ledger item" in pr for pr in probs) and any("the shot" in pr for pr in probs)
    probs = _bad(_week_pic("2026-03-05T09:00:00+00:00", shot_label="FILMED 2 MAR 2026"))[0]["evidence"]["problems"]
    assert probs == [next(pr for pr in probs if "the shot" in pr)]


def test_an_own_printed_page_is_held_to_its_capture_not_its_publication():
    play, assets, inputs = EP.episode()
    assets["st-margin"]["published_at"] = "2026-03-09T08:00:00+00:00"
    assets["st-margin"]["own_property"] = {"publication": "fixture"}
    assert not _bad(NL.published_by_edition_checks(play, assets))


def test_a_week_picture_of_an_event_before_the_days_window_fails():
    """S4 review: ruling A's window has a start too (the ledger's day_from, else the previous day's horizon)."""
    play, assets, inputs = EP.episode()
    published_at, date = "2026-03-05T09:00:00+00:00", "2026-03-01"
    item = {"id": "st-mon", "date": date, "published_at": published_at, "licence": "public domain", "title": "Council",
            "published_by_edition": {"day_from": "2026-03-02"},
            "dot_label": {"text": NL.edition_dot_label(date, published_at), "why": "ruling A"}}
    assets["st-mon"] = item
    EP.part(play, "p-mon")["shots"].append({"id": "S-MON-PIC", "kind": "archive_video", "asset": "st-mon", "start_s": 25.0,
                                            "dur_s": 5.0, "dot_label": NL.edition_dot_label(date, published_at)})
    bad = _bad(NL.published_by_edition_checks(play, assets))
    assert bad and any("before the day's window starts" in pr for pr in bad[0]["evidence"]["problems"])
    item["published_by_edition"]["day_from"] = "2026-03-01"
    assert not _bad(NL.published_by_edition_checks(play, assets))


def test_a_later_week_day_starts_its_window_at_the_previous_days_horizon():
    play, assets, inputs = EP.episode()
    ps = play["parts"]
    i = next(k for k, p in enumerate(ps) if p["id"] == "p-mon")
    tue = {**ps[i], "id": "p-tue", "as_of": "2026-03-03T12:00:00+00:00", "shots": [], "lines": [], "cues": [], "text": []}
    ps.insert(i + 1, tue)
    published_at = "2026-03-05T09:00:00+00:00"
    for date, ok in (("2026-03-01", False), ("2026-03-02", True)):
        assets["st-tue"] = {"id": "st-tue", "date": date, "published_at": published_at, "licence": "public domain",
                            "title": "Council", "dot_label": {"text": NL.edition_dot_label(date, published_at), "why": "A"}}
        tue["shots"] = [{"id": "S-TUE-PIC", "kind": "archive_video", "asset": "st-tue", "start_s": 0.0, "dur_s": 5.0,
                         "dot_label": NL.edition_dot_label(date, published_at)}]
        bad = [c for c in _bad(NL.published_by_edition_checks(play, assets)) if c.get("unit") == "S-TUE-PIC"
               or c.get("evidence", {}).get("part") == "p-tue"]
        assert (not bad) == ok, (date, bad)
