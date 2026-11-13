"""graphics-clean: engine-drawn layers carry no scanline, noise,
vignette, curvature or interlace, ever (frame.css's own header comment).
This scans a rendered layer's HTML/CSS source text for those effects
however they might be spelled in CSS (a class name, a filter function, an
SVG filter primitive) and fails the ones that smuggle one in. Pure string
scanning, no I/O.
"""

from __future__ import annotations

import re

FORBIDDEN_TOKENS = {
    "scanline": re.compile(r"scan[\s_-]?line", re.IGNORECASE),
    "noise": re.compile(r"\bnoise\b|feTurbulence", re.IGNORECASE),
    "vignette": re.compile(r"vignette", re.IGNORECASE),
    "curvature": re.compile(r"curvature|barrel[\s_-]?distort", re.IGNORECASE),
    "interlace": re.compile(r"interlac", re.IGNORECASE),
}


def find_forbidden_effects(source: str) -> list[str]:
    found = []
    for name, pattern in FORBIDDEN_TOKENS.items():
        if pattern.search(source):
            found.append(name)
    return found


class GraphicsNotClean(Exception):
    def __init__(self, effects: list[str], where: str):
        self.effects = effects
        super().__init__(f"{where}: forbidden effect(s) {', '.join(effects)}")


def assert_clean(source: str, *, where: str = "<layer>") -> None:
    found = find_forbidden_effects(source)
    if found:
        raise GraphicsNotClean(found, where)
