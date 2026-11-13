"""The only module in `studio/graphics/` that imports Playwright. One
headless Chromium instance, opened once and reused for every layer in a
run, closed when the run ends (DECISIONS 2026-11-12: this is a build
tool invoked by a script, never the agent's own interactive browser -
Ink & Momentum's "Playwright is allowed only for the verifier and the
user-sim" rule governs *that* tool; this is a separate, unattended
process a human or CI starts with `python -m studio.graphics.render`).

Kept deliberately thin: everything it returns (PNG bytes, DOM text) is
handed back to pure functions elsewhere (`countsmatch.py`, `motion.py`)
for the actual logic, so only this file needs a browser to exercise, and
`studio/graphics/tests/` never imports it.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

WIDTH, HEIGHT = 1920, 1080


@contextmanager
def chromium():
    """One headless Chromium, closed on exit even if the caller raises."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            yield browser
        finally:
            browser.close()


def _shoot_url(browser, url: str, *, width: int, height: int, transparent: bool,
                text_selectors: dict[str, str] | None, box_selectors: dict[str, str] | None):
    page = browser.new_page(viewport={"width": width, "height": height})
    try:
        if transparent:
            page.emulate_media(color_scheme="dark")
        # Chromium only ever typesets the STATIC, settled state (the
        # ticket's own words); every preset (wipe, flap, step, sweep,
        # credits roll, the typed-paper reveal) is built afterwards in
        # numpy/PIL (compose.py), never played out as a CSS animation on
        # screen. frame.css's own `prefers-reduced-motion` rule (".lt,
        # .flap-block, .hero-num { animation: none; }") then renders each
        # layer at its natural, final geometry - the same state spec 1.3
        # says the G2 mocks were themselves captured in.
        page.emulate_media(reduced_motion="reduce")
        page.goto(url)
        page.evaluate("document.fonts && document.fonts.ready")
        shown: dict[str, str] = {}
        if text_selectors:
            for field, selector in text_selectors.items():
                el = page.query_selector(selector)
                # text_content (not inner_text) because several layers are
                # typeset in SVG <text> (the test cards, the board), and
                # inner_text requires an HTMLElement.
                shown[field] = (el.text_content() or "") if el else ""
        boxes: dict[str, dict] = {}
        if box_selectors:
            for field, selector in box_selectors.items():
                el = page.query_selector(selector)
                boxes[field] = el.bounding_box() if el else None
        if transparent:
            page.evaluate("document.documentElement.style.background = 'transparent';"
                           "document.body.style.background = 'transparent';")
        png = page.screenshot(omit_background=transparent)
        return png, shown, boxes
    finally:
        page.close()


def shoot_html(browser, html: str, *, width: int = WIDTH, height: int = HEIGHT, transparent: bool = True,
               text_selectors: dict[str, str] | None = None,
               box_selectors: dict[str, str] | None = None) -> tuple[bytes, dict[str, str], dict[str, dict]]:
    """Writes `html` to a temp file, loads it, waits for web fonts, reads
    back any requested text (for counts-match) and bounding boxes (for
    the motion pass, e.g. the typed-paper macro's per-row reveal rect),
    then screenshots the page. Returns (png_bytes, {field: text},
    {field: {x,y,width,height}}). `transparent` matches the body
    background to the page so a PNG with an alpha channel keeps only the
    drawn marks (a layer that sets its own background, e.g. the title
    macro's paper ground, still renders it). The generator's own pages
    always link their stylesheets by absolute ``file:///`` path
    (`typeset.py`'s ``_head``), so writing them to an arbitrary temp
    directory is safe; a mock file that links its stylesheets
    *relatively* (``../../tokens.css``) must be shot with `shoot_path`
    instead, from its own directory."""
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as fh:
        fh.write(html)
        tmp_path = fh.name
    try:
        url = f"file:///{tmp_path.replace(chr(92), '/')}"
        return _shoot_url(browser, url, width=width, height=height, transparent=transparent,
                           text_selectors=text_selectors, box_selectors=box_selectors)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def shoot_path(browser, path: str | Path, *, width: int = WIDTH, height: int = HEIGHT, transparent: bool = True,
               text_selectors: dict[str, str] | None = None,
               box_selectors: dict[str, str] | None = None) -> tuple[bytes, dict[str, str], dict[str, dict]]:
    """Like `shoot_html`, but navigates straight to an existing file on
    disk (its relative links resolve against its own directory) rather
    than copying its text into a fresh temp file - for shooting a
    committed mock in place, e.g. the week-32 regression check."""
    abs_path = str(Path(path).resolve()).replace(chr(92), "/")
    url = f"file:///{abs_path}"
    return _shoot_url(browser, url, width=width, height=height, transparent=transparent,
                       text_selectors=text_selectors, box_selectors=box_selectors)
