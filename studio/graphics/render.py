#!/usr/bin/env python
"""Orchestrator CLI: the one script that opens a browser and shells out
to ffmpeg. Not part of the fast test gate (the pure-Python coverage is in
`studio/tests/test_graphics_*.py`); it needs `studio/requirements-graphics.txt`
and `playwright install chromium`. Run it directly:

    python -m studio.graphics.render week33 --out D:/omnibus-media/33/graphics \\
        --release 2026-11-16T21:00:00Z --release-nominal
    python -m studio.graphics.render regression32 --out D:/omnibus-media/33/graphics/regression-32
    python -m studio.graphics.render framesheet --out <reports dir>

`week33` renders the production set from `episodes/33/rundown.json`,
reading every number it checks back from `data/week-33.json`, and writes
`episodes/33/graphics-ledger.json`. `--release` (the airtime the clock
sweeps to) is required; `--release-nominal` marks a pre-release pass whose
clock is not yet clock-true, and the ledger records it so. `regression32`
shoots the week-32 fixture against the committed G2 mocks and fails any
layer over its pixel-diff threshold. `framesheet` decodes the first,
middle and last frame of every ledgered .mov and sheets them over a
checker.
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
    clean, compose, countsmatch, data, encode, expected, fixtures, framesheet, layout, ledger, motion, shoot, typeset,
)

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

    def session(self, template: str, *, where: str, transparent: bool = False, **kw):
        clean.assert_clean(template, where=where)
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
                        static = compose.load_rgba(shot.screenshot())
                        break
            frames = (f for seq in (compose.wipe_frames(static, box), compose.step_frames(static, frames_for(3.5)))
                      for f in seq)
            run.emit(lt.id, "lower-third", f"rundown:the-echo.beats[{lt.id[3:]}]; echo-pick", t, frames,
                     extra={"dot_labels": list(lt.dot_labels), "wipe_box": list(box), "compact": compact})

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
        credits = data.credits_spec(rundown, rights)
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


def render_framesheet(ledger_path: Path, out_dir: Path, *, per_page: int = 5) -> list[Path]:
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
        framesheet.sheet(rows[p:p + per_page]).save(path)
        pages.append(path)
    return pages


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["week33", "regression32", "framesheet"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--release", help="the airtime the clock sweeps to, ISO UTC (required for week33)")
    ap.add_argument("--release-nominal", action="store_true",
                    help="a pre-release pass: the release time is nominal, not yet clock-true")
    args = ap.parse_args()
    out_dir = Path(args.out)

    if args.mode == "week33":
        if not args.release:
            ap.error("week33 needs --release (the clock is drawn to the true release time, spec 3.9)")
        entries = render_week33(out_dir, release=args.release, release_nominal=args.release_nominal)
        ledger.write_ledger(entries, LEDGER_PATH)
        print(f"wrote {len(entries)} entries to {LEDGER_PATH}")
    elif args.mode == "regression32":
        print(json.dumps(render_regression32(out_dir), indent=2))
    else:
        for p in render_framesheet(LEDGER_PATH, out_dir):
            print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
