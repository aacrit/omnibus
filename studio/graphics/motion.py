"""Motion math at 30 fps for the bible's broadcast presets (spec 1.3):
flap, sweep, step, wipe, credits roll, and the title's typed-paper macro.

Every function here takes plain numbers (frame counts, pixel offsets,
crop windows) and is pure; the handful that also take a PIL Image do
nothing but composite/crop/paste pixels already typeset by Chromium
(`shoot.py`). No network, no subprocess, no browser: this module is the
"fast, no browser" half of the ticket, exercised by
`studio/tests/test_graphics_motion.py` on tiny synthetic fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass

FPS = 30


def ms_to_frames(ms: float, fps: int = FPS) -> int:
    return max(1, round(ms / 1000 * fps))


# ---- flap: rows fall as half-cards, 180 ms each, staggered 400 ms -----

@dataclass(frozen=True)
class FlapTiming:
    row_index: int
    start_frame: int   # first frame where this row has begun falling
    fall_frames: int    # how many frames its 180 ms fall takes
    end_frame: int       # first frame where the whole card is seated


def flap_row_timing(row_index: int, *, row_gap_ms: float = 400, fall_ms: float = 180, fps: int = FPS) -> FlapTiming:
    start = round(row_index * row_gap_ms / 1000 * fps)
    fall = ms_to_frames(fall_ms, fps)
    return FlapTiming(row_index, start, fall, start + fall)


def flap_progress(frame: int, timing: FlapTiming) -> float:
    """0.0 before the row starts falling, 1.0 once seated, linear
    in-between (the easing curve itself is cosmetic and applied when the
    frame is rendered; the progress fraction is what the caller needs to
    decide how many degrees of rotateX to apply)."""
    if frame <= timing.start_frame:
        return 0.0
    if frame >= timing.end_frame:
        return 1.0
    return (frame - timing.start_frame) / timing.fall_frames


FLAP_REBOUND = 0.97   # spec 1.3: settles on one 3% rebound


def flap_scale(frame: int, timing: FlapTiming) -> float:
    """The card's projected height as a fraction of its full height (the
    CSS fold is ``rotateX(-90deg) -> 0`` about the card's top edge, so the
    projected height is ``sin(angle)``). The fall accelerates into the
    stop (gravity: progress squared), then one frame rebounds 3% before
    the card sits flat. 0 before it starts, 1 once seated."""
    import math
    if frame <= timing.start_frame:
        return 0.0
    if frame < timing.end_frame:
        p = (frame - timing.start_frame) / timing.fall_frames
        return math.sin(p * p * math.pi / 2)
    if frame == timing.end_frame + 1:
        return FLAP_REBOUND
    return 1.0


def flap_total_frames(n_rows: int, *, row_gap_ms: float = 400, fall_ms: float = 180, fps: int = FPS) -> int:
    """One more than the last row's own ``end_frame`` so the sequence
    includes a frame where every row has actually settled (``end_frame``
    itself is the first frame *at* full progress, per `flap_progress`)."""
    if n_rows <= 0:
        return 0
    last = flap_row_timing(n_rows - 1, row_gap_ms=row_gap_ms, fall_ms=fall_ms, fps=fps)
    return last.end_frame + 3   # landing frame, its one rebound frame, then seated


# ---- wipe: hard-edge reveal from the left, 240 ms -----------------------

def wipe_reveal_fraction(frame: int, *, duration_ms: float = 240, fps: int = FPS) -> float:
    """Fraction (0..1) of the lower third revealed by ``frame`` (0-based):
    linear, hard edge (no feather), clamped to [0, 1]."""
    total = ms_to_frames(duration_ms, fps)
    return max(0.0, min(1.0, (frame + 1) / total))


def wipe_frame_count(duration_ms: float = 240, fps: int = FPS) -> int:
    return ms_to_frames(duration_ms, fps)


# ---- step: a numeral lands whole on one frame, never counts up ---------

def step_frame_index(hold_frames: int) -> int:
    """`step` draws the final value from frame 0 through the whole hold:
    there is exactly one visible state, so the caller just repeats frame
    0's render ``hold_frames`` times. Kept as a function (not a constant)
    so a test can assert the semantic: it is always 0, regardless of
    hold length."""
    if hold_frames < 1:
        raise ValueError("a step graphic must hold at least one frame")
    return 0


# ---- sweep: constant angular velocity (the clock's second hand) --------

def sweep_angle(elapsed_s: float, *, degrees_per_second: float = 6.0) -> float:
    return (elapsed_s * degrees_per_second) % 360


# ---- credits roll: an integer crop, 3 px a frame ------------------------

def credits_crop_offsets(strip_height: int, viewport_height: int, *, px_per_frame: int = 3) -> list[int]:
    """The y-offset (top of the viewport window inside the tall strip) for
    each frame, 3 px higher than the last, stopping once the strip's last
    pixel has scrolled through. Integer only (no sub-pixel blur, so the
    roll "stays sharp" per spec 3.11)."""
    if strip_height < viewport_height:
        return [0]
    last = strip_height - viewport_height
    offsets = list(range(0, last + 1, px_per_frame))
    if offsets[-1] != last:
        offsets.append(last)
    return offsets


# ---- typed-paper macro: characters appear at the strike rate -----------

def typed_paper_frame_count(rows: list[str], rate_cps: float, *, row_gap_frames: int = 0, fps: int = FPS) -> int:
    """Total frames for every row to finish striking, rows typed one after
    another (each row starts once the previous row's text is complete)."""
    import math
    total = 0
    for row in rows:
        total += max(1, math.ceil(len(row) / rate_cps * fps)) + row_gap_frames
    return max(1, total)
