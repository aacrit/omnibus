"""E6: frame sheets (studio/graphics/framesheet.py) show transparency as
checker, never as black."""

from __future__ import annotations

import numpy as np
from PIL import Image

from studio.graphics import framesheet


def test_transparent_frame_reads_as_checker():
    clear = Image.new("RGBA", (96, 48), (0, 0, 0, 0))
    out = np.asarray(framesheet.over_checker(clear))
    assert out.min() >= 150                    # no black anywhere
    assert len({tuple(p) for p in out.reshape(-1, 3)}) == 2


def test_opaque_frame_covers_the_checker():
    solid = Image.new("RGBA", (48, 48), (10, 20, 30, 255))
    assert {tuple(p) for p in np.asarray(framesheet.over_checker(solid)).reshape(-1, 3)} == {(10, 20, 30)}


def test_sheet_lays_out_three_frames_per_layer():
    f = Image.new("RGBA", (192, 108), (255, 0, 0, 128))
    img = framesheet.sheet([("a", [("first", f), ("middle", f), ("last", f)]), ("b", [("first", f)] * 3)],
                           thumb=(96, 54))
    assert img.size == (3 * 96 + 4 * 8, 2 * (54 + 44 + 8) + 8)
