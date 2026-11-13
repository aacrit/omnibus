# Net-new in omnibus (E3). Renders media, so it runs in studio-full, not the per-commit gate's fast subset.
"""An omnibus screenplay renders: a 30/1 master, the graphic kind (a full-frame graphic and a straight-alpha graphic
over a picture), the show's links in sources.json and description.txt, and the show's loudness target."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixture_news"))

import film as FILM  # noqa: E402

from studio.engine import render as R  # noqa: E402
from studio.news import profile as SHOW  # noqa: E402


@pytest.fixture(scope="module")
def news_render(tmp_path_factory):
    film = FILM.make(tmp_path_factory.mktemp("news") / "week-99")
    out = film.parent / "out"
    try:
        summary = R.render(film, out, height=720, workers=2, min_free_gb=1, encode_preset="veryfast", draft=True)
        yield {"summary": summary, "out": out, "film": film}
    finally:
        R.apply_show(SHOW.of({}))          # leave the process at document's targets for every later test


def frame_at(path: Path, t: float) -> np.ndarray:
    r = subprocess.run([R.ffmpeg(), "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, np.uint8).reshape(720, 1280, 3)


def test_the_master_is_30_fps_and_links_to_omnibus(news_render):
    src = json.loads((news_render["out"] / "sources.json").read_text(encoding="utf-8"))
    assert src["fps_rate"] == "30"
    assert src["show"]["sources_page"] == "https://omnibus.voidvision.org/e/99/sources"
    assert src["show"]["target_lufs"] == -16.0
    text = (news_render["out"] / "description.txt").read_text(encoding="utf-8")
    assert "https://omnibus.voidvision.org/e/99/sources" in text and "document.voidvision.org" not in text
    kinds = {s["id"]: s for s in src["shots"]}
    assert kinds["G-DAY1"]["graphic"]["subtype"] == "day" and kinds["G-DAY1"]["mark"]["class"] == "DRAWN"
    assert [g["id"] for g in src["graphics_over"]] == ["G-LT"]


def test_graphics_are_composited(news_render):
    master = news_render["out"] / "master.mp4"
    # the full-frame day graphic: opaque blue everywhere
    px = frame_at(master, 25.0)[200, 640].astype(int)
    assert abs(px[0] - 40) < 14 and abs(px[1] - 90) < 14 and abs(px[2] - 160) < 14
    # the lower third over the board: its band is opaque, the rest of it transparent (the board shows through)
    over = frame_at(master, 42.0).astype(int)
    band, above = over[int(780 * 720 / 1080), 640], over[int(300 * 720 / 1080), 640]
    assert np.abs(band - [200, 120, 40]).max() < 16                   # the lower third's own band
    assert np.abs(above - [40, 90, 160]).max() < 16                   # transparent there: the board shows through
    under = frame_at(master, 38.0).astype(int)                       # the board alone, before the lower third
    assert np.abs(under[int(780 * 720 / 1080), 640] - [40, 90, 160]).max() < 16
