"""Builds the full HTML document Chromium typesets for each broadcast
graphic subtype, at 1920x1080, over `design/tokens.css` and
`design/mocks/broadcast/frame.css` (the only two stylesheets: colours
stay inside `tokens.css`, per Ink & Momentum, and the frame's layout
grammar stays inside `frame.css`, so a generated page and a hand-built
mock use exactly the same CSS). Every function here returns a plain
string; nothing touches a browser, so these are unit-tested directly in
`studio/tests/test_graphics_typeset.py` by asserting on the markup they
produce (the numbers they typeset, the absence of forbidden effects).
"""

from __future__ import annotations

import html as _html

from . import layout
from . import svgparts
from .data import (
    BoardRow,
    BoardSpec,
    ClockSpec,
    CountCardSpec,
    CreditsSpec,
    DayBarSpec,
    EndBoardSpec,
    LowerThirdSpec,
    TestCardSpec,
    TitleMacroSpec,
)

RUNG_ABBR = {
    "far-left": "FAR LEFT", "left": "LEFT", "center-left": "CENTER LEFT", "center": "CENTER",
    "center-right": "CENTER RIGHT", "right": "RIGHT", "far-right": "FAR RIGHT",
}


def esc(text: object) -> str:
    """Every value interpolated into markup goes through this: ids,
    headlines and outlet names are untrusted strings read from the
    record, never typeset raw."""
    return _html.escape(str(text), quote=True)


def _head(title: str, *, tokens_css: str, frame_css: str) -> str:
    return (
        '<!doctype html>\n<html lang="en" data-theme="dark">\n<head>\n'
        '<meta charset="utf-8">\n<meta name="viewport" content="width=1920">\n'
        f"<title>{esc(title)}</title>\n"
        f'<link rel="stylesheet" href="file:///{tokens_css}">\n'
        f'<link rel="stylesheet" href="file:///{frame_css}">\n'
        "</head>\n<body>\n"
    )


_TAIL = "</body>\n</html>\n"


# ---- test card (3.3, 3.4) -------------------------------------------------

def testcard_html(spec: TestCardSpec, *, tokens_css: str, frame_css: str) -> str:
    if spec.subtype == "echo":
        return _echo_testcard_html(spec, tokens_css=tokens_css, frame_css=frame_css)

    band_x, band_width = 420.0, 600.0
    segs = layout.bar_segments(list(spec.bars), band_x=band_x, band_width=band_width)
    bar_rects = "".join(
        f'<rect class="b-{s.rung}" x="{s.x}" y="436" width="{s.width}" height="124"/>' for s in segs
    )
    cols = layout.key_columns()
    counts = dict(zip(layout.RUNGS, spec.bars))
    key_parts = []
    for col in cols:
        count = counts[col.rung]
        label = RUNG_ABBR[col.rung]
        label_lines = label.split(" ", 1)
        if len(label_lines) == 2:
            label_svg = (
                f'<text class="tc-abbr" x="{col.center_x}" y="646" text-anchor="middle" font-size="18">{esc(label_lines[0])}</text>'
                f'<text class="tc-abbr" x="{col.center_x}" y="666" text-anchor="middle" font-size="18">{esc(label_lines[1])}</text>'
            )
        else:
            label_svg = f'<text class="tc-abbr" x="{col.center_x}" y="657" text-anchor="middle" font-size="18">{esc(label)}</text>'
        key_parts.append(
            f'<rect class="b-{col.rung}" x="{col.center_x - 7}" y="610" width="14" height="14"/>'
            + label_svg
            + f'<text class="tc-count" x="{col.center_x}" y="704" text-anchor="middle" font-size="30">{esc(count)}</text>'
        )

    svg = (
        '<svg class="tc-svg" viewBox="0 0 1440 1080" role="img" '
        f'aria-label="Test card: {esc(spec.word)}"><g class="tc">'
        '<rect class="tc-field" width="1440" height="1080"/>'
        f'<path class="tc-grid" d="{svgparts.grid_path()}"/>'
        + svgparts.castellation_rects("tc-cast-a", "tc-cast-b")
        + svgparts.frame_rect()
        + svgparts.centre_disc()
        + f'<text class="tc-word" x="720" y="410" text-anchor="middle" font-size="76">{esc(spec.word)}</text>'
        + bar_rects
        + f'<rect class="tc-band-frame" x="{band_x}" y="436" width="{band_width}" height="124"/>'
        + f'<text class="tc-abbr" x="720" y="594" text-anchor="middle" font-size="20">{esc(spec.caption)}</text>'
        + "".join(key_parts)
        + f'<text class="tc-line" x="720" y="772" text-anchor="middle" font-size="30">{esc(spec.week_line)}</text>'
        + svgparts.staircase_rects()
        + "</g></svg>"
    )
    return (
        _head(f"Test card, {spec.word}", tokens_css=tokens_css, frame_css=frame_css)
        + f'<div class="frame"><div class="field">{svg}</div></div>\n'
        + _TAIL
    )


