"""The test card's static SVG skeleton (castellated border, fine grid,
hairline frame, centre disc) and the clock dial's 60 ticks, rebuilt from
geometry instead of copied from the mock, so the same code draws it for
any week. Reverse-derived from `design/mocks/broadcast/testcard-week.html`
and `clock.html`'s own coordinates; `studio/tests/test_graphics_svgparts.py`
checks the formulas against those literal, committed numbers. Pure string
building: no I/O, no browser.
"""

from __future__ import annotations

import math


def castellation_rects(class_a: str, class_b: str) -> str:
    """84 blocks (24 top, 24 bottom, 18 left, 18 right), 60x30 (top/bottom)
    or 30x60 (left/right), alternating `class_a`/`class_b` with top/bottom
    and left/right inverted at the same position."""
    out = []
    for i, x in enumerate(range(0, 1440, 60)):
        top = class_a if i % 2 == 0 else class_b
        bot = class_b if i % 2 == 0 else class_a
        out.append(f'<rect class="{top}" x="{x}" y="0" width="60" height="30"/>')
        out.append(f'<rect class="{bot}" x="{x}" y="1050" width="60" height="30"/>')
    for i, y in enumerate(range(0, 1080, 60)):
        left = class_a if i % 2 == 0 else class_b
        right = class_b if i % 2 == 0 else class_a
        out.append(f'<rect class="{left}" x="0" y="{y}" width="30" height="60"/>')
        out.append(f'<rect class="{right}" x="1410" y="{y}" width="30" height="60"/>')
    return "".join(out)


def grid_path() -> str:
    """1 px hairlines every 60 px inside the castellated border (23
    vertical, 17 horizontal)."""
    v = "".join(f"M{x} 30V1050" for x in range(60, 1440, 60))
    h = "".join(f"M30 {y}H1410" for y in range(60, 1080, 60))
    return v + h


def frame_rect() -> str:
    return '<rect class="tc-frame" x="30" y="30" width="1380" height="1020"/>'


def centre_disc() -> str:
    return '<circle class="tc-disc" cx="720" cy="540" r="390"/>'


def staircase_rects() -> str:
    """The 6-step texture band, x 144..1296, y 960, 192 px a step."""
    return "".join(
        f'<rect class="s{i + 1}" x="{144 + i * 192}" y="960" width="192" height="12"/>' for i in range(6)
    )


# ---- clock dial ----------------------------------------------------------

_TICK_CATEGORY = {
    "quarter": (70.0, 92.0, 7.0),
    "hour": (74.0, 92.0, 4.5),
    "minute": (86.0, 92.0, 1.4),
}


def _tick_category(minute: int) -> str:
    if minute % 15 == 0:
        return "quarter"
    if minute % 5 == 0:
        return "hour"
    return "minute"


def clock_ticks() -> list[dict]:
    """60 ticks, one every 6 degrees clockwise from 12, categorised by
    position (quarter/hour/minute) with each category's own inner radius
    and stroke width; all share the dial's outer radius (92, inside the
    r=97 dial)."""
    ticks = []
    for m in range(60):
        angle = math.radians(m * 6)
        cat = _tick_category(m)
        inner, outer, width = _TICK_CATEGORY[cat]
        ticks.append({
            "minute": m,
            "category": cat,
            "x1": round(inner * math.sin(angle), 2),
            "y1": round(-inner * math.cos(angle), 2),
            "x2": round(outer * math.sin(angle), 2),
            "y2": round(-outer * math.cos(angle), 2),
            "width": width,
        })
    return ticks


def clock_ticks_svg() -> str:
    out = []
    for t in clock_ticks():
        out.append(
            f'<line class="tick" stroke-width="{t["width"]}" '
            f'x1="{t["x1"]:.2f}" y1="{t["y1"]:.2f}" x2="{t["x2"]:.2f}" y2="{t["y2"]:.2f}"/>'
        )
    return "".join(out)
