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
    macro's paper ground, still renders it)."""
    import tempfile

    page = browser.new_page(viewport={"width": width, "height": height})
    try:
        if transparent:
            page.emulate_media(color_scheme="dark")
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as fh:
            fh.write(html)
            tmp_path = fh.name
        try:
            page.goto(f"file:///{tmp_path.replace(chr(92), '/')}")
            page.evaluate("document.fonts && document.fonts.ready")
            shown: dict[str, str] = {}
            if text_selectors:
                for field, selector in text_selectors.items():
                    el = page.query_selector(selector)
                    shown[field] = el.inner_text() if el else ""
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
            Path(tmp_path).unlink(missing_ok=True)
    finally:
        page.close()
