"""Pixel compositing: turns static, Chromium-typeset PNGs into a 30 fps
motion sequence per the bible's presets, using `motion.py`'s and
`layout.py`'s timing math. PIL/numpy only, no browser, no ffmpeg;
`studio/tests/test_graphics_compose.py` exercises it on tiny synthetic
images so the gate never opens a real screenshot.

Every preset is a generator: frames stream to the encoder one at a time
and a long sequence (the credits roll is about a thousand 1080p frames)
is never held in memory.
"""

from __future__ import annotations

import io
import math
from typing import Iterator

from PIL import Image

from . import layout
from . import motion

Box = tuple[int, int, int, int]   # x, y, width, height in frame pixels


def load_rgba(png_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png_bytes)).convert("RGBA")


def to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def blank_like(img: Image.Image) -> Image.Image:
    return Image.new("RGBA", img.size, (0, 0, 0, 0))


def _crop(img: Image.Image, box: Box) -> Image.Image:
    x, y, w, h = box
    return img.crop((x, y, x + w, y + h))


# ---- step: hold the typeset frame, never counts up ------------------------

def step_frames(static: Image.Image, hold_frames: int) -> Iterator[Image.Image]:
    motion.step_frame_index(hold_frames)  # asserts hold_frames >= 1
    for _ in range(hold_frames):
        yield static


# ---- wipe: hard-edge reveal from the left, across the lower third ------

def wipe_frames(static: Image.Image, box: Box, *, duration_ms: float = 240,
                fps: int = motion.FPS) -> Iterator[Image.Image]:
    """The edge travels across `box` (the lower third's own bounding box,
    dot label included), left to right, linear, hard edge; pixels right of
    the edge are transparent. The last wipe frame shows the whole box."""
    x0, _, w, _ = box
    n = motion.wipe_frame_count(duration_ms, fps)
    for i in range(n):
        edge = x0 + round(w * motion.wipe_reveal_fraction(i, duration_ms=duration_ms, fps=fps))
        frame = blank_like(static)
        if edge > 0:
            frame.paste(static.crop((0, 0, edge, static.height)), (0, 0))
        yield frame


# ---- flap: each row falls as a half card, 180 ms, rows 400 ms apart ----

def flap_frames(base: Image.Image, full: Image.Image, rows: list[tuple[Box, Box]], *, hold_frames: int,
                row_gap_ms: float = 400, fall_ms: float = 180, fps: int = motion.FPS) -> Iterator[Image.Image]:
    """`base` is the page without its rows (head, ladder, rung labels and
    any untitled rung); `full` the same page with every row typeset.
    `rows` gives, per board row, the flap card's box and the outlet
    name's box (both measured from the page's own `.brow` elements). Each
    card falls from its top edge (`rotateX(-90deg) -> 0`, projected
    height `motion.flap_scale`), the outlet name cuts in as its card
    seats, and the seated page then holds `hold_frames`."""
    timings = [motion.flap_row_timing(i, row_gap_ms=row_gap_ms, fall_ms=fall_ms, fps=fps) for i in range(len(rows))]
    total = motion.flap_total_frames(len(rows), row_gap_ms=row_gap_ms, fall_ms=fall_ms, fps=fps)
    cards = [(_crop(full, card), card, _crop(full, outlet), outlet) for card, outlet in rows]
    frame = base.copy()
    for f in range(total):
        frame = base.copy()
        for (card_img, (x, y, w, h), outlet_img, outlet_box), timing in zip(cards, timings):
            scale = motion.flap_scale(f, timing)
            if scale <= 0:
                continue
            if scale >= 1:
                frame.alpha_composite(card_img, (x, y))
            else:
                squashed = card_img.resize((w, max(1, round(h * scale))))
                frame.alpha_composite(squashed, (x, y))
            if f >= timing.end_frame:
                frame.alpha_composite(outlet_img, (outlet_box[0], outlet_box[1]))
        yield frame
    for _ in range(hold_frames):
        yield frame


