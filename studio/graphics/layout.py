"""Pure geometry: the same math the G2 mocks' inline styles and SVG
coordinates encode, reverse-derived from ``design/mocks/broadcast/*.html``
and written down here as formulas instead of baked numbers, so the
generator can compute them for any week's data. Every function is pure
(no I/O); `studio/tests/test_graphics_layout.py` checks each one against
the literal pixel values already committed in the week-32 mocks.

Field-local coordinates: the 4:3 field is 1440 wide; title-safe inside it
runs x 144 to 1296 (frame.css). The seven rungs are far-left..far-right,
index 0..6.
"""

from __future__ import annotations

from dataclasses import dataclass

RUNGS = ("far-left", "left", "center-left", "center", "center-right", "right", "far-right")

TITLE_SAFE_LEFT = 144.0
TITLE_SAFE_WIDTH = 1152.0
FIELD_CENTER_X = 720.0


@dataclass(frozen=True)
class BarSegment:
    rung: str
    x: float
    width: float


def bar_segments(bars: list[int], *, band_x: float, band_width: float) -> list[BarSegment]:
    """Proportional, contiguous segments left to right in rung order. A
    zero-count rung draws nothing (width 0, and it is left out of the
    list the way the mocks never emit a `<rect>` for it): matches
    testcard-week.html's measured band (band_x=420, band_width=600) where
    width_i = band_width * count_i / total.
    """
    if len(bars) != 7:
        raise ValueError(f"bars must have 7 rungs, got {len(bars)}")
    total = sum(bars)
    segs: list[BarSegment] = []
    x = band_x
    if total <= 0:
        return segs
    for rung, count in zip(RUNGS, bars):
        if count <= 0:
            continue
        width = band_width * count / total
        segs.append(BarSegment(rung, round(x, 2), round(width, 2)))
        x += width
    return segs


@dataclass(frozen=True)
class KeyColumn:
    rung: str
    center_x: float


def key_columns(*, center_x: float = FIELD_CENTER_X, column_gap: float = 680.0 / 7) -> list[KeyColumn]:
    """Seven equal columns centred on the field, spaced ``680/7`` px apart
    (testcard-week.html's swatch centres: 428.6, 525.7, 622.9, 720.0,
    817.1, 914.3, 1011.4 - offsets -3..3 times 97.14 from the centre)."""
    return [KeyColumn(rung, round(center_x + (i - 3) * column_gap, 1)) for i, rung in enumerate(RUNGS)]


def rung_center_x(index: int, *, safe_width: float = TITLE_SAFE_WIDTH) -> float:
    """The ladder's rung centres, in the ladder SVG's own local
    coordinates (0..1152: the `<svg class="ladder-base" viewBox="0 0
    1152 16">` and the `.rows`/`.outlet` elements it lines up with all
    share this local space - the 144 px title-safe offset is a CSS
    `left:144px` on their shared container, never added into the
    numbers themselves). 7 rungs sit on the odd ticks of 15 ticks:
    step = safe_width / 14, rung i's local x = (2i+1) * step - confirmed
    against flap-board.html's own data-x values (411.4, 576.0, 740.6,
    1069.7 for center-left, center, center-right, far-right)."""
    if not 0 <= index <= 6:
        raise ValueError(f"rung index out of range: {index}")
    step = safe_width / 14
    return round((2 * index + 1) * step, 1)


def ladder_ticks(*, safe_width: float = TITLE_SAFE_WIDTH) -> list[float]:
    """15 ticks, evenly spaced, 0 to ``safe_width`` in the ladder's own
    local coordinates (flap-board.html's ladder-base: 0.0 .. 1152.0)."""
    step = safe_width / 14
    return [round(i * step, 1) for i in range(15)]


def flap_margin(rung_x: float, *, origin: float = 500.0, min_margin: float = 0.0, max_margin: float = 152.0) -> float:
    """A board row's card drifts with its rung: ``clamp(rungX - 500, 0, 152)``
    (spec 3.6), confirmed against flap-board.html's four rows (0, 76, 152, 152
    for center-left, center, center-right, far-right)."""
    return max(min_margin, min(max_margin, rung_x - origin))


