#!/usr/bin/env python
"""Orchestrator CLI: the one script that opens a browser and shells out
to ffmpeg. Not part of the fast test gate (the pure-Python coverage is in
`studio/tests/test_graphics_*.py`); it needs `studio/requirements-graphics.txt`
and `playwright install chromium`. Run it directly:

    python -m studio.graphics.render week33 --out D:/omnibus-media/33/graphics \\
        --release 2026-11-16T21:00:00Z --release-nominal
    python -m studio.graphics.render week900 --out D:/omnibus-media/900/graphics --fixture
    python -m studio.graphics.render week<N> --out <dir>    # a v2 episode: episodes/<n>/screenplay.json
    python -m studio.graphics.render regression32 --out D:/omnibus-media/33/graphics/regression-32
    python -m studio.graphics.render framesheet --out <reports dir> [--issue <n>]

`week33` renders the production set from `episodes/33/rundown.json`,
reading every number it checks back from `data/week-33.json`, and writes
`episodes/33/graphics-ledger.json`. `--release` (the airtime the clock
sweeps to) is required; `--release-nominal` marks a pre-release pass whose
clock is not yet clock-true, and the ledger records it so.

`week<N>`, N other than 33 (show bible v2, ticket 4): reads
`episodes/<n>/screenplay.json` as a v2 episode (`render_episode`) and
writes `episodes/<n>/graphics-ledger.json`. `--fixture` renders
`fixtures.EPISODE_V2_FIXTURE` instead (the ticket-4 graphics fixture,
committed at `episodes/900/screenplay.json` for exactly this: a v2
episode to dispatch episode-draft.yml against before issue 35's own
screenplay exists). `render_week33` stays the v1 entry point by name
(not literally removed, so the frozen regression path is never put at
risk by a rename); `render_episode` is the new, generic one every v2
issue - and, eventually, the real one - renders through.

`regression32` shoots the week-32 fixture against the committed G2 mocks
and fails any layer over its pixel-diff threshold. `framesheet` decodes
the first, middle and last frame of every ledgered .mov (of `--issue`,
default 33) and sheets them over a checker.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MOCKS_DIR = ROOT / "design" / "mocks" / "broadcast"
STYLESHEETS = {
    "tokens_css": ROOT / "design" / "tokens.css",
    "frame_css": MOCKS_DIR / "frame.css",
    "graphics_css": Path(__file__).resolve().parent / "graphics.css",
}
# Pages are built with these placeholders, hashed for the ledger, and only
# then given this machine's paths: the template hash is machine-independent.
PLACEHOLDERS = {k: f"@@{k.upper()}@@" for k in STYLESHEETS}

sys.path.insert(0, str(ROOT))

from studio.graphics import (  # noqa: E402
    clean, compose, contrast, countsmatch, data, encode, expected, fixtures, framesheet, layout, ledger, motion, shoot,
    typeset,
)
from studio.news import graphic as G  # noqa: E402

FPS = motion.FPS
ACTION_SAFE_RIGHT = 1920 - 96   # 16:9 action-safe (5%): a lower third sits over full-bleed picture
LEDGER_PATH = ROOT / "episodes" / "33" / "graphics-ledger.json"

# Week-32 regression: mean absolute per-channel difference (0..255) each
# layer may show against its G2 mock (docs/DECISIONS.md, E6 review fixes).
# 0.05 is about one channel step on 2% of the frame: font hinting noise,
# never a moved, missing or recoloured element.
REGRESSION_THRESHOLDS = {
    "testcard-week": 0.05,
    "testcard-echo": 0.05,
    "flap-board": 0.05,
    "lower-third": 0.05,
    "count-card": 0.05,
    "clock": 0.05,
    "end-board": 0.05,
}
# Review-only copy in a mock that no broadcast layer carries, measured from
# the mock's own DOM and left out of the comparison (the lower third's
# "PD still slot" caption: a real lower third sits over a picture).
REGRESSION_EXCLUDE = {"lower-third": [".slot-label"]}


def inject(template: str) -> str:
    html = template
    for key, placeholder in PLACEHOLDERS.items():
        html = html.replace(placeholder, STYLESHEETS[key].resolve().as_uri())
    return html


def frames_for(seconds: float) -> int:
    return max(1, round(seconds * FPS))


class Run:
    def __init__(self, browser, out_dir: Path):
        self.browser = browser
        self.out_dir = out_dir
        self.entries: list[ledger.LedgerEntry] = []

    def session(self, template: str, *, where: str, transparent: bool = False, check_bias: bool = False, **kw):
        clean.assert_clean(template, where=where)
        clean.assert_no_internal_ids(template, where=where)
        if check_bias:
            # bumper-no-bars (show bible v2, section o): every v2 layer passes this; v1's test card and board
            # legitimately draw the lean spectrum, so this is opt-in, never the shared default.
            clean.assert_no_bias_tokens(template, where=where)
        return shoot.session_html(self.browser, inject(template), transparent=transparent, **kw)

    def emit(self, gid: str, subtype: str, data_ref: str, template: str, frames, *, extra: dict | None = None):
        out_path = self.out_dir / f"{gid}.mov"
        n = encode.encode_prores(frames, out_path)
        self.entries.append(ledger.build_entry(id=gid, subtype=subtype, data_ref=data_ref, template_html=template,
                                               output_path=out_path, frames=n, extra=extra))
        print(f"  {gid:18s} {subtype:12s} {n:5d} frames", flush=True)


def _check(expected_values: list, shown: list, *, where: str) -> None:
    exp = {f"{where}[{i}]": v for i, v in enumerate(expected_values)}
    got = {f"{where}[{i}]": v for i, v in enumerate(shown)}
    if len(shown) != len(expected_values):
        raise countsmatch.CountsMismatch([f"{where}: record has {len(expected_values)} numerals, page shows {len(shown)}"])
    countsmatch.assert_counts_match(exp, got)


def render_week33(out_dir: Path, *, release: str, release_nominal: bool) -> list[ledger.LedgerEntry]:
    load = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))  # noqa: E731
    week = load("data/week-33.json")
    rundown = load("episodes/33/rundown.json")
    echo_pick = load("episodes/33/echo-pick.json")
    rights = load("episodes/33/rights-ledger.json")
    issue = week["issue"]
    clock = data.clock_spec_for_release(data.parse_release(release), nominal=release_nominal)
    rung_labels = layout.load_lean_label_text()
    out_dir.mkdir(parents=True, exist_ok=True)
    PH = PLACEHOLDERS

    with shoot.chromium() as browser:
        run = Run(browser, out_dir)

        # ---- test cards --------------------------------------------------
        for tc in data.all_testcards(rundown, issue=issue):
            t = typeset.testcard_html(tc, **PH)
            with run.session(t, where=f"testcard-{tc.subtype}") as shot:
                if tc.bars:
                    shown = [shot.text(f'.tc-count[data-rung="{r}"]') for r in layout.RUNGS]
                    _check(expected.testcard_bars(week, tc.subtype), shown, where=f"testcard-{tc.subtype} bars")
                    cap = expected.testcard_caption_counts(week, tc.subtype)
                    _check(list(cap.values()), expected.numerals_in(shot.text('[data-count="caption"]')),
                           where=f"testcard-{tc.subtype} caption")
                png = shot.screenshot()
            run.emit(f"testcard-{tc.subtype}", "testcard", f"rundown:{tc.subtype} testcard; week:bars", t,
                     compose.step_frames(compose.load_rgba(png), frames_for(tc.hold_s)))

        # ---- framings board ----------------------------------------------
        board = data.board_spec(rundown, week, issue=issue, rung_labels=rung_labels)
        shown_rows: list[tuple[str, str]] = []
        for i, (rows, untitled) in enumerate(typeset.board_pages(board)):
            kw = dict(head_left=board.head_left, head_right=board.head_right, page_index=i, untitled=untitled,
                      rung_labels=rung_labels, **PH)
            t = typeset.board_page_html(rows, **kw)
            t_base = typeset.board_page_html(rows, rows_hidden=True, **kw)
            with run.session(t, where=f"board-{i + 1}") as shot:
                n_rows = shot.count(".brow")
                boxes = [(shot.box(f'.brow[data-row="{j}"] .flap-block'), shot.box(f'.brow[data-row="{j}"] .outlet'))
                         for j in range(n_rows)]
                for j, row in enumerate(rows):
                    shown_rows.append((row.rung, shot.text(f'.brow[data-row="{j}"] .outlet')))
                for rung, names in untitled.items():
                    got = shot.texts(".untitled-line .outlet")
                    if got != names:
                        raise countsmatch.CountsMismatch([f"board-{i + 1}: untitled {rung} shows {got}, record {names}"])
                    ubox = shot.box(".untitled-line .outlet")
                    mark_x = 240 + 144 + layout.rung_center_x(layout.RUNGS.index(rung))
                    if abs(ubox[0] + ubox[2] / 2 - mark_x) > 1.5:
                        raise ValueError(f"board-{i + 1}: {names} is not centred under its {rung} rung mark")
                for card, outlet in boxes:
                    if card[0] < 240 + 144 or card[0] + card[2] > 240 + 1296 or card[1] + card[3] > 868:
                        raise ValueError(f"board-{i + 1}: row card {card} leaves the title-safe rows area")
                full = compose.load_rgba(shot.screenshot())
            with run.session(t_base, where=f"board-{i + 1}-base") as shot:
                base = compose.load_rgba(shot.screenshot())
            hold = frames_for(3.0 * len(rows))
            run.emit(f"board-page-{i + 1}", "board", "rundown:the-weight.beats[weight-board]; week:lead.board", t,
                     compose.flap_frames(base, full, boxes, hold_frames=hold),
                     extra={"rows": len(rows), "untitled": untitled, "hold_s": hold / FPS})
        want_rows = expected.board_rows(week)
        if shown_rows != want_rows:
            raise countsmatch.CountsMismatch([f"board rows {shown_rows} != week lead.board {want_rows}"])

        # ---- lower thirds --------------------------------------------------
        for lt in data.lower_thirds(rundown, echo_pick):
            # Two self-heal passes, each measured for real: move the dot
            # label above the rule first (cheapest, least visible change);
            # if a long place name alone still crosses action-safe (spec
            # 3.5), redraw tier 1/2 at the compact face
            # (typeset.lower_third_html(..., compact=True)) and remeasure.
            # Only raise once both have been tried.
            for compact in (False, True):
                t = typeset.lower_third_html(lt, compact=compact, **PH)
                with run.session(t, where=lt.id, transparent=True) as shot:
                    box = shot.union_box(".lt")
                    if box[0] + box[2] > ACTION_SAFE_RIGHT:
                        shot.evaluate("document.querySelector('.lt-dot-label').classList.add('above')")
                        shoot._settle(shot.page)
                        box = shot.union_box(".lt")
                    fits = box[0] + box[2] <= ACTION_SAFE_RIGHT
                    if fits or compact:
                        if not fits:
                            raise ValueError(f"{lt.id}: lower third ends at x {box[0] + box[2]}, "
                                              f"past action-safe {ACTION_SAFE_RIGHT}")
                        label = shot.text(".lt-dot-label")
                        if label != " · ".join(lt.dot_labels):
                            raise ValueError(f"{lt.id}: dot label {label!r}")
                        styles = shot.evaluate("""() => { const cs = getComputedStyle(document.querySelector('.lt-dot-label'));
                            return [cs.color, cs.backgroundColor]; }""")
                        dot_contrast = contrast.label_contrast(*styles)
                        if not dot_contrast["ok"]:
                            raise ValueError(f"{lt.id}: dot label contrast {dot_contrast['by_plate']} is under "
                                             f"{contrast.AA}:1 over the bright or the dark plate")
                        static = compose.load_rgba(shot.screenshot())
                        break
            frames = (f for seq in (compose.wipe_frames(static, box), compose.step_frames(static, frames_for(3.5)))
                      for f in seq)
            run.emit(lt.id, "lower-third", f"rundown:the-echo.beats[{lt.id[3:]}]; echo-pick", t, frames,
                     extra={"dot_labels": list(lt.dot_labels), "wipe_box": list(box), "compact": compact,
                            "dot_label_contrast": dot_contrast["by_plate"]})

        # ---- count cards ---------------------------------------------------
        weight_date = data.as_of_line(week["as_of"])
        for cc in data.all_count_cards(rundown, week, echo_pick, issue=issue):
            t = typeset.count_card_html(cc, **PH)
            with run.session(t, where=cc.id) as shot:
                heroes, contexts = shot.texts(".hero-num"), shot.texts(".context")
                shown = [n for h, c in zip(heroes, contexts) for n in expected.numerals_in(h) + expected.numerals_in(c)]
                _check(expected.count_card_numbers(week, echo_pick, cc.id), shown, where=cc.id)
                date_shown = shot.text(".count-date")
                if cc.id != "cw-4" and date_shown != weight_date:
                    raise ValueError(f"{cc.id}: date line {date_shown!r} != {weight_date!r}")
                png = shot.screenshot()
            hold = frames_for(cc.hold_s)
            run.emit(cc.id, "count-card", "week:lead.claim" if cc.id != "cw-4" else "echo-pick:counts_on_screen", t,
                     compose.step_frames(compose.load_rgba(png), hold),
                     extra={"words": cc.words, "hold_s": round(hold / FPS, 3)})

        # ---- day lean bars ---------------------------------------------------
        for i, db in enumerate(data.day_bars(rundown), start=1):
            if list(db.bars) != list(expected.resolve(week, db.bars_field)):
                raise countsmatch.CountsMismatch([f"day-bars-{i}: rundown bars {db.bars} != week {db.bars_field}"])
            t = typeset.day_bars_html(db, **PH)
            with run.session(t, where=f"day-bars-{i}") as shot:
                _check([expected.day_bar_placed(week, db.bars_field)],
                       expected.numerals_in(shot.text('[data-count="caption"]')), where=f"day-bars-{i} caption")
                png = shot.screenshot()
            run.emit(f"day-bars-{i}", "day-bars", f"week:{db.bars_field}", t,
                     compose.step_frames(compose.load_rgba(png), frames_for(2.0)))

        # ---- clock: dial layer and a separate second-hand layer ------------
        angles = layout.sweep_hand_angles(clock.hour, clock.minute, clock.second)
        seconds = layout.sweep_second_angles(clock.second)
        if [a["second"] for a in angles] != [round(s, 4) for s in seconds] or seconds[180] != 0:
            raise ValueError("the second hand's sweep does not end at 12 on frame 180")
        layers = {}
        for name, parts in (("base", {"base"}), ("hour", {"hour"}), ("minute", {"minute"}), ("second", {"second"})):
            t = typeset.clock_html(clock, parts=frozenset(parts), at_zero=True, **PH)
            with run.session(t, where=f"clock-{name}", transparent=(name != "base")) as shot:
                if name == "base" and shot.text(".clock-date") != clock.date_line:
                    raise ValueError(f"clock date line {shot.text('.clock-date')!r} != {clock.date_line!r}")
                layers[name] = (t, compose.load_rgba(shot.screenshot()))
        extra = {"release": clock.release, "release_nominal": clock.release_nominal, "airtime_frame": 180}
        run.emit("clock-dial", "clock", "release", layers["base"][0],
                 compose.clock_dial_frames(layers["base"][1], layers["hour"][1], layers["minute"][1], angles,
                                           typeset.CLOCK_PIVOT), extra=extra)
        run.emit("clock-second-hand", "clock", "release", layers["second"][0],
                 compose.second_hand_frames(layers["second"][1], seconds, typeset.CLOCK_PIVOT), extra=extra)

        # ---- credits: one tall strip, measured, rolled 3 px a frame --------
        credits = data.credits_spec(rundown, rights, week)
        t = typeset.credits_html(credits, **PH)
        with run.session(t, where="credits") as shot:
            if shot.texts(".credit-line") != list(credits.lines):
                raise ValueError("credits: the strip's lines differ from the spec's")
            height = math.ceil(shot.evaluate("document.querySelector('.frame').getBoundingClientRect().height"))
            if height > 16000:
                raise ValueError(f"credits strip {height} px is too tall to shoot in one piece")
            shot.page.set_viewport_size({"width": 1920, "height": height})
            shoot._settle(shot.page)
            strip = compose.load_rgba(shot.screenshot())
        if strip.height != height:
            raise ValueError(f"credits strip shot {strip.height} px, measured {height} px")
        run.emit("credits", "credits",
                 "rights-ledger:items[].credit, items[].disclosure; rundown:voices, credits.disclosures", t,
                 compose.credits_roll_frames(strip, 1080), extra={"strip_px": height, "lines": len(credits.lines)})

        # ---- end board -------------------------------------------------------
        eb = data.end_board_spec(week)
        t = typeset.end_board_html(eb, **PH)
        with run.session(t, where="end-board") as shot:
            line = shot.text(".endline")
            if "CC BY-SA 4.0" not in line or str(week["issue"]) not in line:
                raise ValueError(f"end board line {line!r}")
            png = shot.screenshot()
        run.emit("end-board", "end-board", "week:issue, week_start", t,
                 compose.step_frames(compose.load_rgba(png), frames_for(4.0)))

        # ---- title typed-paper macro ----------------------------------------
        tm = data.title_macro_spec(rundown)
        rows = typeset.title_rows(tm)
        t = typeset.title_macro_html(tm, **PH)
        with run.session(t, where="title-macro") as shot:
            if not shot.evaluate("document.fonts.check('43px \"IBM Plex Mono\"')"):
                raise RuntimeError("IBM Plex Mono did not load for the title macro")
            cap = shot.evaluate("""() => { const el = document.querySelector('.macro-row span');
                const cs = getComputedStyle(el); const c = document.createElement('canvas').getContext('2d');
                c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
                return c.measureText('H').actualBoundingBoxAscent; }""")
            if cap < 28:
                raise ValueError(f"title macro cap height {cap:.1f} px is under 28 px at 1080p")
            shown = [shot.text(f'.macro-row[data-row="{i}"] span') for i in range(len(rows))]
            if shown != rows:
                raise ValueError("title macro rows are not verbatim")
            _check(expected.title_source_counts(week),
                   [m for r in shown for m in re.findall(r"^\w{3} \d\d \w{3}\s+(\d+) SRC", r)],
                   where="title SRC")
            boxes, advances = [], []
            for i in range(len(rows)):
                rx, ry, rw, rh = shot.box(f'.macro-row[data-row="{i}"]')
                sx, _, sw, _ = shot.box(f'.macro-row[data-row="{i}"] span')
                boxes.append((sx, ry, sw, rh))
                advances.append(shot.char_right_edges(f'.macro-row[data-row="{i}"] span'))
            full = compose.load_rgba(shot.screenshot())
        run.emit("title-macro", "title-macro", "rundown:title.title_lines, strike", t,
                 compose.typed_paper_frames(full, rows, boxes, advances, tm.rate_cps, total_s=tm.print_window_s),
                 extra={"rate_cps": tm.rate_cps, "platen_ms": 60, "cap_height_px": round(cap, 1),
                        "print_window_s": tm.print_window_s})

    return run.entries


# ===========================================================================
# v2 (show bible v2, ticket 4): a generic graphics driver.
# render_week33 above is V1 ONLY (frozen, issue 33) and unchanged.
# ===========================================================================

def graphics_shots(rundown: dict) -> list[dict]:
    """Every v2 graphic a screenplay's (or any screenplay-shaped dict's) parts carry, in document order: a
    part's `shots` (full-frame, `graphic.OVERLAY_SUBTYPES` excluded) and its `text` elements (the overlay
    subtypes), each tagged with its part id and segment, and whether it is the part's first shot (a bumper is
    the first shot of the segment it opens; schema.graphic_problems checks the same thing on the screenplay
    side). Pure: no browser, no filesystem; `render_episode` is the only caller that needs either."""
    out = []
    for part in rundown.get("parts") or []:
        if not isinstance(part, dict):
            continue
        part_id, segment = part.get("id"), part.get("segment")
        for i, shot in enumerate(part.get("shots") or []):
            if G.is_graphic(shot):
                out.append({"shot": shot, "part_id": part_id, "segment": segment, "overlay": False, "first": i == 0})
        for text_el in part.get("text") or []:
            if G.is_graphic(text_el):
                out.append({"shot": text_el, "part_id": part_id, "segment": segment, "overlay": True, "first": False})
    return out


#: Subtypes this ticket draws for v2. Every other v2 subtype (clock, count, lower_third's speaker/slate
#: variants, page, credits, end_board) is "kept" per bible i, but wiring it into `render_episode` is a later
#: ticket's job (it needs the rundown/2 normaliser's own data shapes, ticket 2); `render_episode` raises rather
#: than silently skipping one, so a screenplay that names one is never quietly left un-rendered.
V2_SUBTYPES_DRAWN = ("bumper", "locator", "sot_super", "brief_strip")


def _render_bumper(run: "Run", g: dict, PH: dict) -> None:
    shot, gid = g["shot"], g["shot"]["id"]
    spec = data.bumper_spec(shot, segment=g["segment"])
    t = typeset.bumper_html(spec, **PH)
    hold_s = float(shot.get("dur_s") or 1.8)
    with run.session(t, where=gid, check_bias=True) as page:
        png = page.screenshot()
    run.emit(gid, "bumper", f"shows.lines[{g['segment']}]", t,
             compose.step_frames(compose.load_rgba(png), frames_for(hold_s)),
             extra={"segment": spec.segment, "word": spec.word})


def _render_locator(run: "Run", g: dict, PH: dict) -> None:
    shot, gid = g["shot"], g["shot"]["id"]
    spec = data.locator_spec(shot)
    t = typeset.locator_html(spec, **PH)
    hold_s = float(shot.get("dur_s") or 4.0)
    push_start, push_end = spec.push_s
    if push_end > hold_s:
        raise ValueError(f"{gid}: the rostrum push ends at {push_end} s, past the shot's {hold_s} s hold")
    with run.session(t, where=gid, check_bias=True) as page:
        png = page.screenshot()
    run.emit(gid, "locator", "shot.locator", t,
             compose.rostrum_frames(compose.load_rgba(png), hold_s=hold_s, push_start_s=push_start,
                                     push_end_s=push_end),
             extra={"places": [p.name for p in spec.places], "scale_km": spec.scale_km, "push_s": list(spec.push_s)})


def _render_sot_super(run: "Run", g: dict, PH: dict) -> None:
    shot, gid = g["shot"], g["shot"]["id"]
    spec = data.sot_super_spec(shot)
    t = typeset.sot_super_html(spec, **PH)
    hold_s = float(shot["end_s"]) - float(shot["start_s"])
    if hold_s <= 0:
        raise ValueError(f"{gid}: end_s must be after start_s")
    with run.session(t, where=gid, transparent=True, check_bias=True) as page:
        box = page.union_box(".ss")
        static = compose.load_rgba(page.screenshot())
    wipe = list(compose.wipe_frames(static, box))
    hold_frames = max(frames_for(hold_s) - len(wipe), 1)
    frames = (f for seq in (wipe, compose.step_frames(static, hold_frames)) for f in seq)
    run.emit(gid, "sot_super", "shows.lines", t, frames, extra={"wipe_box": list(box)})


def _render_brief_strip(run: "Run", g: dict, PH: dict) -> None:
    shot, gid = g["shot"], g["shot"]["id"]
    spec = data.brief_strip_spec(shot)
    t = typeset.brief_strip_html(spec, **PH)
    hold_s = float(shot["end_s"]) - float(shot["start_s"])
    if hold_s <= 0:
        raise ValueError(f"{gid}: end_s must be after start_s")
    with run.session(t, where=gid, transparent=True, check_bias=True) as page:
        png = page.screenshot()
    run.emit(gid, "brief_strip", "shows.lines", t,
             compose.step_frames(compose.load_rgba(png), frames_for(hold_s)))


V2_RENDERERS = {"bumper": _render_bumper, "locator": _render_locator, "sot_super": _render_sot_super,
                "brief_strip": _render_brief_strip}


def render_episode(rundown: dict, out_dir: Path) -> list[ledger.LedgerEntry]:
    """Show bible v2, ticket 4: the generic driver, in place of a per-week function. Drives its graphics list
    straight from `rundown` (a v2 screenplay - episodes/<n>/screenplay.json - or anything shaped like one:
    `graphics_shots` just walks `parts`), typesets and shoots each with Chromium, applies its motion preset
    (bumper and brief_strip hold; locator pushes with `rostrum`; sot_super wipes on then holds), and returns one
    ledger entry per graphic. A subtype not in `V2_RENDERERS` raises `NotImplementedError`, naming it, rather
    than being silently skipped."""
    out_dir.mkdir(parents=True, exist_ok=True)
    PH = PLACEHOLDERS
    with shoot.chromium() as browser:
        run = Run(browser, out_dir)
        for g in graphics_shots(rundown):
            subtype = g["shot"].get("subtype")
            fn = V2_RENDERERS.get(subtype)
            if fn is None:
                raise NotImplementedError(
                    f"render_episode does not yet draw subtype {subtype!r} (ticket 4 covers "
                    f"{', '.join(V2_SUBTYPES_DRAWN)}; the rest are kept per bible i but wait on their own ticket)")
            if not g["shot"].get("id"):
                raise ValueError(f"a {subtype} graphic in part {g['part_id']!r} has no id")
            fn(run, g, PH)
    return run.entries


def render_regression32(out_dir: Path) -> dict:
    """Shoots each generator layer and its committed G2 mock at the hold
    frame (reduced motion = the final state, spec 1.3), reports the mean
    absolute channel difference (0..255) and raises if any layer is over
    its threshold."""
    out_dir.mkdir(parents=True, exist_ok=True)
    PH = PLACEHOLDERS
    jobs = [
        ("testcard-week", typeset.testcard_html(fixtures.TESTCARD_WEEK, **PH), "testcard-week.html"),
        ("testcard-echo", typeset.testcard_html(fixtures.TESTCARD_ECHO, **PH), "testcard-echo.html"),
        ("flap-board", typeset.board_pages_html(fixtures.BOARD, **PH)[0], "flap-board.html"),
        ("lower-third", typeset.lower_third_html(fixtures.LOWER_THIRD, over_slot=True, **PH), "lower-third.html"),
        ("count-card", typeset.count_card_html(fixtures.COUNT_CARD, **PH), "count-card.html"),
        ("clock", typeset.clock_html(fixtures.CLOCK, **PH), "clock.html"),
        ("end-board", typeset.end_board_html(fixtures.END_BOARD, **PH), "end-board.html"),
    ]
    results, over = {}, []
    with shoot.chromium() as browser:
        for name, template, mock in jobs:
            clean.assert_clean(template, where=name)
            gen_png = shoot.shoot_html(browser, inject(template), transparent=False)
            with shoot.session_path(browser, MOCKS_DIR / mock, transparent=False) as shot:
                exclude = [shot.box(sel) for sel in REGRESSION_EXCLUDE.get(name, [])]
                mock_png = shot.screenshot()
            (out_dir / f"{name}-generated.png").write_bytes(gen_png)
            (out_dir / f"{name}-mock.png").write_bytes(mock_png)
            a, b = compose.load_rgba(gen_png), compose.load_rgba(mock_png)
            raw = round(compose.mean_abs_diff(a, b), 4)
            diff = round(compose.mean_abs_diff(a, b, exclude=exclude), 4)
            results[name] = {"diff": diff, "threshold": REGRESSION_THRESHOLDS[name], "raw_diff": raw,
                             "excluded": [list(e) for e in exclude]}
            if diff > REGRESSION_THRESHOLDS[name]:
                over.append(f"{name} {diff} > {REGRESSION_THRESHOLDS[name]}")
    (out_dir / "pixel-diff.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    if over:
        raise SystemExit("week-32 regression over threshold: " + "; ".join(over))
    return results


def render_framesheet(ledger_path: Path, out_dir: Path, *, per_page: int = 3) -> list[Path]:
    import tempfile
    from PIL import Image
    entries = ledger.read_ledger(ledger_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    with tempfile.TemporaryDirectory(prefix="omnibus-sheet-") as tmp:
        for e in entries:
            n = e["frames"]
            frames = []
            for caption, idx in (("first", 0), ("middle", n // 2), ("last", n - 1)):
                png = Path(tmp) / f"{e['id']}-{idx}.png"
                encode.extract_frame(e["output_path"], idx, png)
                with Image.open(png) as im:
                    frames.append((f"{caption} (frame {idx} of {n})", im.convert("RGBA")))
            rows.append((f"{e['id']}  {e['subtype']}  {n} frames", frames))
    pages = []
    for p in range(0, len(rows), per_page):
        path = out_dir / f"frame-sheet-{p // per_page + 1:02d}.png"
        framesheet.sheet(rows[p:p + per_page], plates=contrast.PLATES).save(path)
        pages.append(path)
    return pages


WEEK_RE = re.compile(r"^week(\d+)$")


def _ledger_path_for(issue: int) -> Path:
    return ROOT / "episodes" / str(issue) / "graphics-ledger.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", help="'week<N>' (33: the frozen v1 set; any other N: a v2 episode), 'regression32' "
                                 "or 'framesheet'")
    ap.add_argument("--out", required=True)
    ap.add_argument("--release", help="the airtime the clock sweeps to, ISO UTC (required for week33 only)")
    ap.add_argument("--release-nominal", action="store_true",
                    help="a pre-release pass: the release time is nominal, not yet clock-true")
    ap.add_argument("--fixture", action="store_true",
                    help="with 'week<N>' (N != 33): render fixtures.EPISODE_V2_FIXTURE instead of "
                        "episodes/<n>/screenplay.json")
    ap.add_argument("--issue", type=int, default=33, help="with 'framesheet': which episode's ledger to sheet")
    args = ap.parse_args()
    out_dir = Path(args.out)

    m = WEEK_RE.match(args.mode)
    if m:
        issue = int(m.group(1))
        if issue == 33:
            if not args.release:
                ap.error("week33 needs --release (the clock is drawn to the true release time, spec 3.9)")
            entries = render_week33(out_dir, release=args.release, release_nominal=args.release_nominal)
            path = LEDGER_PATH
        else:
            if args.fixture:
                rundown = fixtures.EPISODE_V2_FIXTURE
            else:
                sp = ROOT / "episodes" / str(issue) / "screenplay.json"
                if not sp.is_file():
                    ap.error(f"no v2 screenplay at {sp}; pass --fixture to render the ticket-4 graphics fixture")
                rundown = json.loads(sp.read_text(encoding="utf-8"))
            entries = render_episode(rundown, out_dir)
            path = _ledger_path_for(issue)
        ledger.write_ledger(entries, path)
        print(f"wrote {len(entries)} entries to {path}")
    elif args.mode == "regression32":
        print(json.dumps(render_regression32(out_dir), indent=2))
    elif args.mode == "framesheet":
        for p in render_framesheet(_ledger_path_for(args.issue), out_dir):
            print(p)
    else:
        ap.error(f"unknown mode {args.mode!r} (week<N>, regression32, framesheet)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
