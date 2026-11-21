"""E6 (engine plan section 2): broadcast graphics for void omnibus.

Net-new (not transplanted). Reads the G2-approved HTML mocks in
``design/mocks/broadcast/`` plus ``design/tokens.css`` and typesets week
data into them (one headless Chromium, used as a build tool: see
``docs/DECISIONS.md`` 2026-11-12, "graphics generator"). numpy/PIL then
builds the bible's motion presets on top of the typeset PNGs, and ffmpeg
writes ProRes 4444. Every module here is pure Python except ``shoot.py``
(the only one importing Playwright) and ``encode.py`` (the only one
shelling out to ffmpeg); everything else is unit-tested without a browser.
"""