def _echo_testcard_html(spec: TestCardSpec, *, tokens_css: str, frame_css: str) -> str:
    # The Echo's six bars are decorative (equal width, stair-6..stair-1),
    # never a measurement - spec 3.4: "the past has no outlet measurement".
    bars = "".join(
        f'<rect class="s{6 - i}" x="{420 + i * 100}" y="448" width="100" height="84"/>' for i in range(6)
    )
    svg = (
        '<svg class="tc-svg" viewBox="0 0 1440 1080" role="img" '
        f'aria-label="Test card: {esc(spec.word)}"><g class="tc tc-echo">'
        '<rect class="tc-field" width="1440" height="1080"/>'
        f'<path class="tc-grid" d="{svgparts.grid_path()}"/>'
        + svgparts.castellation_rects("tc-cast-a", "tc-cast-b")
        + svgparts.frame_rect()
        + svgparts.centre_disc()
        + f'<text class="tc-word" x="720" y="410" text-anchor="middle" font-size="76">{esc(spec.word)}</text>'
        + bars
        + '<rect class="tc-band-frame" x="420" y="448" width="600" height="84"/>'
        + f'<text class="tc-year" x="720" y="690" text-anchor="middle" font-size="150">{esc(spec.year)}</text>'
        + f'<text class="tc-line" x="720" y="772" text-anchor="middle" font-size="30">{esc(spec.week_line)}</text>'
        + svgparts.staircase_rects()
        + "</g></svg>"
    )
    return (
        _head(f"Test card, {spec.word}", tokens_css=tokens_css, frame_css=frame_css)
        + f'<div class="frame"><div class="field field--echo">{svg}</div></div>\n'
        + _TAIL
    )


# ---- framings board (3.6) -------------------------------------------------

def board_page_html(page: list[BoardRow], *, head_left: str, head_right: str, page_index: int,
                     untitled: dict[str, list[str]], tokens_css: str, frame_css: str) -> str:
    rows_html = []
    for row in page:
        rung_idx = layout.RUNGS.index(row.rung)
        rung_x = layout.rung_center_x(rung_idx)
        margin = layout.flap_margin(rung_x)
        placement = layout.outlet_placement(row.rung, rung_x, len(row.outlet) * 9.0)
        clamp_class = {"left": " clamp-l", "right": " clamp-r"}.get(placement.clamp, "")
        local_x = placement.x
        rows_html.append(
            f'<div class="brow"><div class="flap" style="margin-left:{margin:g}px">'
            f'<span class="flap-block bc-board">{esc(row.headline)}</span></div>'
            f'<div class="outlet-line"><span class="outlet bc-caps r-{row.rung}{clamp_class}" '
            f'data-x="{local_x:g}" style="left:{local_x:g}px">{esc(row.outlet)}</span></div></div>'
        )
    ticks = layout.ladder_ticks()
    tick_svg = "".join(f'<line x1="{t:g}" y1="2" x2="{t:g}" y2="14"/>' for t in ticks)
    occupied = {row.rung for row in page} | set(untitled.keys())
    mark_svg = "".join(
        f'<rect class="b-{rung}" x="{layout.rung_center_x(i) - 14:g}" y="0" width="28" height="16"/>'
        for i, rung in enumerate(layout.RUNGS) if rung in occupied
    )
    label_svg = "".join(
        f'<span class="bc-caps" style="left:{layout.rung_center_x(i):g}px">{esc(layout.RUNGS[i].replace("-", " ").title())}</span>'
        for i in range(7)
    )
    untitled_html = "".join(
        f'<div class="brow"><div class="outlet-line"><span class="outlet bc-caps r-{rung}">{esc(name)}</span></div></div>'
        for rung, names in untitled.items() for name in names
    )
    return (
        _head(f"Framings board, page {page_index + 1}", tokens_css=tokens_css, frame_css=frame_css)
        + '<div class="frame"><div class="field">'
        + f'<div class="board-head"><span class="bc-caps eyebrow-bc">{esc(head_left)}</span>'
        + f'<span class="bc-mono eyebrow-bc">{esc(head_right)}</span></div>'
        + f'<div class="rows">{"".join(rows_html)}{untitled_html}</div>'
        + f'<svg class="ladder-base" viewBox="0 0 1152 16" aria-hidden="true">{tick_svg}{mark_svg}</svg>'
        + f'<div class="ladder-labels" aria-hidden="true">{label_svg}</div>'
        + "</div></div>\n" + _TAIL
    )


