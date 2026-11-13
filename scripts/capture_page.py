"""Browser edge of the own-page capture (Studio stage 8, void news's own pages).

    python scripts/capture_page.py <jobs.json> <result.json>

jobs.json is a list of {"url", "out", "width", "clip"}; each page is loaded once
in one headless Chromium (Playwright), its headings, links and every picture
element are read with their boxes, and it is screenshotted 1920 wide (the whole
page, or only `clip` when given). The browser is closed at the end, always.

No judgement is made here: scripts/lib/rights/own-pages.mjs (Node, tested)
decides the region, checks the edition and refuses third-party pictures. The
request names void omnibus with its contact URL, as every fetcher request does.
Audio is muted. Net-new.
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

USER_AGENT = "void-omnibus-capture/1 (+https://omnibus.voidvision.org; own-page capture, one page at a time)"

READ = """() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const heads = [...document.querySelectorAll('h1, h2, h3')].map((e) => ({ tag: e.tagName.toLowerCase(), cls: e.className || '', text: e.textContent.trim().replace(/\\s+/g, ' '), href: (e.querySelector('a') || e.closest('a') || {}).href || null, box: box(e) }));
  const pics = [];
  // Hidden elements (the overlays hidden below, or anything not drawn) are not in the screenshot, so they are not pictures in it.
  const shown = (e) => e.checkVisibility ? e.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true;
  for (const e of document.querySelectorAll('img, picture, video, iframe, object, embed, canvas, svg image')) {
    if (!shown(e)) continue;
    const src = e.currentSrc || e.src || e.data || e.getAttribute('href') || e.getAttribute('xlink:href') || '';
    pics.push({ tag: e.tagName.toLowerCase(), src: String(src).slice(0, 500), box: box(e) });
  }
  for (const e of document.querySelectorAll('*')) {
    const bg = getComputedStyle(e).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(') && shown(e)) pics.push({ tag: 'background', src: bg.slice(0, 500), box: box(e) });
  }
  // An inline drawing outside the site's own header, nav and footer counts as a picture too: it may be someone else's mark.
  for (const e of document.querySelectorAll('svg')) {
    if (!shown(e) || (e.parentElement && e.parentElement.closest('svg'))) continue;
    if (e.closest('header:not(.np-masthead), nav, footer, [role=banner], [role=contentinfo]')) continue;
    pics.push({ tag: 'svg', src: 'inline svg' + (e.getAttribute('aria-label') ? ': ' + e.getAttribute('aria-label') : ''), box: box(e) });
  }
  // Bands no tour may rest on: the Brief, which a Paper build reads from the latest brief, not from the edition.
  const noTour = [...document.querySelectorAll('section.np-brief, [aria-label="The Brief"]')].map((e) => ({ why: 'the Brief, built from the latest brief at build time, not from the edition', box: box(e) }));
  const time = document.querySelector('time');
  return { title: document.title, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, heads, pics, no_tour: noTour, time: time ? { text: time.textContent.trim(), datetime: time.getAttribute('datetime') } : null };
}"""

# Fixed and sticky elements (the audio player, a sticky nav, a viewport fade) repeat or float over a
# full-page screenshot; they are hidden before anything is read, and counted.
HIDE_OVERLAYS = """() => {
  let n = 0;
  for (const e of document.querySelectorAll('*')) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') { e.style.setProperty('visibility', 'hidden', 'important'); n++; }
  }
  return n;
}"""


def main(jobs_path, result_path):
    with open(jobs_path, encoding="utf8") as f:
        jobs = json.load(f)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--mute-audio", *os.environ.get("OMNIBUS_CHROMIUM_ARGS", "").split()])  # C8: --disable-gpu on Actions
        try:
            for job in jobs:
                width = int(job.get("width", 1920))
                page = browser.new_page(viewport={"width": width, "height": 1080}, device_scale_factor=1, color_scheme="light", user_agent=USER_AGENT)
                try:
                    resp = page.goto(job["url"], wait_until="networkidle", timeout=120_000)
                    page.evaluate("document.fonts.ready")
                    hidden = page.evaluate(HIDE_OVERLAYS)
                    info = page.evaluate(READ)
                    info["overlays_hidden"] = hidden
                    clip = job.get("clip")
                    if clip:
                        page.screenshot(path=job["out"], full_page=True, clip={"x": clip["x"], "y": clip["y"], "width": clip["w"], "height": clip["h"]})
                    else:
                        page.screenshot(path=job["out"], full_page=True)
                    results.append({"url": job["url"], "final_url": page.url, "status": resp.status if resp else None, "out": job["out"], "clip": clip, "viewport_width": width, **info})
                finally:
                    page.close()
        finally:
            browser.close()
    with open(result_path, "w", encoding="utf8") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
