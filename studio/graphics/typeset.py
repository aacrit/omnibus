"""Builds the full HTML document Chromium typesets for each broadcast
graphic subtype, at 1920x1080, over `design/tokens.css`,
`design/mocks/broadcast/frame.css` and the generator's own
`studio/graphics/graphics.css` (colours stay inside `tokens.css`, per Ink
& Momentum; the mocks' layout grammar stays inside `frame.css`, so a
generated page and a hand-built mock share the same CSS). Every function
returns a plain string; nothing touches a browser, so these are unit-tested
directly in `studio/tests/test_graphics_typeset.py` by asserting on the
markup they produce.

Stylesheet paths are passed in, never baked: `render.py` builds each page
with placeholder paths, hashes that machine-independent template for the
ledger, and only then injects the real ``file:///`` paths.
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
    """Every value interpolated into markup goes through this, text and
    attributes alike: ids, headlines and outlet names are untrusted strings
    read from the record, never typeset raw."""
    return _html.escape(str(text), quote=True)


def _rung(rung: str) -> str:
    """A rung lands in class names and data attributes: only the seven
    ladder ids are accepted."""
    if rung not in layout.RUNGS:
        raise ValueError(f"unknown rung {rung!r}")
    return rung


def _head(title: str, *, tokens_css: str, frame_css: str, graphics_css: str = "", body_class: str = "",
          html_class: str = "") -> str:
    links = f'<link rel="stylesheet" href="{esc(tokens_css)}">\n<link rel="stylesheet" href="{esc(frame_css)}">\n'
    if graphics_css:
        links += f'<link rel="stylesheet" href="{esc(graphics_css)}">\n'
    html_cls = f' class="{esc(html_class)}"' if html_class else ""
    body_cls = f' class="{esc(body_class)}"' if body_class else ""
    return (
        f'<!doctype html>\n<html lang="en" data-theme="dark"{html_cls}>\n<head>\n'
        '<meta charset="utf-8">\n<meta name="viewport" content="width=1920">\n'
        f"<title>{esc(title)}</title>\n" + links
        + f"</head>\n<body{body_cls}>\n"
    )


_TAIL = "</body>\n</html>\n"


# ---- test card (3.3, 3.4) -------------------------------------------------

def testcard_html(spec: TestCardSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
    if spec.subtype == "echo":
        return _echo_testcard_html(spec, tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css)

    band_x, band_width = 420.0, 600.0
    segs = layout.bar_segments(list(spec.bars), band_x=band_x, band_width=band_width)
    bar_rects = "".join(
        f'<rect class="b-{_rung(s.rung)}" x="{s.x}" y="436" width="{s.width}" height="124"/>' for s in segs
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
            + f'<text class="tc-count" data-rung="{col.rung}" x="{col.center_x}" y="704" '
            f'text-anchor="middle" font-size="30">{esc(count)}</text>'
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
        + f'<text class="tc-abbr" data-count="caption" x="720" y="594" text-anchor="middle" font-size="20">{esc(spec.caption)}</text>'
        + "".join(key_parts)
        + f'<text class="tc-line" x="720" y="772" text-anchor="middle" font-size="30">{esc(spec.week_line)}</text>'
        + svgparts.staircase_rects()
        + "</g></svg>"
    )
    return (
        _head(f"Test card, {spec.word}", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css)
        + f'<div class="frame"><div class="field">{svg}</div></div>\n'
        + _TAIL
    )


def _echo_testcard_html(spec: TestCardSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
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
        _head(f"Test card, {spec.word}", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css)
        + f'<div class="frame"><div class="field field--echo">{svg}</div></div>\n'
        + _TAIL
    )


# ---- framings board (3.6) -------------------------------------------------

# The mock's own clamp, verbatim in behaviour: an outlet name centres on its
# rung, then is clamped inside title-safe by its measured width.
_CLAMP_SCRIPT = (
    "<script>\n"
    "document.fonts.ready.then(function () {\n"
    "  document.querySelectorAll('.outlet').forEach(function (o) {\n"
    "    var x = parseFloat(o.dataset.x), half = o.offsetWidth / 2;\n"
    "    if (x + half > 1152) { o.classList.add('clamp-r'); o.style.left = '1152px'; }\n"
    "    else if (x - half < 0) { o.classList.add('clamp-l'); o.style.left = '0px'; }\n"
    "  });\n"
    "  document.documentElement.dataset.clamped = '1';\n"
    "});\n"
    "</script>\n"
)


def _outlet_span(rung: str, name: str, extra_class: str = "") -> str:
    x = layout.rung_center_x(layout.RUNGS.index(_rung(rung)))
    return (f'<span class="outlet bc-caps r-{rung}{extra_class}" data-x="{x:g}" '
            f'style="left:{x:g}px">{esc(name)}</span>')


def board_page_html(page: list[BoardRow], *, head_left: str, head_right: str, page_index: int,
                     untitled: dict[str, list[str]], rung_labels: dict[str, str], tokens_css: str,
                     frame_css: str, graphics_css: str = "", rows_hidden: bool = False) -> str:
    """One board page. `rows_hidden` typesets the same page with its rows
    invisible (the head, ladder, rung labels and any untitled rung stay):
    the base the motion pass flaps each row onto."""
    for rung in layout.RUNGS:
        if not rung_labels.get(rung):
            raise ValueError(f"rung_labels lacks {rung!r} (read LEAN_LABEL_TEXT from ladder.mjs)")
    rows_html = []
    for i, row in enumerate(page):
        rung_x = layout.rung_center_x(layout.RUNGS.index(_rung(row.rung)))
        margin = layout.flap_margin(rung_x)
        rows_html.append(
            f'<div class="brow" data-row="{i}"><div class="flap" style="margin-left:{margin:g}px">'
            f'<span class="flap-block bc-board">{esc(row.headline)}</span></div>'
            f'<div class="outlet-line">{_outlet_span(row.rung, row.outlet)}</div></div>'
        )
    ticks = layout.ladder_ticks()
    tick_svg = "".join(f'<line x1="{t:g}" y1="2" x2="{t:g}" y2="14"/>' for t in ticks)
    occupied = {row.rung for row in page} | {_rung(r) for r in untitled}
    mark_svg = "".join(
        f'<rect class="b-{rung}" x="{layout.rung_center_x(i) - 14:g}" y="0" width="28" height="16"/>'
        for i, rung in enumerate(layout.RUNGS) if rung in occupied
    )
    label_svg = "".join(
        f'<span class="bc-caps" style="left:{layout.rung_center_x(i):g}px">{esc(rung_labels[rung])}</span>'
        for i, rung in enumerate(layout.RUNGS)
    )
    untitled_html = ""
    if untitled:
        names = "".join(_outlet_span(rung, name, " untitled") for rung, names_ in untitled.items() for name in names_)
        untitled_html = f'<div class="untitled-line" aria-label="Occupied rung, no headline">{names}</div>'
    return (
        _head(f"Framings board, page {page_index + 1}", tokens_css=tokens_css, frame_css=frame_css,
              graphics_css=graphics_css, body_class="rows-hidden" if rows_hidden else "")
        + '<div class="frame"><div class="field">'
        + f'<div class="board-head"><span class="bc-caps eyebrow-bc">{esc(head_left)}</span>'
        + f'<span class="bc-mono eyebrow-bc">{esc(head_right)}</span></div>'
        + f'<div class="rows">{"".join(rows_html)}</div>'
        + f'<svg class="ladder-base" viewBox="0 0 1152 16" aria-hidden="true">{tick_svg}{mark_svg}</svg>'
        + f'<div class="ladder-labels" aria-hidden="true">{label_svg}</div>'
        + untitled_html
        + "</div></div>\n" + _CLAMP_SCRIPT + _TAIL
    )


def board_pages(spec: BoardSpec) -> list[tuple[list[BoardRow], dict[str, list[str]]]]:
    """(rows, untitled) per page. The untitled occupied rungs (a rung the
    claim occupies with no headline) go on the page whose rows sit beside
    them in rung order, the first page for far left."""
    pages = layout.paginate_rows(list(spec.rows))
    out: list[tuple[list[BoardRow], dict[str, list[str]]]] = [(p, {}) for p in pages]
    for rung, names in spec.untitled.items():
        idx = layout.RUNGS.index(_rung(rung))
        target = 0
        for i, page in enumerate(pages):
            if page and layout.RUNGS.index(page[0].rung) <= idx:
                target = i
        out[target][1].setdefault(rung, []).extend(names)
    return out


def board_pages_html(spec: BoardSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "",
                     rows_hidden: bool = False) -> list[str]:
    return [
        board_page_html(rows, head_left=spec.head_left, head_right=spec.head_right, page_index=i,
                         untitled=untitled, rung_labels=spec.rung_labels, tokens_css=tokens_css,
                         frame_css=frame_css, graphics_css=graphics_css, rows_hidden=rows_hidden)
        for i, (rows, untitled) in enumerate(board_pages(spec))
    ]


# ---- lower third (3.5, 3.10) ----------------------------------------------

SEP = '<span class="sep">·</span>'


def lower_third_html(spec: LowerThirdSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "",
                      over_slot: bool = False) -> str:
    """Spec 3.5: tier 1 the slate's place (Barlow caps; in the Echo,
    Playfair 600 italic per 3.10) then the speaker's name; tier 2 the
    speaker's role then the date in Mono (``{ROLE} · 14 JUN 1951``), or the
    date alone for a slate with no speaker. An overlay: the frame, field
    and slot are transparent and only the bars, rule, dot and type keep
    pixels. `over_slot` draws the mock's PD-still slot behind it instead,
    for the week-32 regression only."""
    if not spec.dot_labels:
        raise ValueError(f"{spec.id}: a lower third needs its provenance dot label")
    t1 = f'<span class="lt-place bc-caps">{esc(spec.place)}</span>'
    if spec.speaker_name:
        t1 += SEP + f'<span class="lt-name">{esc(spec.speaker_name)}</span>'
    date = f'<span class="lt-date bc-mono">{esc(spec.date.upper())}</span>'
    t2 = (f'<span class="lt-role bc-caps">{esc(spec.role)}</span>' + SEP + date) if spec.role else date
    label = " · ".join(spec.dot_labels)
    slot = ('<div class="slot" aria-label="Public-domain still slot"><div class="slot-frame"></div></div>'
            if over_slot else "")
    lt_class = "lt lt--echo" if spec.echo else "lt"
    return (
        _head(f"Lower third, {spec.place}", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css,
              body_class="" if over_slot else "overlay")
        + '<div class="frame">' + slot
        + f'<div class="{lt_class}" role="img" aria-label="{esc(spec.place)}, {esc(spec.date)}">'
        + '<div class="lt-rule"></div>'
        + f'<div class="lt-t1">{t1}</div>'
        + f'<div class="lt-t2">{t2}</div>'
        + '<span class="lt-dot" style="left:calc(100% + 18px)"></span>'
        + f'<span class="lt-dot-label bc-caps" style="left:calc(100% + 52px); top:-13px">{esc(label)}</span>'
        + "</div></div>\n" + _TAIL
    )


# ---- count card (3.7) -------------------------------------------------------

def count_card_html(spec: CountCardSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
    """One hero numeral (count-card.html's own 300/350/600/760 offsets,
    reproduced exactly) for a single-row card; a multi-row card (cw-1's
    three terms, cw-4's two-way comparison: net-new compositions, no G2
    mock covers more than one count at a time) distributes rows evenly in
    a smaller face so rows never overlap. Every numeral carries
    ``data-row`` so counts-match reads each one back."""
    n = len(spec.rows)
    blocks = []
    date_top = 760
    if n <= 1:
        row = spec.rows[0] if spec.rows else None
        if row:
            if row.qualifier:
                blocks.append(
                    f'<div class="count-block" style="top:300px"><div class="bc-caps eyebrow-bc" '
                    f'style="font-size:30px; color:var(--o-grey-2)">{esc(row.qualifier)}</div></div>'
                )
            blocks.append('<div class="count-block" style="top:350px"><div class="hero-num bc-mono" data-row="0">'
                           f'{esc(row.hero)}</div></div>')
            blocks.append(f'<div class="count-block" style="top:600px"><p class="context" data-row="0">'
                          f'{esc(row.context)}</p></div>')
    else:
        date_top = 900
        available_top, available_bottom = 220.0, 860.0
        row_height = (available_bottom - available_top) / n
        hero_size = max(72, min(132, round(row_height * 0.42)))
        for i, row in enumerate(spec.rows):
            band_top = available_top + i * row_height
            hero_top = band_top + row_height * 0.12
            context_top = hero_top + hero_size * 1.05
            blocks.append(
                f'<div class="count-block" style="top:{hero_top:g}px"><div class="hero-num bc-mono" '
                f'data-row="{i}" style="font-size:{hero_size}px">{esc(row.hero)}</div></div>'
            )
            blocks.append(
                f'<div class="count-block" style="top:{context_top:g}px"><p class="context" data-row="{i}" '
                f'style="font-size:26px">{esc(row.context)}</p></div>'
            )
    date_html = (
        f'<div class="count-block" style="top:{date_top}px"><span class="bc-mono count-date" '
        f'style="font-size:var(--bc-data); color:var(--o-grey-2)">{esc(spec.date_line)}</span></div>'
        if spec.date_line else ""
    )
    field_class = "field field--echo" if spec.echo else "field"
    return (
        _head(f"Count card, {spec.id}", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css)
        + f'<div class="frame"><div class="{field_class}">'
        + f'<div class="board-head"><span class="bc-caps eyebrow-bc">{esc(spec.eyebrow)}</span>'
        + f'<span class="bc-mono eyebrow-bc">{esc(spec.week_label)}</span></div>'
        + "".join(blocks) + date_html
        + '<div class="staircase" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>'
        + "</div></div>\n" + _TAIL
    )


# ---- day lean bars (net-new; no G2 mock, see docs/DECISIONS.md) ------------

def day_bars_html(spec: DayBarSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
    band_x, band_width = 420.0, 600.0
    segs = layout.bar_segments(list(spec.bars), band_x=band_x, band_width=band_width)
    bar_rects = "".join(
        f'<rect class="b-{_rung(s.rung)}" x="{s.x}" y="500" width="{s.width}" height="60"/>' for s in segs
    )
    svg = (
        '<svg class="tc-svg" viewBox="0 0 1440 1080" role="img" '
        f'aria-label="Day bars: {esc(spec.day)}"><g>'
        + bar_rects
        + f'<rect class="tc-band-frame" x="{band_x}" y="500" width="{band_width}" height="60"/>'
        + f'<text class="tc-abbr" data-count="caption" x="720" y="580" text-anchor="middle" font-size="18">{esc(spec.caption)}</text>'
        + f'<text class="tc-line" x="720" y="420" text-anchor="middle" font-size="30">{esc(spec.slate)}</text>'
        + "</g></svg>"
    )
    return (
        _head(f"Day bars, {spec.day}", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css)
        + f'<div class="frame"><div class="field">{svg}</div></div>\n'
        + _TAIL
    )


# ---- clock (3.9) ------------------------------------------------------------

CLOCK_PIVOT = (960, 456)   # frame pixels: field x 240 + 360 + 360, top 96 + 360
CLOCK_PARTS = frozenset({"base", "hour", "minute", "second"})


def clock_html(spec: ClockSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "",
               parts: frozenset[str] = CLOCK_PARTS, at_zero: bool = False) -> str:
    """The clock. `parts` picks the layers drawn: ``base`` (frame, field,
    dial, ticks, wordmark, date), ``hour``, ``minute``, ``second`` (the
    second hand with the hub over it). Without ``base`` the page is an
    overlay (transparent frame and field). `at_zero` typesets every hand
    drawn at rotate(0), pointing to 12, for the motion pass to rotate."""
    unknown = set(parts) - CLOCK_PARTS
    if unknown:
        raise ValueError(f"unknown clock parts {sorted(unknown)}")
    angles = ({"hour": 0, "minute": 0, "second": 0} if at_zero
              else layout.clock_hand_angles(spec.hour, spec.minute, spec.second))
    svg = ['<svg class="clock" viewBox="-100 -100 200 200" role="img" '
           f'aria-label="Clock at {spec.hour:02d}:{spec.minute:02d}:{spec.second:02d} UTC">']
    if "base" in parts:
        svg.append('<circle class="dial" r="97"/>' + svgparts.clock_ticks_svg())
    if "hour" in parts:
        svg.append(f'<g transform="rotate({angles["hour"]:g})">'
                   '<line class="hand-key" x1="0" y1="10" x2="0" y2="-49.5" stroke-width="10"/>'
                   '<line class="hand" x1="0" y1="10" x2="0" y2="-48" stroke-width="7"/></g>')
    if "minute" in parts:
        svg.append(f'<g transform="rotate({angles["minute"]:g})">'
                   '<line class="hand-key" x1="0" y1="10" x2="0" y2="-79.5" stroke-width="7.5"/>'
                   '<line class="hand" x1="0" y1="10" x2="0" y2="-78" stroke-width="4.5"/></g>')
    if "second" in parts:
        svg.append(f'<g class="sec" transform="rotate({angles["second"]:g})">'
                   '<line class="hand-sec" x1="0" y1="18" x2="0" y2="-86" stroke-width="1.6"/></g>'
                   '<circle class="hub-key" r="6.5" style="fill:var(--o-black)"/>'
                   '<circle class="hub" r="4.5"/>')
    svg.append("</svg>")
    under = ""
    if "base" in parts:
        under = ('<div class="abs wordmark" style="left:0; width:1440px; top:846px; font-size:60px">void omnibus</div>'
                 f'<div class="abs bc-mono clock-date" style="left:0; width:1440px; top:936px; text-align:center; '
                 f'font-size:30px; color:var(--o-grey-2)">{esc(spec.date_line)}</div>')
    return (
        _head(f"Clock, {spec.hour:02d}:{spec.minute:02d}:{spec.second:02d} UTC", tokens_css=tokens_css,
              frame_css=frame_css, graphics_css=graphics_css, body_class="" if "base" in parts else "overlay")
        + '<div class="frame"><div class="field">'
        + f'<div class="abs" style="left:360px; top:96px; width:720px; height:720px">{"".join(svg)}</div>'
        + under
        + "</div></div>\n" + _TAIL
    )


# ---- credits and end board (3.11) ------------------------------------------

def credits_html(spec: CreditsSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
    """One tall strip, top down: a screen of empty field, every line in
    Barlow 600 caps 30 px cream, centred, then a screen of empty field so
    the roll starts and ends clear. Its height is measured in Chromium."""
    lines_html = "".join(f'<p class="credit-line">{esc(line)}</p>' for line in spec.lines)
    return (
        _head("Credits roll", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css,
              html_class="tall")
        + f'<div class="frame"><div class="field"><div class="credits">{lines_html}</div></div></div>\n'
        + _TAIL
    )


def _licence_html(licence: str) -> str:
    """``CC BY-SA 4.0``: words in the caps register, the version numeral
    in Mono (spec 1.2: every numeral)."""
    runs: list[tuple[str, list[str]]] = []
    for word in licence.split(" "):
        cls = "bc-mono" if any(ch.isdigit() for ch in word) else "bc-caps"
        if runs and runs[-1][0] == cls:
            runs[-1][1].append(word)
        else:
            runs.append((cls, [word]))
    return " ".join(f'<span class="{cls}">{esc(" ".join(words))}</span>' for cls, words in runs)


def end_board_html(spec: EndBoardSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
    return (
        _head(f"End board, week {spec.issue}", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css)
        + '<div class="frame"><div class="field">'
        + '<div class="abs sigil-bc" style="left:560px; top:170px; width:320px; height:320px">'
        '<svg style="width:320px;height:320px" viewBox="0 0 24 24" aria-hidden="true">'
        '<circle cx="12" cy="12" r="10.40" stroke-width="1.2"/></svg></div>'
        + '<div class="abs wordmark" style="left:0; width:1440px; top:600px; font-size:124px">void omnibus</div>'
        + '<div class="endline" style="top:800px">'
        + f'<span class="bc-caps">Week</span> <span class="bc-mono">{esc(spec.issue)}</span>'
        + f'<span class="sep">·</span><span class="roman">{esc(spec.roman_year)}</span>'
        + f'<span class="sep">·</span>{_licence_html(spec.licence)}'
        + f'<span class="sep">·</span><span class="bc-mono" style="font-size:28px">{esc(spec.domain)}</span>'
        + "</div></div></div>\n" + _TAIL
    )


# ---- title typed-paper macro (3.2) -----------------------------------------

def title_rows(spec: TitleMacroSpec) -> list[str]:
    """The paper's rows: each verbatim line wrapped at the paper's 69
    columns, then the week line."""
    return layout.wrapped_rows(list(spec.lines), spec.columns) + [spec.week_line]


def title_macro_html(spec: TitleMacroSpec, *, tokens_css: str, frame_css: str, graphics_css: str = "") -> str:
    """The whole macro, every row struck, Plex Mono caps 43 px on a
    full-frame paper ground. The motion pass reveals it character by
    character from this one typeset frame; each row's text sits in its
    own span so its character advances can be measured."""
    rows_html = "".join(
        f'<div class="macro-row" data-row="{i}"><span>{esc(r)}</span></div>' for i, r in enumerate(title_rows(spec))
    )
    return (
        _head("Title, typed-paper macro", tokens_css=tokens_css, frame_css=frame_css, graphics_css=graphics_css,
              body_class="macro")
        + f'<div class="frame"><div class="macro-rows">{rows_html}</div></div>\n'
        + _TAIL
    )