def board_pages_html(spec: BoardSpec, *, tokens_css: str, frame_css: str) -> list[str]:
    pages = layout.paginate_rows(list(spec.rows))
    return [
        board_page_html(page, head_left=spec.head_left, head_right=spec.head_right, page_index=i,
                         untitled=(spec.untitled if i == len(pages) - 1 else {}),
                         tokens_css=tokens_css, frame_css=frame_css)
        for i, page in enumerate(pages)
    ]


# ---- lower third (3.5) -----------------------------------------------------

def lower_third_html(spec: LowerThirdSpec, *, tokens_css: str, frame_css: str) -> str:
    return (
        _head(f"Lower third, {spec.place}", tokens_css=tokens_css, frame_css=frame_css)
        + '<div class="frame"><div class="slot" aria-label="Public-domain still slot">'
        + '<div class="slot-frame"></div></div>'
        + f'<div class="lt" role="img" aria-label="Slate: {esc(spec.place)}, {esc(spec.date)}">'
        + '<div class="lt-rule"></div>'
        + f'<div class="lt-t1"><span class="lt-place bc-caps">{esc(spec.place.upper())}</span>'
        + f'<span class="lt-name">{esc(spec.speaker_name)}</span></div>'
        + f'<div class="lt-t2"><span class="lt-date bc-mono">{esc(spec.date.upper())}</span>'
        + f'<span class="lt-role bc-caps">{esc(spec.role)}</span></div>'
        + '<span class="lt-dot" style="left:calc(100% + 18px)"></span>'
        + f'<span class="lt-dot-label bc-caps" style="left:calc(100% + 52px); top:-13px">{esc(spec.dot_label)}</span>'
        + "</div></div>\n" + _TAIL
    )


# ---- count card (3.7) -------------------------------------------------------

def count_card_html(spec: CountCardSpec, *, tokens_css: str, frame_css: str) -> str:
    n = len(spec.rows)
    gap = 540.0 / max(n, 1)
    top = 300.0
    blocks = []
    for i, row in enumerate(spec.rows):
        y = top + i * gap
        if row.qualifier:
            blocks.append(
                f'<div class="count-block" style="top:{y:g}px"><div class="bc-caps eyebrow-bc" '
                f'style="font-size:30px; color:var(--o-grey-2)">{esc(row.qualifier)}</div></div>'
            )
            y += 50
        blocks.append(f'<div class="count-block" style="top:{y:g}px"><div class="hero-num bc-mono">{esc(row.hero)}</div></div>')
        blocks.append(
            f'<div class="count-block" style="top:{y + 110:g}px"><p class="context">{esc(row.context)}</p></div>'
        )
    date_html = (
        f'<div class="count-block" style="top:900px"><span class="bc-mono" '
        f'style="font-size:var(--bc-data); color:var(--o-grey-2)">{esc(spec.date_line)}</span></div>'
        if spec.date_line else ""
    )
    return (
        _head(f"Count card, {spec.id}", tokens_css=tokens_css, frame_css=frame_css)
        + '<div class="frame"><div class="field">'
        + f'<div class="board-head"><span class="bc-caps eyebrow-bc">{esc(spec.eyebrow)}</span>'
        + f'<span class="bc-mono eyebrow-bc">{esc(spec.week_label)}</span></div>'
        + "".join(blocks) + date_html
        + '<div class="staircase" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>'
        + "</div></div>\n" + _TAIL
    )


