"""Pixel compositing: turns one static, Chromium-typeset PNG into a
30 fps motion sequence per the bible's presets, using `motion.py`'s
frame-count and progress math. PIL/numpy only, no browser, no ffmpeg;
`studio/tests/test_graphics_compose.py` exercises it on tiny synthetic
images so the gate never opens a real screenshot.
"""

from __future__ import annotations

import io
import math

import numpy as np
from PIL import Image

from . import layout
from . import motion


def load_rgba(png_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png_bytes)).convert("RGBA")


def to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def blank_like(img: Image.Image) -> Image.Image:
    return Image.new("RGBA", img.size, (0, 0, 0, 0))


# ---- step: hold the typeset frame, never counts up ------------------------

def step_frames(static: Image.Image, hold_frames: int) -> list[Image.Image]:
    motion.step_frame_index(hold_frames)  # asserts hold_frames >= 1
    return [static.copy() for _ in range(hold_frames)]


# ---- wipe: hard-edge reveal from the left -------------------------------

def wipe_frames(static: Image.Image, *, duration_ms: float = 240, fps: int = motion.FPS) -> list[Image.Image]:
    n = motion.wipe_frame_count(duration_ms, fps)
    w, h = static.size
    frames = []
    for i in range(n):
        frac = motion.wipe_reveal_fraction(i, duration_ms=duration_ms, fps=fps)
        edge = round(w * frac)
        frame = blank_like(static)
        if edge > 0:
            frame.paste(static.crop((0, 0, edge, h)), (0, 0))
        frames.append(frame)
    return frames


# ---- flap: each row falls as a half-card, 180 ms, staggered 400 ms -----

def flap_frames(static: Image.Image, row_boxes: list[tuple[int, int, int, int]], *,
                 row_gap_ms: float = 400, fall_ms: float = 180, fps: int = motion.FPS) -> list[Image.Image]:
    """`row_boxes` are (x, y, width, height) rects, one per board row, top
    to bottom. Each row scales in vertically from its own hinge (mid-
    height) to full height, approximating the CSS `rotateX(-90deg) -> 0`
    fold; rows outside their own window stay hidden (progress 0) or
    settled (progress 1)."""
    timings = [motion.flap_row_timing(i, row_gap_ms=row_gap_ms, fall_ms=fall_ms, fps=fps) for i in range(len(row_boxes))]
    total = motion.flap_total_frames(len(row_boxes), row_gap_ms=row_gap_ms, fall_ms=fall_ms, fps=fps)
    frames = []
    for f in range(total):
        frame = blank_like(static)
        for (x, y, w, h), timing in zip(row_boxes, timings):
            progress = motion.flap_progress(f, timing)
            if progress <= 0:
                continue
            row_img = static.crop((x, y, x + w, y + h))
            if progress >= 1:
                frame.paste(row_img, (x, y), row_img)
                continue
            # Foreshorten vertically from the hinge (mid-height), the
            # split-flap's own fold: scale_y = sin(progress * 90deg).
            scale_y = max(1, round(h * math.sin(progress * math.pi / 2)))
            squashed = row_img.resize((w, scale_y))
            hinge_y = y + h // 2
            frame.paste(squashed, (x, hinge_y - scale_y // 2), squashed)
        frames.append(frame)
    return frames


# ---- sweep: the clock's second hand, constant angular velocity --------

def sweep_frames(dial: Image.Image, hand_layer: Image.Image, angles: list[float],
                  pivot: tuple[int, int]) -> list[Image.Image]:
    """`hand_layer` is the hands-only transparent layer at angle 0
    (rotate(0), i.e. pointing to 12); each frame pastes it back over the
    dial rotated to `angles[i]` degrees clockwise about `pivot`."""
    frames = []
    for angle in angles:
        rotated = hand_layer.rotate(-angle, center=pivot, resample=Image.BICUBIC)
        frame = dial.copy()
        frame.alpha_composite(rotated)
        frames.append(frame)
    return frames


# ---- credits roll: integer crop, 3 px a frame ---------------------------

def credits_roll_frames(strip: Image.Image, viewport_height: int, *, px_per_frame: int = 3) -> list[Image.Image]:
    w, full_h = strip.size
    offsets = motion.credits_crop_offsets(full_h, viewport_height, px_per_frame=px_per_frame)
    frames = []
    for y in offsets:
        frames.append(strip.crop((0, y, w, y + viewport_height)))
    return frames


# ---- typed-paper macro: a hard-edge reveal per row, at the strike rate -

def typed_paper_frames(full: Image.Image, rows: list[str], row_boxes: list[tuple[int, int, int, int]],
                        rate_cps: float, *, fps: int = motion.FPS) -> list[Image.Image]:
    """`row_boxes` align 1:1 with `rows` (both top to bottom). Earlier
    rows are fully shown once their own strike finishes; the current row
    reveals left to right, hard edge, at `rate_cps`; later rows are
    blank, the macro never "counting up" past where the platen is."""
    total = motion.typed_paper_frame_count(rows, rate_cps, fps=fps)
    frames = []
    for f in range(total):
        frame = blank_like(full)
        elapsed_frames = f
        for row, (x, y, w, h) in zip(rows, row_boxes):
            if not row:
                continue
            row_frames = max(1, math.ceil(len(row) / rate_cps * fps))
            if elapsed_frames >= row_frames:
                shown = len(row)
                elapsed_frames -= row_frames
            elif elapsed_frames < 0:
                shown = 0
            else:
                shown = layout.chars_shown_at_frame(len(row), elapsed_frames, rate_cps, fps)
                elapsed_frames = -1  # every row after the current one stays blank
            if shown <= 0:
                continue
            reveal_w = round(w * shown / len(row))
            frame.paste(full.crop((x, y, x + reveal_w, y + h)), (x, y))
        frames.append(frame)
    return frames