@dataclass(frozen=True)
class OutletPlacement:
    rung: str
    x: float
    clamp: str  # "none", "left", "right"


def outlet_placement(rung: str, rung_x: float, name_width: float, *,
                      safe_width: float = TITLE_SAFE_WIDTH) -> OutletPlacement:
    """The outlet name centres on its rung's x (translateX(-50%)), then
    clamps inside the local 0..``safe_width`` box: clamp-r pins the
    name's right edge to the box's right edge (translateX(-100%)),
    clamp-l pins its left edge to the box's left edge (translateX(0),
    i.e. x = 0, per flap-board.html's `.outlet.clamp-l { transform:
    none; }`). ``rung_x`` is in the same local space as
    ``rung_center_x``."""
    half = name_width / 2
    if rung_x + half > safe_width:
        return OutletPlacement(rung, safe_width, "right")
    if rung_x - half < 0:
        return OutletPlacement(rung, 0.0, "left")
    return OutletPlacement(rung, rung_x, "none")


# ---- Clock -----------------------------------------------------------

def clock_hand_angles(hour: int, minute: int, second: int) -> dict[str, float]:
    """Degrees clockwise from 12 (the SVG hands point up at angle 0), per
    clock.html's rotate() values: hour 269.950, minute 359.400, second 324
    at 20:59:54."""
    h = hour % 12
    hour_angle = (h + minute / 60 + second / 3600) / 12 * 360
    minute_angle = (minute + second / 60) / 60 * 360
    second_angle = second / 60 * 360
    return {
        "hour": round(hour_angle, 3),
        "minute": round(minute_angle, 3),
        "second": round(second_angle, 3),
    }


def sweep_second_angles(start_second: int, fps: int = 30, seconds: float = 6.0) -> list[float]:
    """The second hand's constant angular velocity (6 deg/s) across the
    last ``seconds`` to airtime, one angle per frame."""
    n = round(seconds * fps)
    return [round(((start_second + i / fps) % 60) / 60 * 360, 3) for i in range(n + 1)]


# ---- Title typed-paper macro ------------------------------------------

def wrap_columns(line: str, columns: int = 69) -> list[str]:
    """Wrap one verbatim line at ``columns`` characters, breaking on
    whitespace (never mid-word), the paper's width (spec 3.2)."""
    words = line.split(" ")
    rows: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= columns:
            current = candidate
        else:
            if current:
                rows.append(current)
            current = word
    if current:
        rows.append(current)
    return rows or [""]


def wrapped_rows(lines: list[str], columns: int = 69) -> list[str]:
    rows: list[str] = []
    for line in lines:
        rows.extend(wrap_columns(line, columns))
    return rows


def strike_frame_counts(rows: list[str], rate_cps: float, fps: int = 30) -> list[int]:
    """How many frames each row's full text takes to strike at
    ``rate_cps`` characters a second, rounded up to a whole frame (each
    character lands on a frame boundary, never mid-frame)."""
    import math
    return [max(1, math.ceil(len(row) / rate_cps * fps)) for row in rows]


def chars_shown_at_frame(row_length: int, frame_index: int, rate_cps: float, fps: int = 30) -> int:
    """How many characters of a row are visible by ``frame_index`` (0-based,
    within that row's own strike window)."""
    shown = int((frame_index + 1) / fps * rate_cps)
    return max(0, min(row_length, shown))


# ---- Board pagination --------------------------------------------------

ROWS_PER_PAGE = 4


def paginate_rows(rows: list[dict]) -> list[list[dict]]:
    """Four rows a page (spec 3.6's ruled capacity); rungs stay in order."""
    pages = []
    for i in range(0, len(rows), ROWS_PER_PAGE):
        pages.append(rows[i:i + ROWS_PER_PAGE])
    return pages or [[]]