# ---- day lean bars (net-new; no G2 mock, see docs/DECISIONS.md) ------------

def day_bars_html(spec: DayBarSpec, *, tokens_css: str, frame_css: str) -> str:
    band_x, band_width = 420.0, 600.0
    segs = layout.bar_segments(list(spec.bars), band_x=band_x, band_width=band_width)
    bar_rects = "".join(
        f'<rect class="b-{s.rung}" x="{s.x}" y="500" width="{s.width}" height="60"/>' for s in segs
    )
    svg = (
        '<svg class="tc-svg" viewBox="0 0 1440 1080" role="img" '
        f'aria-label="Day bars: {esc(spec.day)}"><g>'
        + bar_rects
        + f'<rect class="tc-band-frame" x="{band_x}" y="500" width="{band_width}" height="60"/>'
        + f'<text class="tc-abbr" x="720" y="580" text-anchor="middle" font-size="18">{esc(spec.caption)}</text>'
        + f'<text class="tc-line" x="720" y="420" text-anchor="middle" font-size="30">{esc(spec.slate)}</text>'
        + "</g></svg>"
    )
    return (
        _head(f"Day bars, {spec.day}", tokens_css=tokens_css, frame_css=frame_css)
        + f'<div class="frame"><div class="field">{svg}</div></div>\n'
        + _TAIL
    )


# ---- clock (3.9) ------------------------------------------------------------

def clock_html(spec: ClockSpec, *, tokens_css: str, frame_css: str) -> str:
    angles = layout.clock_hand_angles(spec.hour, spec.minute, spec.second)
    ticks = svgparts.clock_ticks_svg()
    svg = (
        '<svg class="clock" viewBox="-100 -100 200 200" role="img" '
        f'aria-label="Clock at {spec.hour:02d}:{spec.minute:02d}:{spec.second:02d} UTC">'
        '<circle class="dial" r="97"/>' + ticks
        + f'<g transform="rotate({angles["hour"]})">'
        '<line class="hand-key" x1="0" y1="10" x2="0" y2="-49.5" stroke-width="10"/>'
        '<line class="hand" x1="0" y1="10" x2="0" y2="-48" stroke-width="7"/></g>'
        + f'<g transform="rotate({angles["minute"]})">'
        '<line class="hand-key" x1="0" y1="10" x2="0" y2="-79.5" stroke-width="7.5"/>'
        '<line class="hand" x1="0" y1="10" x2="0" y2="-78" stroke-width="4.5"/></g>'
        + f'<g transform="rotate({angles["second"]})" class="sec">'
        '<line class="hand-sec" x1="0" y1="18" x2="0" y2="-86" stroke-width="1.6"/></g>'
        '<circle class="hub-key" r="6.5" style="fill:var(--o-black)"/>'
        '<circle class="hub" r="4.5"/></svg>'
    )
    return (
        _head(f"Clock, {spec.hour:02d}:{spec.minute:02d}:{spec.second:02d} UTC", tokens_css=tokens_css, frame_css=frame_css)
        + '<div class="frame"><div class="field">'
        + f'<div class="abs" style="left:360px; top:96px; width:720px; height:720px">{svg}</div>'
        + '<div class="abs wordmark" style="left:0; width:1440px; top:846px; font-size:60px">void omnibus</div>'
        + f'<div class="abs bc-mono" style="left:0; width:1440px; top:936px; text-align:center; font-size:30px; color:var(--o-grey-2)">{esc(spec.date_line)}</div>'
        + "</div></div>\n" + _TAIL
    )


