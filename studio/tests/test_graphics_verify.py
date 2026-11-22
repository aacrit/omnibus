"""studio.graphics.verify: release_args (the --release flags a committed ledger implies) and compare (row by
row against a fresh ledger)."""

from __future__ import annotations

import pytest

from studio.graphics import verify


def test_release_args_from_one_clock_row():
    rows = [{"id": "clock-dial", "release": "2026-11-16T21:00:00Z", "release_nominal": False},
            {"id": "clock-second-hand", "release": "2026-11-16T21:00:00Z", "release_nominal": False},
            {"id": "bumper-briefs", "subtype": "bumper"}]
    assert verify.release_args(rows) == ["--release", "2026-11-16T21:00:00Z"]


def test_release_args_nominal():
    rows = [{"id": "clock-dial", "release": "2026-11-16T21:00:00Z", "release_nominal": True}]
    assert verify.release_args(rows) == ["--release", "2026-11-16T21:00:00Z", "--release-nominal"]


def test_release_args_empty_for_a_ledger_with_no_clock_row():
    # A v2 graphics-only episode (ticket 4's fixture): render_episode draws no clock, so the ledger carries no
    # release-bearing row at all. That is not ambiguous (0 releases, not 2); no --release flag is needed.
    rows = [{"id": "bumper-briefs", "subtype": "bumper"}, {"id": "locator-1", "subtype": "locator"}]
    assert verify.release_args(rows) == []


def test_release_args_raises_on_two_distinct_releases():
    rows = [{"id": "a", "release": "2026-11-16T21:00:00Z"}, {"id": "b", "release": "2026-11-23T21:00:00Z"}]
    with pytest.raises(ValueError):
        verify.release_args(rows)


def test_compare_matches_identical_ledgers():
    committed = [{"id": "a", "output_sha256": "x", "frames": 10, "source_template_sha256": "s"}]
    res = verify.compare(committed, committed)
    assert res["ok"] and res["all_match"]


def test_compare_flags_a_row_only_the_fresh_ledger_has():
    committed = [{"id": "a", "output_sha256": "x"}]
    fresh = [{"id": "a", "output_sha256": "x"}, {"id": "b", "output_sha256": "y"}]
    res = verify.compare(committed, fresh)
    assert not res["ok"]
    row = next(r for r in res["rows"] if r["id"] == "b")
    assert row["outcome"] == "only-fresh" and row["blocking"]


def test_compare_blocks_on_a_frame_count_change():
    committed = [{"id": "a", "output_sha256": "x", "frames": 10}]
    fresh = [{"id": "a", "output_sha256": "x", "frames": 11}]
    res = verify.compare(committed, fresh)
    assert not res["ok"]
    assert res["rows"][0]["blocking"]


def test_compare_tolerates_a_small_geometry_shift():
    committed = [{"id": "a", "output_sha256": "x", "wipe_box": [100, 200, 300, 40]}]
    fresh = [{"id": "a", "output_sha256": "x", "wipe_box": [102, 200, 300, 40]}]
    res = verify.compare(committed, fresh)
    assert res["ok"] and not res["rows"][0]["blocking"]


def test_compare_blocks_on_a_large_geometry_shift():
    committed = [{"id": "a", "output_sha256": "x", "wipe_box": [100, 200, 300, 40]}]
    fresh = [{"id": "a", "output_sha256": "x", "wipe_box": [200, 200, 300, 40]}]
    res = verify.compare(committed, fresh)
    assert not res["ok"] and res["rows"][0]["blocking"]
