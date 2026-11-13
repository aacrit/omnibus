# Net-new in omnibus (C7 of the footage capture).
"""capture-fit-confirmed: a picture the capture pool matched to its beat automatically (``fit.auto``, ``fit.why``
starting "auto:", scripts/capture/pool.mjs) reaches a final render only once a session has confirmed it
(``fit.confirmed_by`` set and ``fit.why`` replaced). Pure: the render's lint reads capture_fit_unconfirmed."""

from __future__ import annotations

from studio.engine import render as R

AUTO = {"beat": "week-day-6", "why": "auto: scored 4 against day-6 (stephen miller, miller)", "auto": True}


def _play(*assets: str) -> dict:
    return {"parts": [{"id": "the-week", "shots": [{"id": f"S{i}", "asset": a} for i, a in enumerate(assets)],
                       "lines": [{"id": "L1", "clip": assets[0]}] if assets else []}]}


def test_an_unconfirmed_automatic_fit_is_named_for_every_shot_and_line_that_cites_it():
    assets = {"A": {"fit": dict(AUTO)}, "B": {"fit": {"beat": "week-day-6", "why": "the named chief of staff"}}}
    found = R.capture_fit_unconfirmed(_play("A", "B"), assets)
    assert [(f["unit"], f["where"], f["asset"]) for f in found] == [("S0", "shot", "A"), ("L1", "line", "A")]
    assert "confirmed_by" in found[0]["why"]


def test_confirmed_needs_both_a_confirmer_and_a_replaced_why():
    assert R.capture_fit_why({"fit": dict(AUTO, confirmed_by="CoS session, 2026-11-16")}) == \
        "an automatic fit whose why was never replaced"
    ok = dict(AUTO, why="Miller at the podium, 0 to 33 s", confirmed_by="CoS session, 2026-11-16")
    assert R.capture_fit_why({"fit": ok}) is None
    assert R.capture_fit_why({"fit": {"beat": "x", "why": "auto: but a hand fit"}}) is None   # only fit.auto is judged
    assert R.capture_fit_why(None) is None and R.capture_fit_why({}) is None


def test_the_marker_matches_the_pool():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "scripts" / "capture" / "pool.mjs").read_text(encoding="utf-8")
    assert f'export const AUTO_WHY = "{R.CAPTURE_AUTO_WHY}";' in src
