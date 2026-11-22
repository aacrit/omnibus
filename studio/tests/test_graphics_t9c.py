# Net-new in omnibus (T9c).
"""studio/graphics/render.py, T9c: the v1 subtypes a v2 screenplay names (clock, slates, credits, end board) and the
title macro are drawn from v2 inputs; issue 33's frozen render_week33 is byte for byte the code it was; a subtype
still not drawn (page, count) raises before any browser opens. Pure: no Chromium."""

from __future__ import annotations

import hashlib
import inspect
import json
from pathlib import Path

import pytest

from studio.graphics import render

ROOT = Path(__file__).resolve().parents[2]
# sha256 of inspect.getsource(render.render_week33) as T4 (#44) merged it: the frozen v1 path, unchanged.
WEEK33_SOURCE_SHA256 = "59e332b79050ac0467c19d523a194758fb7d027a605d2b2d9b72bcfb85f8e27e"


def test_render_week33_is_byte_for_byte_the_frozen_v1_code():
    assert hashlib.sha256(inspect.getsource(render.render_week33).encode()).hexdigest() == WEEK33_SOURCE_SHA256


def _play():
    return json.loads((ROOT / "episodes" / "35" / "screenplay.json").read_text(encoding="utf-8"))


def _rundown():
    return json.loads((ROOT / "episodes" / "35" / "rundown.json").read_text(encoding="utf-8"))


def test_the_v2_release_is_the_monday_21_utc_after_the_cutoff_and_nominal():
    assert render.v2_release({"news": {"edition": {"cutoff_utc": "2026-11-21T14:17:37Z"}}}) == ("2026-11-23T21:00:00Z", True)
    assert render.v2_release({"news": {"edition": {"cutoff_utc": "2026-11-23T21:00:00Z"}}}) == ("2026-11-30T21:00:00Z", True)


def test_the_title_prints_the_rundowns_own_slugs():
    shot, tm = render.title_spec(_play(), _rundown())
    assert shot["id"] == "T-MACRO" and tm.lines[0] == "1  KERCH      THE BRIDGE IS STRUCK THREE TIMES"
    assert tm.week_line.startswith("ISSUE 35")


def test_a_title_line_the_rundown_does_not_print_is_refused():
    rd = _rundown()
    rd["stories"][0] = dict(rd["stories"][0], slug="SOMETHING ELSE")
    with pytest.raises(ValueError, match="not the rundown's"):
        render.title_spec(_play(), rd)


@pytest.mark.parametrize("subtype", ["count"])
def test_a_subtype_still_not_drawn_raises_before_any_browser(subtype, tmp_path, monkeypatch):
    monkeypatch.setattr(render.shoot, "chromium", lambda: (_ for _ in ()).throw(AssertionError("a browser opened")))
    play = {"parts": [{"id": "p1", "segment": "lead",
                       "shots": [{"id": "G1", "kind": "graphic", "subtype": subtype, "mark": "DRAWN", "start_s": 0}]}]}
    with pytest.raises(NotImplementedError, match=subtype):
        render.render_episode(play, tmp_path)


def test_every_subtype_issue_35_names_is_drawn():
    subtypes = {g["shot"]["subtype"] for g in render.graphics_shots(_play())}
    assert subtypes <= set(render.V2_RENDERERS)


def test_a_page_with_its_verbatim_words_source_id_and_source_line():
    from studio.graphics import data, typeset
    shot = {"id": "g-p", "subtype": "page", "dot_label": "RELEASED BY THE WHITE HOUSE",
            "page": {"source_id": "e35-p4-declaration", "title": ["JOINT DECLARATION"],
                     "body": ["The three heads of state reaffirmed that a nuclear war cannot be won."],
                     "source": "The White House, 19 Nov 2026"}}
    spec = data.page_spec(shot)
    assert spec.party_label == "RELEASED BY THE WHITE HOUSE" and not spec.echo
    html = typeset.page_html(spec, tokens_css="t", frame_css="f")
    assert "a nuclear war cannot be won." in html and "RELEASED BY THE WHITE HOUSE" in html


@pytest.mark.parametrize("drop,why", [("body", "verbatim"), ("source_id", "source_id"), ("source", "source line")])
def test_a_page_without_its_words_or_its_source_is_refused(drop, why):
    from studio.graphics import data
    pg = {"source_id": "x", "body": ["words"], "source": "a line"}
    pg.pop(drop)
    with pytest.raises(ValueError, match=why):
        data.page_spec({"id": "g-p", "page": pg})
    with pytest.raises(ValueError, match="names its document"):
        data.page_spec({"id": "g-p"})


def test_a_graphic_is_ledgered_by_its_plan_item_and_dated_from_the_plan(tmp_path):
    from studio.graphics import ledger
    e = ledger.LedgerEntry(id="g-clock", subtype="clock", data_ref="release", source_template_sha256="0" * 64,
                           output_path="x.mov", output_sha256="0" * 64, frames=180, extra={})
    render.plan_fields([e], ROOT / "episodes" / "35", _play())
    assert e.extra["content_date"] and e.extra["content_basis"]


def test_the_runner_lays_rights_media_where_each_screenplay_names_them():
    from studio.engine import mediaroot as MR
    env = {"OMNIBUS_MEDIA_ROOT": "/home/runner/omnibus-media"}
    assert MR.rights_dir(ROOT / "episodes" / "35", env) == "/home/runner/omnibus-media/35"
    assert MR.rights_dir(ROOT / "episodes" / "33", env) == "/home/runner/omnibus-media/33/media/33"
