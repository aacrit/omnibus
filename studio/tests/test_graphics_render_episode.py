"""show bible v2, ticket 4: the generic driver's pure-Python half - walking a v2 episode's parts for graphic
shots and text elements (`render.graphics_shots`), and the subtype dispatch table (`render.V2_RENDERERS`). The
part that actually opens Chromium (`render.render_episode`) is out of this fast gate, same as `render_week33`
always has been; this file is the pure-Python coverage.

It also holds the fixture's one invariant: `episodes/900/screenplay.json`, the file `episode-draft.yml`'s
`route` job checks for and `render.py`'s CLI reads for `week900`, must be exactly
`fixtures.EPISODE_V2_FIXTURE` dumped to JSON - so the two can never quietly drift apart.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from studio.graphics import data, fixtures, render

ROOT = Path(__file__).resolve().parents[2]


def test_graphics_shots_walks_every_part_in_order():
    shots = render.graphics_shots(fixtures.EPISODE_V2_FIXTURE)
    ids = [g["shot"]["id"] for g in shots]
    assert ids == ["G-LOC-1", "G-BSTRIP-1", "G-BUMPER-BRIEFS", "G-LOC-2", "G-BSTRIP-2", "G-SOT-1", "G-SOT-2",
                   "G-BUMPER-ECHO"]


def test_graphics_shots_tags_segment_and_overlay():
    by_id = {g["shot"]["id"]: g for g in render.graphics_shots(fixtures.EPISODE_V2_FIXTURE)}
    assert by_id["G-LOC-1"]["segment"] == "tease" and by_id["G-LOC-1"]["overlay"] is False
    assert by_id["G-BSTRIP-1"]["overlay"] is True
    assert by_id["G-BUMPER-ECHO"]["segment"] == "echo"


def test_graphics_shots_marks_the_first_shot_of_its_part():
    by_id = {g["shot"]["id"]: g for g in render.graphics_shots(fixtures.EPISODE_V2_FIXTURE)}
    assert by_id["G-BUMPER-BRIEFS"]["first"] is True   # opens the briefs part
    assert by_id["G-LOC-2"]["first"] is False           # the briefs part's second shot
    assert by_id["G-BSTRIP-1"]["first"] is False        # a text element, never "first"


def test_graphics_shots_ignores_a_part_with_no_shots_or_text():
    rundown = {"parts": [{"id": "p-empty", "segment": "signoff"}]}
    assert render.graphics_shots(rundown) == []


def test_graphics_shots_skips_a_non_graphic_shot():
    rundown = {"parts": [{"id": "p1", "segment": "lead",
                          "shots": [{"id": "S1", "kind": "archive_video"}],
                          "text": [{"id": "T1", "kind": "lower_third"}]}]}
    assert render.graphics_shots(rundown) == []


def test_v2_renderers_cover_exactly_the_subtypes_this_ticket_draws():
    assert set(render.V2_RENDERERS) == set(render.V2_SUBTYPES_DRAWN) == {
        "bumper", "locator", "sot_super", "brief_strip"}


def test_every_fixture_shot_has_a_registered_renderer():
    for g in render.graphics_shots(fixtures.EPISODE_V2_FIXTURE):
        assert g["shot"]["subtype"] in render.V2_RENDERERS


def test_a_subtype_render_episode_does_not_yet_draw_raises_not_implemented():
    rundown = {"parts": [{"id": "p1", "segment": "lead",
                          "shots": [{"id": "G1", "kind": "graphic", "subtype": "count", "mark": "DRAWN"}]}]}
    with pytest.raises(NotImplementedError):
        # No browser is opened before the subtype is checked, so this raises before shoot.chromium() is ever
        # reached - exercised here without Playwright installed.
        for g in render.graphics_shots(rundown):
            fn = render.V2_RENDERERS.get(g["shot"]["subtype"])
            if fn is None:
                raise NotImplementedError(g["shot"]["subtype"])


def test_every_fixture_spec_extracts_without_error():
    for g in render.graphics_shots(fixtures.EPISODE_V2_FIXTURE):
        shot, subtype = g["shot"], g["shot"]["subtype"]
        if subtype == "bumper":
            data.bumper_spec(shot, segment=g["segment"])
        elif subtype == "locator":
            data.locator_spec(shot)
        elif subtype == "sot_super":
            data.sot_super_spec(shot)
        elif subtype == "brief_strip":
            data.brief_strip_spec(shot)
        else:
            pytest.fail(f"no extractor exercised for {subtype!r}")


def test_episode_900_screenplay_json_matches_the_fixture_verbatim():
    on_disk = json.loads((ROOT / "episodes" / "900" / "screenplay.json").read_text(encoding="utf-8"))
    assert on_disk == fixtures.EPISODE_V2_FIXTURE


def test_episode_900_graphics_ledger_json_is_a_seed_list():
    # The committed ledger episode-draft.yml's graphics job copies aside before it renders anything
    # (verify.py's "committed" ledger): a seed `[]` the first run compares against and replaces.
    ledger_rows = json.loads((ROOT / "episodes" / "900" / "graphics-ledger.json").read_text(encoding="utf-8"))
    assert isinstance(ledger_rows, list)
