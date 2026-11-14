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


# ---- on-screen copy: no internal ids (C8 review) ------------------------------------------------------------------
# A graphic's visible words never carry the pipeline's own keys: a cluster or commit hash (an 8-hex-digit token with
# both a digit and a letter, e.g. 2ec1fcb8) or a ledger index ("ledger [23]"). Outlets and records are named in
# plain words. Only the page's text is read: style and script bodies, tags and attributes are not on screen.

from html.parser import HTMLParser  # noqa: E402

INTERNAL_ID_PATTERNS = {
    "hex id": re.compile(r"\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b", re.IGNORECASE),
    "ledger index": re.compile(r"\bledger\s*\[\s*\d+\s*\]", re.IGNORECASE),
}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("style", "script") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def visible_text(source: str) -> str:
    p = _Text()
    p.feed(source)
    p.close()
    return " ".join(p.parts)


def find_internal_ids(source: str) -> list[str]:
    """Every internal id the page's visible text shows, as 'kind: token'."""
    text = visible_text(source)
    return [f"{name}: {m.group(0)}" for name, pat in INTERNAL_ID_PATTERNS.items() for m in pat.finditer(text)]


class InternalIdOnScreen(Exception):
    pass


def assert_no_internal_ids(source: str, *, where: str = "<layer>") -> None:
    found = find_internal_ids(source)
    if found:
        raise InternalIdOnScreen(f"{where}: internal id(s) in on-screen text: {', '.join(found)}")
