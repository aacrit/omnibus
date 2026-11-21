# Net-new in omnibus (C8 review): dot-label contrast.
"""A lower third's dot label is a disclosure (COMPUTER VOICE says the voice is synthetic), so it must stay readable
over whatever picture it lands on. The label is judged the way the frame sheet shows it: over a bright plate and
a dark plate, taking the worse of the two. Its text colour and its own plate (a background, possibly translucent)
are composited over each backdrop, and WCAG 2's contrast ratio between text and what is behind it must be at least
4.5:1 (AA, normal text) on both.

Colours come as the browser computes them (``getComputedStyle``): ``rgb()``/``rgba()`` or ``oklab()`` (what
Chromium reports for a relative ``oklab(from ...)`` colour). Pure; no I/O.
"""
from __future__ import annotations

import re

AA = 4.5
#: The frame sheet's two plates (studio/graphics/framesheet.py), the extremes a lower third can land on.
PLATES = {"bright": (245, 245, 245), "dark": (12, 12, 12)}

_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%?"


def _f(tok: str, scale: float = 1.0) -> float:
    return float(tok[:-1]) / 100 * scale if tok.endswith("%") else float(tok)


def _oklab_to_srgb(L: float, a: float, b: float) -> tuple[float, float, float]:
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    lin = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
           -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
           -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)

    def enc(c: float) -> float:
        c = min(max(c, 0.0), 1.0)
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return tuple(enc(c) * 255 for c in lin)  # type: ignore[return-value]


def parse(css: str) -> tuple[float, float, float, float]:
    """(r, g, b in 0..255, alpha in 0..1) from a computed CSS colour. Raises ValueError on anything else."""
    s = css.strip().lower()
    if s in ("transparent", ""):
        return (0.0, 0.0, 0.0, 0.0)
    m = re.fullmatch(r"(rgba?|oklab)\(\s*(.*?)\s*\)", s)
    if not m:
        raise ValueError(f"not a colour this lint reads: {css!r}")
    parts = [p for p in re.split(r"[\s,/]+", m.group(2)) if p]
    if not all(re.fullmatch(_NUM, p) for p in parts) or len(parts) not in (3, 4):
        raise ValueError(f"not a colour this lint reads: {css!r}")
    alpha = _f(parts[3]) if len(parts) == 4 else 1.0
    if m.group(1) == "oklab":
        r, g, b = _oklab_to_srgb(_f(parts[0]), _f(parts[1], 0.4), _f(parts[2], 0.4))
    else:
        r, g, b = (_f(p, 255) for p in parts[:3])
    return (r, g, b, alpha)


def over(top: tuple[float, float, float, float], under: tuple[float, float, float]) -> tuple[float, float, float]:
    a = top[3]
    return tuple(top[i] * a + under[i] * (1 - a) for i in range(3))  # type: ignore[return-value]


def luminance(rgb: tuple[float, float, float]) -> float:
    def ch(c: float) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(x: tuple[float, float, float], y: tuple[float, float, float]) -> float:
    hi, lo = sorted((luminance(x), luminance(y)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def label_contrast(color: str, background: str, plates=PLATES) -> dict:
    """The label's contrast over each plate and the worst, from its computed colour and background."""
    text, bg = parse(color), parse(background)
    by = {}
    for name, plate in plates.items():
        behind = over(bg, plate)
        by[name] = round(ratio(over(text, behind), behind), 2)
    worst = min(by.values())
    return {"by_plate": by, "worst": worst, "ok": worst >= AA, "min": AA}
