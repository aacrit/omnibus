"""The only module in `studio/graphics/` that imports Playwright (from
`studio/requirements-graphics.txt`, never installed by the gate). One
headless Chromium instance, opened once and reused for every layer in a
run, closed when the run ends (DECISIONS 2026-11-12: a build tool invoked
by a script, never the agent's own interactive browser).

Kept deliberately thin: everything it returns (PNG bytes, DOM text,
boxes, measured advances) is handed to pure functions elsewhere
(`countsmatch.py`, `compose.py`), so only this file needs a browser, and
`studio/tests/` never imports it.
"""

from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from pathlib import Path

WIDTH, HEIGHT = 1920, 1080


@contextmanager
def chromium():
    """One headless Chromium, closed on exit even if the caller raises."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        # OMNIBUS_CHROMIUM_ARGS: extra launch flags for this machine (episode-draft.yml passes --disable-gpu); unset, none
        browser = pw.chromium.launch(headless=True, args=os.environ.get("OMNIBUS_CHROMIUM_ARGS", "").split())
        try:
            yield browser
        finally:
            browser.close()


class Shot:
    """One loaded, settled page: read its DOM, then screenshot it."""

    def __init__(self, page, transparent: bool):
        self.page = page
        self.transparent = transparent

    def text(self, selector: str) -> str:
        el = self.page.query_selector(selector)
        # text_content (not inner_text): several layers are SVG <text>.
        return (el.text_content() or "") if el else ""

    def texts(self, selector: str) -> list[str]:
        return [(el.text_content() or "") for el in self.page.query_selector_all(selector)]

    def count(self, selector: str) -> int:
        return len(self.page.query_selector_all(selector))

    def box(self, selector: str) -> tuple[int, int, int, int]:
        """(x, y, width, height) in frame pixels, rounded outward to whole
        pixels; raises if the element is missing."""
        el = self.page.query_selector(selector)
        if el is None:
            raise LookupError(f"no element for {selector!r}")
        b = el.bounding_box()
        import math
        x0, y0 = math.floor(b["x"]), math.floor(b["y"])
        x1, y1 = math.ceil(b["x"] + b["width"]), math.ceil(b["y"] + b["height"])
        return x0, y0, x1 - x0, y1 - y0

    def union_box(self, selector: str) -> tuple[int, int, int, int]:
        """The bounding box of the element and every descendant (a lower
        third's dot and label sit outside `.lt`'s own box)."""
        r = self.page.evaluate(
            """(sel) => { const root = document.querySelector(sel); if (!root) return null;
               let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
               for (const el of [root, ...root.querySelectorAll('*')]) {
                 const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
                 x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
                 x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); }
               return [x0, y0, x1, y1]; }""", selector)
        if r is None:
            raise LookupError(f"no element for {selector!r}")
        import math
        x0, y0, x1, y1 = math.floor(r[0]), math.floor(r[1]), math.ceil(r[2]), math.ceil(r[3])
        return x0, y0, x1 - x0, y1 - y0

    def char_right_edges(self, selector: str) -> list[float]:
        """The right edge (frame x) of each character of the element's
        first text node, measured with a DOM Range per character."""
        return self.page.evaluate(
            """(sel) => { const el = document.querySelector(sel); const node = el && el.firstChild;
               if (!node) return []; const r = document.createRange(); const out = [];
               for (let i = 0; i < node.length; i++) { r.setStart(node, i); r.setEnd(node, i + 1);
                 out.push(r.getBoundingClientRect().right); }
               return out; }""", selector)

    def evaluate(self, js: str, arg=None):
        return self.page.evaluate(js, arg)

    def screenshot(self, *, full_page: bool = False) -> bytes:
        if self.transparent:
            self.page.evaluate("document.documentElement.style.background = 'transparent';"
                               "document.body.style.background = 'transparent';")
        return self.page.screenshot(omit_background=self.transparent, full_page=full_page)


def _settle(page):
    # Chromium only typesets the STATIC, settled state: every preset is built
    # afterwards in compose.py. frame.css's reduced-motion rule renders each
    # layer at its final geometry (spec 1.3).
    page.evaluate("document.fonts.ready")
    page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


@contextmanager
def session_html(browser, html: str, *, width: int = WIDTH, height: int = HEIGHT, transparent: bool = True):
    """Writes `html` to a temp file, loads it with reduced motion on, waits
    for web fonts and two frames, and yields a `Shot`. The generator's
    pages link their stylesheets by absolute file:/// path, so any temp
    directory works; a mock that links relatively uses `session_path`."""
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as fh:
        fh.write(html)
        tmp_path = fh.name
    try:
        with session_path(browser, tmp_path, width=width, height=height, transparent=transparent) as shot:
            yield shot
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@contextmanager
def session_path(browser, path: str | Path, *, width: int = WIDTH, height: int = HEIGHT, transparent: bool = True):
    page = browser.new_page(viewport={"width": width, "height": height})
    try:
        page.emulate_media(reduced_motion="reduce")
        page.goto("file:///" + str(Path(path).resolve()).replace("\\", "/"))
        _settle(page)
        yield Shot(page, transparent)
    finally:
        page.close()


def shoot_html(browser, html: str, **kw) -> bytes:
    with session_html(browser, html, **kw) as shot:
        return shot.screenshot()


def shoot_path(browser, path: str | Path, **kw) -> bytes:
    with session_path(browser, path, **kw) as shot:
        return shot.screenshot()
