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
# A graphic's visible words never carry the pipeline's own keys: a cluster, commit, run or content hash (a token of 7
# or more hex digits, whole between alphanumeric boundaries, with at least one letter a-f, so a plain number such as a
# date or a count never matches, and at least one digit, so an English word spelt in a-f (DEFACED, ACCEDED) never
# matches; e.g. 2ec1fcb8, a short sha 31f9a8a, cluster-2ec1fcb8, cluster_2ec1fcb8, 2ec1fcb8-01, a UUID, a run id
# r-20261114-014102-1631002a, a 64-hex sha256) or a ledger index ("ledger [23]"). Hyphens and underscores are
# boundaries, not shields (C8 review). The only exemption is a named public catalogue form, masked before the scan:
# NARA's local identifier (342-AF-86335AC, 111-ADC-8634 in a credit). Widen that list only by naming a new form.
# Outlets and records are named in plain words. Only the page's text is read: style and script bodies, tags and attributes are not on screen.

from html.parser import HTMLParser  # noqa: E402

INTERNAL_ID_PATTERNS = {
    "hex id": re.compile(r"(?<![0-9A-Za-z])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,}(?![0-9A-Za-z])", re.IGNORECASE),
    "ledger index": re.compile(r"\bledger\s*\[\s*\d+\s*\]", re.IGNORECASE),
}

# Named public catalogue forms, masked (replaced by spaces) before INTERNAL_ID_PATTERNS scan the text.
CATALOGUE_FORMS = {
    "NARA local identifier": re.compile(r"\b\d{1,4}-[A-Z]{1,5}-[0-9A-Z]+\b"),
}


def mask_catalogue_forms(text: str) -> str:
    for pat in CATALOGUE_FORMS.values():
        text = pat.sub(lambda m: " " * len(m.group(0)), text)
    return text


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
    text = mask_catalogue_forms(visible_text(source))
    return [f"{name}: {m.group(0)}" for name, pat in INTERNAL_ID_PATTERNS.items() for m in pat.finditer(text)]


class InternalIdOnScreen(Exception):
    pass


def assert_no_internal_ids(source: str, *, where: str = "<layer>") -> None:
    found = find_internal_ids(source)
    if found:
        raise InternalIdOnScreen(f"{where}: internal id(s) in on-screen text: {', '.join(found)}")


# ---- bumper-no-bars (show bible v2, section i) --------------------------------------------------------------------
# "The bars were void's lean measurement; a test card with the measurement where its colour should be read void
# out on screen." The bumper (v2's testcard) and every other v2 layer draw none of it: no --bias-* or
# --spectrum-* custom property, by name or by var() reference, and none of the literal hex values those
# properties resolve to in design/tokens.css (kept here as a literal list, not read from the file, so this module
# stays pure string scanning, no I/O; a token's hex is checked for drift in
# studio/tests/test_graphics_clean.py against design/tokens.css itself).

BIAS_TOKEN_RE = re.compile(r"--(?:bias|spectrum)-[\w-]+")
# design/tokens.css: --spectrum-dark-* (the dark theatre) and --spectrum-paper-* (the paper/light theme), the
# only hex literals a --bias-* custom property ever resolves to.
SPECTRUM_HEX = (
    "#5088d0", "#6498d8", "#78aede", "#48b870", "#d05c48", "#cc3e34", "#b02e26",
    "#0e2e70", "#1b5298", "#2e78b4", "#2b784a", "#c4503e", "#9c2c22", "#6e1610",
)
SPECTRUM_HEX_RE = re.compile("|".join(re.escape(h) for h in SPECTRUM_HEX), re.IGNORECASE)


def find_spectrum_tokens(source: str) -> list[str]:
    """Every bias/spectrum custom property name or literal hex this source carries, each reported once."""
    found = sorted(set(BIAS_TOKEN_RE.findall(source)))
    if SPECTRUM_HEX_RE.search(source):
        found.extend(sorted({m.group(0).lower() for m in SPECTRUM_HEX_RE.finditer(source)}))
    return found


class SpectrumInEngineLayer(Exception):
    pass


def assert_no_bias_tokens(source: str, *, where: str = "<layer>") -> None:
    """`bumper-no-bars` (show bible v2, section o): a layer this lint covers names and uses none of void's lean
    spectrum, by token or by its literal hex."""
    found = find_spectrum_tokens(source)
    if found:
        raise SpectrumInEngineLayer(f"{where}: spectrum token/hex in an engine-drawn layer: {', '.join(found)}")
