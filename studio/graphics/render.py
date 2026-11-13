#!/usr/bin/env python
"""Orchestrator CLI: the one script that opens a browser and shells out
to ffmpeg. Not part of the fast test gate (see `studio/graphics/tests/`
for the pure-Python coverage); run it directly:

    python -m studio.graphics.render week33 --out D:/omnibus-media/33/graphics
    python -m studio.graphics.render regression32 --out D:/omnibus-media/33/graphics/regression-32

`week33` renders the full production set from `episodes/33/rundown.json`
and writes `episodes/33/graphics-ledger.json`. `regression32` renders the
week-32 fixture (`fixtures.py`) and the committed G2 mocks side by side,
reporting a pixel-diff metric per layer (E6 acceptance).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKENS_CSS = str(ROOT / "design" / "tokens.css")
FRAME_CSS = str(ROOT / "design" / "mocks" / "broadcast" / "frame.css")
MOCKS_DIR = ROOT / "design" / "mocks" / "broadcast"

sys.path.insert(0, str(ROOT))

from studio.graphics import clean, compose, countsmatch, data, fixtures, ledger, layout, motion, shoot, typeset  # noqa: E402


def _css() -> dict:
    return {"tokens_css": TOKENS_CSS, "frame_css": FRAME_CSS}


def _shoot_and_check(browser, html: str, *, where: str, expected: dict | None = None,
                      count_selector: str | None = None, box_selector: str | None = None):
    clean.assert_clean(html, where=where)
    text_sel = {"counts": count_selector} if count_selector else None
    box_sel = {"box": box_selector} if box_selector else None
    png, shown, boxes = shoot.shoot_html(browser, html, text_selectors=text_sel, box_selectors=box_sel)
    if expected is not None and count_selector:
        # shown["counts"] is the first match only; callers that need every
        # count read individually pass one call per field instead.
        pass
    return png, shown, boxes


def _ledger_entry(gid: str, subtype: str, data_ref: str, html: str, out_path: Path, frames: int,
                   out_bytes: bytes | None = None):
    return ledger.build_entry(id=gid, subtype=subtype, data_ref=data_ref, template_html=html,
                               output_path=out_path, frames=frames, output_bytes=out_bytes)


def render_week33(out_dir: Path) -> list[ledger.LedgerEntry]:
    week = json.loads((ROOT / "data" / "week-33.json").read_text(encoding="utf-8"))
    rundown = json.loads((ROOT / "episodes" / "33" / "rundown.json").read_text(encoding="utf-8"))
    echo_pick = json.loads((ROOT / "episodes" / "33" / "echo-pick.json").read_text(encoding="utf-8"))
    rights = json.loads((ROOT / "episodes" / "33" / "rights-ledger.json").read_text(encoding="utf-8"))
    issue = week["issue"]
    out_dir.mkdir(parents=True, exist_ok=True)
    entries: list[ledger.LedgerEntry] = []

    with shoot.chromium() as browser:
        # Test cards
        for tc in data.all_testcards(rundown, issue=issue):
            html = typeset.testcard_html(tc, **_css())
            clean.assert_clean(html, where=f"testcard-{tc.subtype}")
            png, shown, _ = shoot.shoot_html(browser, html, text_selectors=None)
            if tc.bars:
                counts_sel = {rung: f'.tc-count[data-rung="{rung}"]' for rung in layout.RUNGS}
                _, shown_counts, _ = shoot.shoot_html(browser, html, text_selectors=counts_sel)
                expected = {rung: v for rung, v in zip(layout.RUNGS, tc.bars)}
                countsmatch.assert_counts_match(expected, shown_counts)
            static = compose.load_rgba(png)
            frames = compose.step_frames(static, hold_frames=round(tc.hold_s * motion.FPS))
            out_path = out_dir / f"testcard-{tc.subtype}.mov"
            from studio.graphics import encode as _encode
            n = _encode.encode_prores(frames, out_path)
            entries.append(_ledger_entry(f"tc-{tc.subtype}", "testcard", f"rundown:the-{tc.subtype if tc.subtype!='weight' else 'weight'}.testcard",
                                          html, out_path, n))

        # Framings board
        board = data.board_spec(rundown, week, issue=issue)
        pages_html = typeset.board_pages_html(board, **_css())
        for i, html in enumerate(pages_html):
            clean.assert_clean(html, where=f"board-page-{i}")
            png, _, _ = shoot.shoot_html(browser, html)
            static = compose.load_rgba(png)
            n_rows = len(layout.paginate_rows(list(board.rows))[i])
            row_boxes = [(144, 168 + j * 175, 1000, 175) for j in range(n_rows)]
            frames = compose.flap_frames(static, row_boxes)
            out_path = out_dir / f"board-page-{i + 1}.mov"
            from studio.graphics import encode as _encode
            n = _encode.encode_prores(frames, out_path)
            entries.append(_ledger_entry(f"board-{i + 1}", "board", "rundown:the-weight.beats[weight-board]",
                                          html, out_path, n))

        # Lower thirds
        for lt in data.lower_thirds(rundown, echo_pick):
            html = typeset.lower_third_html(lt, **_css())
            clean.assert_clean(html, where=lt.id)
            png, _, _ = shoot.shoot_html(browser, html)
            static = compose.load_rgba(png)
            frames = compose.wipe_frames(static)
            frames += compose.step_frames(static, hold_frames=round(3.5 * motion.FPS))
            out_path = out_dir / f"{lt.id}.mov"
            from studio.graphics import encode as _encode
            n = _encode.encode_prores(frames, out_path)
            entries.append(_ledger_entry(lt.id, "lower-third", "rundown:the-echo.beats/echo-pick.period_perspectives",
                                          html, out_path, n))

        # Count cards
        issue_date_line = f"AS OF {week['as_of'][:10]}"
        for cc in data.all_count_cards(rundown, week, issue=issue, date_line=issue_date_line):
            html = typeset.count_card_html(cc, **_css())
            clean.assert_clean(html, where=cc.id)
            counts_sel = {f"row{i}": f'.hero-num[data-row="{i}"]' for i in range(len(cc.rows))}
            png, shown, _ = shoot.shoot_html(browser, html, text_selectors=counts_sel)
            expected = {f"row{i}": row.hero for i, row in enumerate(cc.rows)}
            countsmatch.assert_counts_match(expected, shown)
            static = compose.load_rgba(png)
            frames = compose.step_frames(static, hold_frames=round(3.0 * motion.FPS))
            out_path = out_dir / f"{cc.id}.mov"
            from studio.graphics import encode as _encode
            n = _encode.encode_prores(frames, out_path)
            entries.append(_ledger_entry(cc.id, "count-card", "rundown/week:counts_on_screen", html, out_path, n))

        # Day lean bars
        for i, db in enumerate(data.day_bars(rundown), start=1):
            html = typeset.day_bars_html(db, **_css())
            clean.assert_clean(html, where=f"day-bars-{i}")
            png, _, _ = shoot.shoot_html(browser, html)
            static = compose.load_rgba(png)
            frames = compose.step_frames(static, hold_frames=round(2.0 * motion.FPS))
            out_path = out_dir / f"day-bars-{i}.mov"
            from studio.graphics import encode as _encode
            n = _encode.encode_prores(frames, out_path)
            entries.append(_ledger_entry(f"day-bars-{i}", "day-bars", f"rundown:the-week.beats[week-day-{i}].device",
                                          html, out_path, n))

        # Clock: dial and hands as separate layers
        clk = data.clock_spec(date_line="MON 09 NOV 2026 \u00b7 UTC")
        for layer in ("dial", "hands"):
            html = typeset.clock_layer_html(clk, layer=layer, **_css())
            clean.assert_clean(html, where=f"clock-{layer}")
            png, _, _ = shoot.shoot_html(browser, html)
            static = compose.load_rgba(png)
            if layer == "dial":
                frames = compose.step_frames(static, hold_frames=motion.FPS)
            else:
                angles = layout.sweep_second_angles(clk.second)
                frames = compose.sweep_frames(static, static, angles, pivot=(960, 456))
            out_path = out_dir / f"clock-{layer}.mov"
            from studio.graphics import encode as _encode
            n = _encode.encode_prores(frames, out_path)
            entries.append(_ledger_entry(f"clock-{layer}", "clock", "rundown:clock", html, out_path, n))

        # Credits (one tall strip)
        credits = data.credits_spec(rundown, rights)
        html = typeset.credits_html(credits, **_css())
        clean.assert_clean(html, where="credits")
        png, _, _ = shoot.shoot_html(browser, html, height=max(1080, len(credits.lines) * 54 + 1080))
        strip = compose.load_rgba(png)
        frames = compose.credits_roll_frames(strip, 1080)
        out_path = out_dir / "credits.mov"
        from studio.graphics import encode as _encode
        n = _encode.encode_prores(frames, out_path)
        entries.append(_ledger_entry("credits", "credits", "rundown:credits/rights-ledger", html, out_path, n))

        # End board
        eb = data.end_board_spec(week)
        html = typeset.end_board_html(eb, **_css())
        clean.assert_clean(html, where="end-board")
        png, _, _ = shoot.shoot_html(browser, html)
        static = compose.load_rgba(png)
        frames = compose.step_frames(static, hold_frames=round(4.0 * motion.FPS))
        out_path = out_dir / "end-board.mov"
        from studio.graphics import encode as _encode
        n = _encode.encode_prores(frames, out_path)
        entries.append(_ledger_entry("end-board", "end-board", "data:week.{issue,week_start}", html, out_path, n))

        # Title typed-paper macro
        tm = data.title_macro_spec(rundown)
        full_html = typeset.title_macro_html(tm, **_css())
        clean.assert_clean(full_html, where="title-macro")
        rows = layout.wrapped_rows(list(tm.lines), tm.columns) + [tm.week_line]
        box_sel = {f"row{i}": f".macro-row:nth-child({i + 1})" for i in range(len(rows))}
        png, _, boxes = shoot.shoot_html(browser, full_html, box_selectors=box_sel)
        full_img = compose.load_rgba(png)
        row_boxes = []
        for i in range(len(rows)):
            b = boxes.get(f"row{i}")
            row_boxes.append((round(b["x"]), round(b["y"]), round(b["width"]), round(b["height"])) if b else (0, 0, 0, 0))
        frames = compose.typed_paper_frames(full_img, rows, row_boxes, tm.rate_cps)
        out_path = out_dir / "title-macro.mov"
        from studio.graphics import encode as _encode
        n = _encode.encode_prores(frames, out_path)
        entries.append(ledger.build_entry(id="title-macro", subtype="title-macro", data_ref="rundown:title.title_lines",
                                           template_html=full_html, output_path=out_path, frames=n))

    return entries


def render_regression32(out_dir: Path) -> dict:
    """Shoots each generator layer and its matching committed mock at the
    hold frame (reduced motion = the final state, spec 1.3) and reports a
    pixel-diff metric (mean absolute channel difference, 0..255)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("testcard-week", typeset.testcard_html(fixtures.TESTCARD_WEEK, **_css()), MOCKS_DIR / "testcard-week.html"),
        ("testcard-echo", typeset.testcard_html(fixtures.TESTCARD_ECHO, **_css()), MOCKS_DIR / "testcard-echo.html"),
        ("flap-board", typeset.board_pages_html(fixtures.BOARD, **_css())[0], MOCKS_DIR / "flap-board.html"),
        ("lower-third", typeset.lower_third_html(fixtures.LOWER_THIRD, **_css()), MOCKS_DIR / "lower-third.html"),
        ("count-card", typeset.count_card_html(fixtures.COUNT_CARD, **_css()), MOCKS_DIR / "count-card.html"),
        ("clock", typeset.clock_html(fixtures.CLOCK, **_css()), MOCKS_DIR / "clock.html"),
        ("end-board", typeset.end_board_html(fixtures.END_BOARD, **_css()), MOCKS_DIR / "end-board.html"),
    ]
    results = {}
    with shoot.chromium() as browser:
        for name, gen_html, mock_path in jobs:
            clean.assert_clean(gen_html, where=name)
            gen_png, _, _ = shoot.shoot_html(browser, gen_html, transparent=False)
            # Shot in place (not copied into a temp file): the mock's own
            # stylesheet links are relative to design/mocks/broadcast/.
            mock_png, _, _ = shoot.shoot_path(browser, mock_path, transparent=False)
            (out_dir / f"{name}-generated.png").write_bytes(gen_png)
            (out_dir / f"{name}-mock.png").write_bytes(mock_png)
            import numpy as np
            a = np.asarray(compose.load_rgba(gen_png).convert("RGB"), dtype=np.int16)
            b = np.asarray(compose.load_rgba(mock_png).convert("RGB"), dtype=np.int16)
            diff = float(np.abs(a - b).mean())
            results[name] = diff
    (out_dir / "pixel-diff.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["week33", "regression32"])
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out_dir = Path(args.out)

    if args.mode == "week33":
        entries = render_week33(out_dir)
        ledger_path = ROOT / "episodes" / "33" / "graphics-ledger.json"
        ledger.write_ledger(entries, ledger_path)
        print(f"wrote {len(entries)} entries to {ledger_path}")
        for e in entries:
            print(f"  {e.id:20s} {e.subtype:12s} {e.frames:5d} frames  {e.output_path}")
    else:
        results = render_regression32(out_dir)
        print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
