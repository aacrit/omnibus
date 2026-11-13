# Net-new in omnibus (C8): the engine's media roots by environment, and the CI studio-items plan.
from __future__ import annotations

import json
from pathlib import Path

from studio.engine import mediaroot as MR
from studio.news import studio_items as SI

ROOT = Path(__file__).resolve().parents[2]
ON = {"OMNIBUS_MEDIA_ROOT": "/mnt/omnibus-media"}


def test_unset_changes_nothing():
    assert MR.roots({}) is None
    assert MR.remap("D:/omnibus-media/33/graphics", {}) == "D:/omnibus-media/33/graphics"
    doc = {"a": ["D:/omnibus-media/x.wav", 3]}
    assert MR.remap_tree(doc, {}) is doc


def test_remaps_under_the_laptop_root_only():
    assert MR.remap("D:/omnibus-media/33/media/33", ON) == "/mnt/omnibus-media/33/media/33"
    assert MR.remap("D:\\omnibus-media\\33\\graphics\\clock.mov", ON) == "/mnt/omnibus-media/33/graphics/clock.mov"
    assert MR.remap("d:/OMNIBUS-MEDIA/33", ON) == "/mnt/omnibus-media/33"
    assert MR.remap("D:/omnibus-media", ON) == "/mnt/omnibus-media"
    assert MR.remap("D:/omnibus-media-old/33", ON) == "D:/omnibus-media-old/33"      # a sibling root never moves
    assert MR.remap("D:/document-media/33", ON) == "D:/document-media/33"
    assert MR.remap("audio/L-CO-1.wav", ON) == "audio/L-CO-1.wav"
    assert MR.remap("CC BY-SA 4.0", ON) == "CC BY-SA 4.0"
    assert MR.remap(12, ON) == 12


def test_the_replaced_root_is_configurable():
    env = {"OMNIBUS_MEDIA_ROOT": "/w/m/", "OMNIBUS_MEDIA_ROOT_FROM": "E:\\media"}
    assert MR.remap("E:/media/33/x.png", env) == "/w/m/33/x.png"
    assert MR.remap("D:/omnibus-media/33/x.png", env) == "D:/omnibus-media/33/x.png"


def test_tree_remaps_values_not_keys_and_leaves_the_input():
    doc = {"D:/omnibus-media/k": "D:/omnibus-media/v", "n": [{"wav": "D:/omnibus-media/33/score/theme.wav"}]}
    out = MR.remap_tree(doc, ON)
    assert out == {"D:/omnibus-media/k": "/mnt/omnibus-media/v", "n": [{"wav": "/mnt/omnibus-media/33/score/theme.wav"}]}
    assert doc["n"][0]["wav"] == "D:/omnibus-media/33/score/theme.wav"


def test_week_33_screenplay_reads_every_media_root_under_the_runner_root():
    play = json.loads((ROOT / "episodes/33/screenplay.json").read_text(encoding="utf-8"))
    out = json.dumps(MR.remap_tree(play, ON))
    assert "omnibus-media" in json.dumps(play) and "D:/omnibus-media" not in out
    assert MR.remap_tree(play, ON)["ledgers"]["graphics"]["media"] == "/mnt/omnibus-media/33/graphics"


def test_week_33_studio_items_each_have_a_recipe_or_a_stated_reason():
    plan = SI.plan(ROOT / "episodes/33", env=ON)
    by = {p["id"]: p for p in plan}
    assert by["e33-echo-pg-truman-19510614"]["recipe"] == "pages"
    assert by["e33-echo-fr-p16"]["recipe"] == "pdf-page"
    assert by["e33-echo-fr-p16"]["page"] == 16 and by["e33-echo-fr-p16"]["dpi"] == 300
    assert by["e33-echo-fr-p16"]["source"].endswith("/mnt/omnibus-media/33/media/33/e33-echo-req-13.pdf")
    assert by["board-all"]["recipe"] == "concat"
    assert [Path(s).name for s in by["board-all"]["sources"]] == ["board-page-1.mov", "board-page-2.mov"]
    assert by["title-macro-f0"]["recipe"] == "first-frame"
    for i in (1, 2, 3):   # the score is made on the laptop (E8): never synthesised here, only reported
        assert by[f"echo-bed-150.{i}"]["recipe"] is None and "laptop" in by[f"echo-bed-150.{i}"]["why"]
    assert all(p["out"].startswith("/mnt/omnibus-media/33/studio/") for p in plan)


def test_graphics_verify_reads_the_release_and_blocks_content_drift_only():
    from studio.graphics import verify as GV
    committed = json.loads((ROOT / "episodes/33/graphics-ledger.json").read_text(encoding="utf-8"))
    assert GV.release_args(committed) == ["--release", "2026-11-16T21:00:00Z", "--release-nominal"]
    same = GV.compare(committed, committed)
    assert same["all_match"] and same["ok"]

    def edit(gid, **kw):
        return [dict(r, **kw) if r["id"] == gid else r for r in committed]

    bytes_only = GV.compare(committed, edit("clock-dial", output_sha256="0" * 64))
    assert bytes_only["ok"] and not bytes_only["all_match"]
    lt = next(r for r in committed if r["id"] == "lt-echo-x6")
    near = GV.compare(committed, edit("lt-echo-x6", wipe_box=[lt["wipe_box"][0], lt["wipe_box"][1], lt["wipe_box"][2] - 6, lt["wipe_box"][3]]))
    row = next(r for r in near["rows"] if r["id"] == "lt-echo-x6")
    assert near["ok"] and row["geometry"]["wipe_box"]["max_delta_px"] == 6 and near["tolerance_px"] == GV.GEOMETRY_TOLERANCE_PX
    far = GV.compare(committed, edit("lt-echo-x6", wipe_box=[lt["wipe_box"][0], lt["wipe_box"][1], lt["wipe_box"][2] - 40, lt["wipe_box"][3]]))
    assert not far["ok"]
    for kw in ({"frames": 1}, {"source_template_sha256": "1" * 64}):
        assert not GV.compare(committed, edit("credits", **kw))["ok"]
    assert not GV.compare(committed, committed[1:])["ok"]                     # only-committed
    assert not GV.compare(committed[1:], committed)["ok"]                     # only-fresh
    assert GV.main(["compare", str(ROOT / "episodes/33/graphics-ledger.json"), str(ROOT / "episodes/33/graphics-ledger.json")]) == 0


def test_the_committed_credits_row_is_the_browser_free_template_build():
    from studio.graphics import data as GD, ledger as GL, typeset as TY
    from studio.graphics.render import PLACEHOLDERS
    ep = ROOT / "episodes/33"
    load = lambda p: json.loads(p.read_text(encoding="utf-8"))  # noqa: E731
    spec = GD.credits_spec(load(ep / "rundown.json"), load(ep / "rights-ledger.json"), load(ROOT / "data/week-33.json"))
    row = next(r for r in load(ep / "graphics-ledger.json") if r["id"] == "credits")
    assert row["lines"] == len(spec.lines)
    assert row["source_template_sha256"] == GL.sha256_text(TY.credits_html(spec, **PLACEHOLDERS))
