# Net-new in omnibus (E3), generalised from document@b62c4fa:studio/engine/titles.py (the A40 series title: a
# pre-rendered master played as it is, at its own rate, conformed to the film's by frame drop or repeat).
"""The ``graphic`` kind: a pre-rendered DRAWN clip the engine plays as it is, with an optional straight alpha.

E6 typesets and animates every omnibus graphic (test cards, boards, day bars, the clock, count cards, maps, lower
thirds, the credits roll and the end board) into a clip on D:, recorded in the graphics ledger. The engine never
draws a graphic's content; it plays the clip's frames and composites them:

- a ``graphic`` **shot** fills the frame: its frames over the house ground (film black), marked DRAWN;
- a ``graphic`` **text element** (a part's ``text[]``, subtypes in OVERLAY_SUBTYPES: a lower third or a count over a
  picture) is composited over whatever shot is on screen, in the overlay pass (``render.draw_overlays``), so
  ``--layers`` carries it in ``overlay.mov`` with the same straight alpha.

A ledger item for a graphic states ``fps`` (24, 30000/1001 or 30), ``frames``, ``alpha`` (``"straight"`` or absent:
an opaque clip; premultiplied alpha is refused, since the overlay pass and loom both read alpha straight) and, as a
studio-made item, ``content_date`` with ``content_basis`` (the horizon of the data it draws, A0).

The decoders here run ffmpeg; the plan-time checks are in studio/news/schema.py.
"""

from __future__ import annotations

import subprocess
from fractions import Fraction

import numpy as np
from PIL import Image

from studio.engine import cadence as CAD

KIND = "graphic"
SUBTYPES = ("testcard", "board", "day", "clock", "count", "map", "lower_third", "credits", "end_board")
OVERLAY_SUBTYPES = ("lower_third", "count")       # drawn over a picture; every other subtype fills the frame
DATA_SUBTYPES = ("testcard", "board", "day", "clock", "count")   # each draws figures from the record: a data_ref
FIGURE_SUBTYPES = ("testcard", "day", "count")   # each declares the figures it draws (shows.figures), checked to the record
ALPHA_MODES = ("straight",)


def is_graphic(x: dict) -> bool:
    return isinstance(x, dict) and x.get("kind") == KIND


def rate_of(item: dict) -> Fraction | None:
    """The clip's own rate from its ledger item's ``fps``, or None when it states none the engine knows."""
    try:
        return CAD.parse_rate(item.get("fps"), CAD.ALL_MASTERS)
    except CAD.RateError:
        return None


def source_frame(t_local: float, film_fps: float, item: dict) -> int:
    """The clip's frame on screen ``t_local`` seconds into the graphic, when the film masters at ``film_fps``: the
    film's own frame there, conformed to the clip's rate (cadence.source_index), held on the clip's last frame past
    its end (GRAMMAR 7.1's hold; the plan lints how long)."""
    src = rate_of(item) or Fraction(film_fps).limit_denominator(1001)
    k = max(0, int(round(t_local * film_fps)))
    n = int(item.get("frames") or 0) or None
    return CAD.source_index(k, src, Fraction(film_fps).limit_denominator(100000), n)


class Reader:
    """The clip read in order from frame k0 as RGBA at the film's size (straight alpha; 255 where the clip has none)."""

    def __init__(self, ffmpeg: str, path: str, k0: int, W: int, H: int, fps: float):
        self.W, self.H, self.k, self.path = W, H, k0, path
        self.proc = subprocess.Popen(
            [ffmpeg, "-v", "error", "-ss", f"{k0 / fps:.6f}", "-i", str(path), "-map", "0:v:0", "-an",
             "-vf", f"scale={W}:{H}:flags=lanczos,format=rgba", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        self.last: np.ndarray | None = None

    def frame(self, k: int) -> np.ndarray:
        n = self.W * self.H * 4
        while self.k <= k:
            buf = self.proc.stdout.read(n)
            if len(buf) < n:
                if self.last is None:
                    raise ValueError(f"graphic {self.path}: no frame decoded at or after frame {k}")
                break                       # past the end: the last frame holds
            self.last = np.frombuffer(buf, np.uint8).reshape(self.H, self.W, 4)
            self.k += 1
        return self.last

    def close(self) -> None:
        try:
            self.proc.stdout.close()
            self.proc.kill()
            self.proc.wait(timeout=5)
        except Exception:
            pass


_READERS: dict[tuple, Reader] = {}     # one decoder per (clip, size) in this process, read forward


def frame(item: dict, t_local: float, film_fps: float, W: int, H: int, ffmpeg: str, key: str = "") -> np.ndarray:
    """The graphic's RGBA frame ``t_local`` seconds in (HxWx4 uint8, straight alpha)."""
    k = source_frame(t_local, film_fps, item)
    rk = (key, item["_path"], W, H)
    r = _READERS.get(rk)
    if r is None or k < r.k - 1:
        if r is not None:
            r.close()
        r = _READERS[rk] = Reader(ffmpeg, item["_path"], k, W, H, float(rate_of(item) or film_fps))
    return r.frame(k)


def over(rgba: np.ndarray, ground: np.ndarray | tuple) -> np.ndarray:
    """Straight-alpha ``rgba`` over ``ground`` (an HxWx3 array or an RGB colour), HxWx3 uint8."""
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    g = np.asarray(ground, dtype=np.float32)
    if g.ndim == 1:
        g = np.broadcast_to(g, rgba.shape[:2] + (3,))
    out = rgba[..., :3].astype(np.float32) * a + g * (1.0 - a)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def shot_picture(item: dict, t_local: float, film_fps: float, W: int, H: int, ffmpeg: str, ground_rgb) -> Image.Image:
    """A graphic shot's picture: its frame over the house ground."""
    return Image.fromarray(over(frame(item, t_local, film_fps, W, H, ffmpeg, key="shot"), ground_rgb), "RGB")


def draw_overlay(rgba: Image.Image, g: dict, t: float, film_fps: float, ffmpeg: str) -> Image.Image:
    """A graphic text element composited over the frame (RGBA in, RGBA out), ``t`` the film's time."""
    arr = frame(g["_item"], t - g["start"], film_fps, rgba.width, rgba.height, ffmpeg, key="overlay:" + g["id"])
    layer = Image.fromarray(np.ascontiguousarray(arr), "RGBA")
    out = rgba.copy()
    out.alpha_composite(layer)
    return out


def overlay_entry(t: dict, item: dict) -> dict:
    """A graphic text element as the plan carries it (picklable: workers draw it)."""
    return {"id": t["id"], "subtype": t.get("subtype"), "start": float(t["start_s"]), "end": float(t["end_s"]),
            "asset": t.get("asset"), "_item": {k: v for k, v in item.items()}}


def close_all() -> None:
    for r in _READERS.values():
        r.close()
    _READERS.clear()
