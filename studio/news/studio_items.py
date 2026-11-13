# Net-new in omnibus (C8, issue 33).
"""Remakes an episode's studio-ledger items on a machine that has the sources but not the laptop's derived files
(the GitHub Actions runner of ``.github/workflows/episode-draft.yml``), each from the recipe its own ledger row
states, and reports every remade file's sha256 against the ledger's.

The recipes are read from the row, never guessed from its id:

- ``generator: studio.engine.pages`` with a ``spec``: the house typeset pages (``python -m studio.engine.pages``,
  deterministic), run once per spec into the studio media folder.
- ``derived_from: "<rights id> (...), PDF page <n> rasterised at <dpi> dpi by PyMuPDF"``: that page of the rights
  ledger's PDF, rasterised.
- ``derived_from: "<a>.mov then <b>.mov (E6), stream copy"``: the graphics joined by ffmpeg concat, stream copy.
- ``derived_from: "<a>.mov (E6), frame 0"``: that graphic's first frame as a PNG.
- a ``sound`` row cut from the score (``derived_from`` names a score file): the score is made on the laptop (E8,
  ``episodes/<n>/score/build.py``, which needs score-tools and its sample libraries), so it is reported, never made
  here; the engine plays a missing music cue as silence and warns.

A remade file whose sha256 differs from the ledger's is kept for the draft and reported (a different Chromium,
ffmpeg or font rasteriser on Linux changes bytes, not content); the report says so per item, and nothing is ever
written back to a committed ledger.

    python -m studio.news.studio_items episodes/<n> [--report <file.json>] [--dry-run]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from studio.engine import mediaroot as MR

ROOT = Path(__file__).resolve().parents[2]
PDF_PAGE = re.compile(r"^(?P<src>[\w.-]+) .*?PDF page (?P<page>\d+) rasterised at (?P<dpi>\d+) dpi", re.S)
CONCAT = re.compile(r"^(?P<files>[\w.-]+\.mov(?: then [\w.-]+\.mov)+) \(E6\), stream copy")
FIRST = re.compile(r"^(?P<file>[\w.-]+\.mov) \(E6\), frame 0")


def _media(film: Path, ref) -> Path:
    path = film / (ref if isinstance(ref, str) else ref["path"])
    return Path(ref["media"]) if isinstance(ref, dict) and ref.get("media") else path.parent


def plan(film: Path, env=None) -> list[dict]:
    """One row per studio-ledger item: its recipe (None when it is not made here, with why), its inputs and its
    output path under this machine's media root."""
    film = Path(film)
    play = MR.remap_tree(json.loads((film / "screenplay.json").read_text(encoding="utf-8")), env)
    refs = play.get("ledgers") or {}
    if "studio" not in refs:
        return []
    studio_dir = _media(film, refs["studio"])
    rights_dir = _media(film, refs["rights"]) if "rights" in refs else None
    graphics_dir = _media(film, refs["graphics"]) if "graphics" in refs else None
    rights = {}
    if "rights" in refs:
        rp = film / (refs["rights"] if isinstance(refs["rights"], str) else refs["rights"]["path"])
        rights = {i["id"]: i for i in json.loads(rp.read_text(encoding="utf-8")).get("items") or []}
    sp = film / (refs["studio"] if isinstance(refs["studio"], str) else refs["studio"]["path"])
    items = json.loads(sp.read_text(encoding="utf-8")).get("items") or []
    rows = []
    for it in items:
        row = {"id": it["id"], "file": it.get("file"), "ledger_sha256": it.get("sha256"),
               "out": (studio_dir / it["file"]).as_posix() if it.get("file") else None, "recipe": None, "why": None}
        der = str(it.get("derived_from") or "")
        if it.get("generator") == "studio.engine.pages" and it.get("spec"):
            row.update(recipe="pages", spec=it["spec"])
        elif (m := PDF_PAGE.match(der)) and rights_dir is not None and m["src"] in rights:
            row.update(recipe="pdf-page", source=(rights_dir / rights[m["src"]]["file"]).as_posix(),
                       page=int(m["page"]), dpi=int(m["dpi"]))
        elif (m := CONCAT.match(der)) and graphics_dir is not None:
            row.update(recipe="concat", sources=[(graphics_dir / f).as_posix() for f in m["files"].split(" then ")])
        elif (m := FIRST.match(der)) and graphics_dir is not None:
            row.update(recipe="first-frame", source=(graphics_dir / m["file"]).as_posix())
        elif it.get("kind") == "sound" and "score" in der:
            row["why"] = "cut from the score, which the laptop makes (E8); a missing music cue plays as silence"
        else:
            row["why"] = "no recipe this script knows states how the row was made"
        rows.append(row)
    return rows


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise SystemExit("studio_items: ffmpeg is not on PATH")
    return exe


def make(row: dict, film: Path, done_specs: set) -> None:
    out = Path(row["out"])
    out.parent.mkdir(parents=True, exist_ok=True)
    if row["recipe"] == "pages":
        if row["spec"] not in done_specs:
            subprocess.run([sys.executable, "-m", "studio.engine.pages", str(ROOT / row["spec"]), "--out", str(out.parent)],
                           check=True, cwd=ROOT)
            done_specs.add(row["spec"])
    elif row["recipe"] == "pdf-page":
        import fitz  # PyMuPDF, studio/requirements-draft.txt
        with fitz.open(row["source"]) as doc:
            doc[row["page"] - 1].get_pixmap(dpi=row["dpi"]).save(str(out))
    elif row["recipe"] == "concat":
        with tempfile.TemporaryDirectory(prefix="studio-items-") as d:
            lst = Path(d) / "list.txt"
            lst.write_text("".join(f"file '{s}'\n" for s in row["sources"]), encoding="utf-8")
            subprocess.run([_ffmpeg(), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                            str(out)], check=True, stdin=subprocess.DEVNULL)
    elif row["recipe"] == "first-frame":
        subprocess.run([_ffmpeg(), "-v", "error", "-y", "-i", row["source"], "-frames:v", "1", str(out)], check=True,
                       stdin=subprocess.DEVNULL)


def run(film: Path, *, dry_run: bool = False) -> list[dict]:
    rows = plan(film)
    done: set = set()
    for row in rows:
        if row["recipe"] is None:
            row["outcome"] = "not-made"
            continue
        if dry_run:
            row["outcome"] = "planned"
            continue
        try:
            make(row, Path(film), done)
        except (subprocess.CalledProcessError, OSError, RuntimeError, ValueError) as e:
            row.update(outcome="failed", why=f"{type(e).__name__}: {e}")
            continue
        got = sha256(Path(row["out"])) if Path(row["out"]).exists() else None
        row["sha256"] = got
        row["outcome"] = ("missing" if got is None else "matches-ledger" if got == row["ledger_sha256"]
                          else "remade-differs")
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.news.studio_items", description=__doc__.split("\n\n")[0])
    ap.add_argument("film")
    ap.add_argument("--report")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    rows = run(Path(a.film), dry_run=a.dry_run)
    for r in rows:
        print(f"studio_items: {r['id']}: {r['outcome']}" + (f" ({r['why']})" if r.get("why") else ""))
    if a.report:
        Path(a.report).write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
    failed = [r["id"] for r in rows if r["outcome"] in ("failed", "missing")]
    if failed:
        print(f"studio_items: failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
