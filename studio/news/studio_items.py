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
- ``derived_from: "<score>.wav (E8, score.take.json), cut at the cue's bed_in_s"``: the finished score's file (the
  laptop's E8 take, placed from the own-score-<issue> release and checked by ``studio.news.score_check``), cut from
  the cue's ``bed_in_s`` (required: a cue without one is refused) for the cue's length, sample-exact, and proved by
  the decoded sha256 of the cut against the source's samples at that offset. The score is never re-composed here.

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
SCORE_CUT = re.compile(r"^(?P<src>\S+\.wav) \(E8, score\.take\.json\), cut at the cue's bed_in_s")


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
    from studio.news.score_check import music_cues
    cues = {c["ledger_item"]: c for c in music_cues(play) if c.get("ledger_item")}
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
        elif m := SCORE_CUT.match(der):
            cue = cues.get(it["id"])
            if cue is None or not isinstance(cue.get("bed_in_s"), (int, float)) or isinstance(cue.get("bed_in_s"), bool):
                row.update(recipe="score-cut", refuse="no music cue names this item with a numeric bed_in_s: the cut "
                                                      "point is never guessed")
            else:
                row.update(recipe="score-cut", source=MR.remap(m["src"], env), start_s=float(cue["bed_in_s"]),
                           dur_s=round(float(cue["end_s"]) - float(cue["start_s"]), 6))
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
        import pymupdf  # studio/requirements-draft.txt
        with pymupdf.open(row["source"]) as doc:
            doc[row["page"] - 1].get_pixmap(dpi=row["dpi"]).save(str(out))
    elif row["recipe"] == "concat":
        with tempfile.TemporaryDirectory(prefix="studio-items-") as d:
            lst = Path(d) / "list.txt"
            lst.write_text("".join(f"file '{s}'\n" for s in row["sources"]), encoding="utf-8")
            subprocess.run([_ffmpeg(), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                            str(out)], check=True, stdin=subprocess.DEVNULL)
    elif row["recipe"] == "score-cut":
        # the finished score's bed (own-score-<issue>, checked by score_check), cut where the cue enters it: the
        # same samples the laptop's span holds, never re-composed
        if not Path(row["source"]).is_file():
            raise FileNotFoundError(f"{row['source']}: the score is not on this machine (own-score release)")
        row.update(score_cut(Path(row["source"]), out, row["start_s"], row["dur_s"]))
    elif row["recipe"] == "first-frame":
        subprocess.run([_ffmpeg(), "-v", "error", "-y", "-i", row["source"], "-frames:v", "1", str(out)], check=True,
                       stdin=subprocess.DEVNULL)


def decoded_sha(x, rate: int) -> str:
    """The score's decoded hash, as episodes/<n>/score/build.py records it in score.take.json (``decoded_sha256``):
    sha256 of "<rate>:1:" and the mono samples as float32."""
    import numpy as np
    return hashlib.sha256(f"{rate}:1:".encode() + np.ascontiguousarray(np.asarray(x, dtype=np.float32)).tobytes()).hexdigest()


def score_cut(src: Path, out: Path, start_s: float, dur_s: float) -> dict:
    """Cuts ``dur_s`` from ``start_s`` of a checked score WAV, sample-exact (soundfile, integers in and out, PCM 24-bit,
    so no sample is re-quantised), and proves it: the cut, read back, must hold exactly the source's samples at that
    offset (their decoded sha256, the score.take.json measure). Raises ValueError otherwise."""
    import soundfile as sf
    x, rate = sf.read(str(src), dtype="int32", always_2d=False)
    a = int(round(start_s * rate))
    n = int(round(dur_s * rate))
    if a < 0 or n <= 0 or a + n > len(x):
        raise ValueError(f"{src.name}: a cut of {n} samples at {a} runs past its {len(x)} samples")
    seg = x[a:a + n]
    sf.write(str(out), seg, rate, subtype="PCM_24")
    expected = decoded_sha(sf.read(str(src), dtype="float32", always_2d=False, start=a, stop=a + n)[0], rate)
    back, r2 = sf.read(str(out), dtype="float32", always_2d=False)
    got = decoded_sha(back, r2)
    if r2 != rate or len(back) != n or got != expected:
        raise ValueError(f"{out.name}: its samples (decoded {got[:12]}) are not the source's {n} at {a} ({expected[:12]})")
    return {"decoded_sha256": got, "expected_decoded_sha256": expected, "samples": n, "start_sample": a}


def run(film: Path, *, dry_run: bool = False) -> list[dict]:
    rows = plan(film)
    done: set = set()
    for row in rows:
        if row.get("refuse"):
            row.update(outcome="failed", why=row["refuse"])
            continue
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
