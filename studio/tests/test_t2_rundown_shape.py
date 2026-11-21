# Net-new in omnibus (show bible v2, ticket 2).
"""``shape-from-rundown`` (studio/news/rundown_shape.py): a part's shape is its rundown story's. Pure, < 1 s."""

from __future__ import annotations

import copy

from studio.news import rundown_shape as RS


def rundown() -> dict:
    def story(key, slot, shape, secs):
        return {"key": key, "slot": slot, "shape": shape, "footage_cleared_s": secs}
    return {"schema": "omnibus.rundown/2", "stories": [
        story("council", "lead", "full", 41.0),
        story("contract", "package_2", "document", 0.0),
        story("wards", "package_3", "full", 30.0),
        story("bridge", "brief_1", "brief", 4.0)]}


def play() -> dict:
    return {"parts": [
        {"id": "p-clock", "segment": "clock"},
        {"id": "p-lead", "segment": "lead", "shape": "full"},
        {"id": "p-pkg-2", "segment": "package", "shape": "document"},
        {"id": "p-pkg-3", "segment": "package"},                   # no shape: read as full
        {"id": "p-briefs", "segment": "briefs"}]}


def failing(play_, rundown_):
    res = RS.shape_checks(play_, {"rundown": rundown_})
    assert all(c["rule"] == RS.RULE and c["severity"] == "block" for c in res)
    return [c["unit"] for c in res if not c["ok"]]


def test_the_pass_case_checks_every_shaped_part():
    res = RS.shape_checks(play(), {"rundown": rundown()})
    assert [c["unit"] for c in res] == ["part p-lead", "part p-pkg-2", "part p-pkg-3"]
    assert all(c["ok"] for c in res)
    assert res[1]["evidence"]["slot"] == "package_2" and res[1]["evidence"]["story"] == "contract"


def test_a_full_package_for_a_document_story_blocks():
    p = play()
    p["parts"][2]["shape"] = "full"
    assert failing(p, rundown()) == ["part p-pkg-2"]


def test_a_missing_shape_is_full_so_a_document_story_needs_it_stated():
    p = play()
    del p["parts"][2]["shape"]
    assert failing(p, rundown()) == ["part p-pkg-2"]


def test_a_document_part_for_a_full_story_blocks():
    p = play()
    p["parts"][1]["shape"] = "document"
    fails = RS.shape_checks(p, {"rundown": rundown()})
    bad = [c for c in fails if not c["ok"]]
    assert [c["unit"] for c in bad] == ["part p-lead"]
    assert "change the ledger" in bad[0]["evidence"]["fix"]


def test_a_package_part_past_the_rundowns_packages_blocks():
    p = play()
    p["parts"].insert(4, {"id": "p-pkg-4", "segment": "package", "shape": "full"})
    assert failing(p, rundown()) == ["part p-pkg-4"]


def test_the_rundowns_slot_follows_screenplay_order_not_part_ids():
    r = rundown()
    r["stories"][1]["shape"], r["stories"][2]["shape"] = "full", "document"
    p = play()
    p["parts"][2]["shape"], p["parts"][3]["shape"] = "full", "document"
    assert failing(p, r) == []
    p["parts"][2], p["parts"][3] = p["parts"][3], p["parts"][2]
    assert failing(p, r) == ["part p-pkg-3", "part p-pkg-2"]


def test_a_v1_rundown_or_none_is_not_checked():
    assert RS.shape_checks(play(), {"rundown": {"schema": "omnibus.rundown/1", "parts": []}}) == []
    assert RS.shape_checks(play(), {"rundown": None}) == []
    assert RS.shape_checks(play(), {}) == []


def test_a_v2_rundown_with_no_shaped_part_passes_once():
    p = {"parts": [{"id": "p-clock", "segment": "clock"}]}
    res = RS.shape_checks(p, {"rundown": copy.deepcopy(rundown())})
    assert len(res) == 1 and res[0]["ok"] and res[0]["evidence"] == {"checked": 0}