# ---- sweep: the clock's hands, constant angular velocity ---------------

def rotate_layer(layer: Image.Image, angle: float, pivot: tuple[int, int]) -> Image.Image:
    """`layer` is a transparent hand typeset at rotate(0) (pointing to 12);
    returns it turned `angle` degrees clockwise about `pivot`. Rotated in
    premultiplied alpha, so a hand's antialiased edge never picks up a
    dark fringe from its transparent neighbours."""
    if angle % 360 == 0:
        return layer
    return layer.convert("RGBa").rotate(-angle, center=pivot, resample=Image.BICUBIC).convert("RGBA")


def clock_dial_frames(base: Image.Image, hour: Image.Image, minute: Image.Image, angles: list[dict[str, float]],
                      pivot: tuple[int, int]) -> Iterator[Image.Image]:
    """The dial layer: frame, field, dial, ticks, wordmark and date, with
    the hour and minute hands turned to each frame's time."""
    for a in angles:
        frame = base.copy()
        frame.alpha_composite(rotate_layer(hour, a["hour"], pivot))
        frame.alpha_composite(rotate_layer(minute, a["minute"], pivot))
        yield frame


def second_hand_frames(hand: Image.Image, angles: list[float], pivot: tuple[int, int]) -> Iterator[Image.Image]:
    """The separate, transparent second-hand layer (hub included, over the
    hand), turned to `angles[i]` on frame i."""
    for angle in angles:
        yield rotate_layer(hand, angle, pivot)


# ---- credits roll: integer crop, 3 px a frame ---------------------------

def credits_roll_frames(strip: Image.Image, viewport_height: int, *, px_per_frame: int = 3) -> Iterator[Image.Image]:
    w, full_h = strip.size
    for y in motion.credits_crop_offsets(full_h, viewport_height, px_per_frame=px_per_frame):
        yield strip.crop((0, y, w, y + viewport_height))


# ---- typed-paper macro: a character at a time, at the strike rate -----

def typed_paper_frames(full: Image.Image, rows: list[str], row_boxes: list[Box], advances: list[list[float]],
                        rate_cps: float, *, total_s: float, platen_s: float = 0.060,
                        fps: int = motion.FPS) -> Iterator[Image.Image]:
    """`full` is the paper with every row struck. Row i's characters land
    one by one at `rate_cps`, rows in turn with a `platen_s` step between
    them (`layout.typed_chars_at`); `advances[i][k]` is the measured right
    edge (frame x) of row i's character k, so the revealed width is the
    glyphs actually struck, never an estimate. Unstruck paper is the
    paper's own ground (sampled from `full`), so the whole frame stays
    paper. Runs `total_s` (the declared print window)."""
    if len(rows) != len(row_boxes) or len(rows) != len(advances):
        raise ValueError("rows, row_boxes and advances must align")
    for row, adv in zip(rows, advances):
        if len(adv) != len(row):
            raise ValueError(f"row {row!r} has {len(row)} characters but {len(adv)} measured advances")
    end_s = layout.typed_strike_end_s(rows, rate_cps, platen_s=platen_s)
    if end_s > total_s + 1e-9:
        raise ValueError(f"the strikes end at {end_s:.2f} s, after the {total_s} s window")
    ground = Image.new("RGBA", full.size, full.getpixel((2, 2)))
    n = max(1, math.ceil(round(total_s * fps, 6)))
    for f in range(n):
        shown = layout.typed_chars_at(rows, rate_cps, f / fps, platen_s=platen_s)
        frame = ground.copy()
        for k, (x, y, w, h), adv in zip(shown, row_boxes, advances):
            if k <= 0:
                continue
            right = round(adv[k - 1])
            if right > x:
                frame.paste(full.crop((x, y, right, y + h)), (x, y))
        yield frame