def clock_layer_html(spec: ClockSpec, *, layer: str, tokens_css: str, frame_css: str) -> str:
    """The clock is shot as two separate layers (ticket: "clock dial + hands
    as separate layers"): `layer="dial"` typesets everything except the
    three hand groups, `layer="hands"` typesets only the hands (dial left
    transparent) so the sweep's motion pass only has to repaint the hands."""
    full = clock_html(spec, tokens_css=tokens_css, frame_css=frame_css)
    if layer == "dial":
        import re
        return re.sub(r'<g transform="rotate\([^)]*\)"[^>]*>.*?</g>', "", full, flags=re.DOTALL)
    if layer == "hands":
        import re
        dial_bits = re.sub(r'<circle class="dial"[^/]*/>', "", full)
        dial_bits = re.sub(r'<line class="tick"[^/]*/>', "", dial_bits)
        return dial_bits
    raise ValueError(f"unknown clock layer {layer!r}")


# ---- credits and end board (3.11) ------------------------------------------

def credits_html(spec: CreditsSpec, *, tokens_css: str, frame_css: str, line_height: int = 54) -> str:
    lines_html = "".join(f'<div class="endline" style="position:static">{esc(line)}</div>' for line in spec.lines)
    height = max(1080, len(spec.lines) * line_height + 1080)
    return (
        _head("Credits roll", tokens_css=tokens_css, frame_css=frame_css)
        + f'<div class="frame" style="height:{height}px">'
        + f'<div class="field" style="height:{height}px; display:flex; flex-direction:column; '
        + f'justify-content:flex-end; gap:{line_height - 30}px; text-align:center; padding-bottom:40px">'
        + lines_html + "</div></div>\n" + _TAIL
    )


def end_board_html(spec: EndBoardSpec, *, tokens_css: str, frame_css: str) -> str:
    return (
        _head(f"End board, week {spec.issue}", tokens_css=tokens_css, frame_css=frame_css)
        + '<div class="frame"><div class="field">'
        + '<div class="abs sigil-bc" style="left:560px; top:170px; width:320px; height:320px">'
        '<svg style="width:320px;height:320px" viewBox="0 0 24 24" aria-hidden="true">'
        '<circle cx="12" cy="12" r="10.40" stroke-width="1.2"/></svg></div>'
        + '<div class="abs wordmark" style="left:0; width:1440px; top:600px; font-size:124px">void omnibus</div>'
        + '<div class="endline" style="top:800px">'
        + f'<span class="bc-caps">Week</span> <span class="bc-mono">{esc(spec.issue)}</span>'
        + f'<span class="sep">·</span><span class="roman">{esc(spec.roman_year)}</span>'
        + f'<span class="sep">·</span><span class="bc-caps">{esc(spec.licence.split(" ")[0])} {esc(spec.licence.split(" ")[1]) if " " in spec.licence else ""}</span>'
        + f'<span class="sep">·</span><span class="bc-mono" style="font-size:28px">{esc(spec.domain)}</span>'
        + "</div></div></div>\n" + _TAIL
    )


# ---- title typed-paper macro (3.2) -----------------------------------------

def title_macro_html(spec: TitleMacroSpec, *, tokens_css: str, frame_css: str, reveal_rows: int | None = None,
                      reveal_chars: int | None = None) -> str:
    """The whole 14-row macro, Plex Mono caps, full HD. `reveal_rows`/
    `reveal_chars` let the motion pass render a partial strike (every row
    before `reveal_rows` full, that row cut to `reveal_chars`, everything
    after empty); omitted, the full text shows (the typeset reference the
    counts-match check reads)."""
    rows = layout.wrapped_rows(list(spec.lines), spec.columns)
    rows = rows + [spec.week_line]
    shown_rows = []
    for i, row in enumerate(rows):
        if reveal_rows is None:
            shown_rows.append(row)
        elif i < reveal_rows:
            shown_rows.append(row)
        elif i == reveal_rows and reveal_chars is not None:
            shown_rows.append(row[:reveal_chars])
        else:
            shown_rows.append("")
    rows_html = "".join(f'<div class="macro-row bc-mono">{esc(r)}&nbsp;</div>' for r in shown_rows)
    return (
        _head("Title, typed-paper macro", tokens_css=tokens_css, frame_css=frame_css)
        + '<div class="frame" style="background:var(--o-paper)">'
        + '<div class="field" style="background:var(--o-paper); color:var(--o-ink); padding:60px; '
        + 'font-family:var(--font-data); text-transform:uppercase; white-space:pre">'
        + rows_html + "</div></div>\n" + _TAIL
    )
