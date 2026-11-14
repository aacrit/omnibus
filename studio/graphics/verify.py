# Net-new in omnibus (C8, issue 33).
"""Checks a freshly rendered graphics ledger against the committed one (the GitHub Actions draft,
``.github/workflows/episode-draft.yml``): the same ids, and per row the same template sha256, frame count and output
sha256. A row whose output differs is reported, not refused: another machine's Chromium or ffmpeg can change the
bytes of the same drawing, and the run then uploads its own ledger for the founder to read and commit locally.

    python -m studio.graphics.verify release <committed ledger>      # prints the --release flags the ledger records
    python -m studio.graphics.verify compare <committed> <fresh> [--report <file.json>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def release_args(rows: list[dict]) -> list[str]:
    """The renderer's --release flags as the committed ledger's clock rows record them (one release for all)."""
    seen = {(r.get("release"), bool(r.get("release_nominal"))) for r in rows if r.get("release")}
    if len(seen) != 1:
        raise ValueError(f"the ledger records {len(seen)} release times, not one: {sorted(map(str, seen))}")
    release, nominal = seen.pop()
    return ["--release", release] + (["--release-nominal"] if nominal else [])


#: Box and length fields measured off the page, in px. Another machine's font rasteriser moves them by a few px
#: (week 33 on Actions: the Echo lower thirds' wipe boxes 2 to 6 px narrower), never by a moved element.
GEOMETRY_FIELDS = ("wipe_box", "strip_px", "cap_height_px")
GEOMETRY_TOLERANCE_PX = 8.0
#: A change here is content: the drawing's template, or how long it runs.
CONTENT_FIELDS = ("source_template_sha256", "frames")


def _px_delta(x, y) -> float | None:
    """The largest per-number difference between two geometry values, or None when they do not line up."""
    xs = x if isinstance(x, list) else [x]
    ys = y if isinstance(y, list) else [y]
    if len(xs) != len(ys) or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in xs + ys):
        return None
    return max((abs(a - b) for a, b in zip(xs, ys)), default=0.0)


def compare(committed: list[dict], fresh: list[dict], *, tolerance_px: float = GEOMETRY_TOLERANCE_PX) -> dict:
    """Row by row. Blocking: a row only one side has, a content field that differs, or geometry past the tolerance.
    Tolerated (reported): output_sha256, geometry within the tolerance, and any other field (``other``)."""
    a = {r["id"]: r for r in committed}
    b = {r["id"]: r for r in fresh}
    rows = []
    for gid in sorted(set(a) | set(b)):
        x, y = a.get(gid), b.get(gid)
        if x is None or y is None:
            rows.append({"id": gid, "outcome": "only-committed" if y is None else "only-fresh", "blocking": True})
            continue
        content = [k for k in CONTENT_FIELDS if x.get(k) != y.get(k)]
        geometry, geometry_over = {}, []
        for k in GEOMETRY_FIELDS:
            if x.get(k) != y.get(k):
                d = _px_delta(x.get(k), y.get(k))
                geometry[k] = {"committed": x.get(k), "fresh": y.get(k), "max_delta_px": d}
                if d is None or d > tolerance_px:
                    geometry_over.append(k)
        other = sorted(k for k in set(x) | set(y) if k not in ("output_path", "output_sha256", *CONTENT_FIELDS,
                                                               *GEOMETRY_FIELDS) and x.get(k) != y.get(k))
        blocking = bool(content or geometry_over)
        same = not (content or geometry or other) and x.get("output_sha256") == y.get("output_sha256")
        rows.append({"id": gid, "outcome": "matches" if same else "differs", "blocking": blocking,
                     "content": content, "geometry": geometry, "geometry_over_tolerance": geometry_over,
                     "other": other, "output_sha256_differs": x.get("output_sha256") != y.get("output_sha256"),
                     "committed_sha256": x.get("output_sha256"), "fresh_sha256": y.get("output_sha256")})
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
    return {"all_match": all(r["outcome"] == "matches" for r in rows), "ok": not any(r["blocking"] for r in rows),
            "tolerance_px": tolerance_px, "counts": counts, "rows": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.graphics.verify")
    ap.add_argument("mode", choices=["release", "compare"])
    ap.add_argument("committed")
    ap.add_argument("fresh", nargs="?")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    committed = json.loads(Path(a.committed).read_text(encoding="utf-8"))
    if a.mode == "release":
        print(" ".join(release_args(committed)))
        return 0
    if not a.fresh:
        ap.error("compare needs the fresh ledger")
    res = compare(committed, json.loads(Path(a.fresh).read_text(encoding="utf-8")))
    for r in res["rows"]:
        if r["outcome"] != "matches":
            what = ", ".join(r.get("content", []) + [f"{k} {v['max_delta_px']} px" for k, v in r.get("geometry", {}).items()]
                             + r.get("other", []) + (["output_sha256"] if r.get("output_sha256_differs") else []))
            print(f"graphics: {r['id']}: {r['outcome']}{' (BLOCKING)' if r['blocking'] else ''}: {what}")
    if a.report:
        Path(a.report).write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    if not res["ok"]:
        print("graphics: refused: the fresh render's content differs from the committed ledger (a row added or gone, a "
              "template or frame count changed, or geometry past " f"{res['tolerance_px']:g} px); commit the run's "
              "ledger (graphics-ledger-<n> artifact) once the change is intended", file=sys.stderr)
        return 1
    print(f"graphics: {res['counts']}; content matches the committed ledger (bytes and geometry within "
          f"{res['tolerance_px']:g} px tolerated)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
