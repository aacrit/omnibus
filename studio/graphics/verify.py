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


def compare(committed: list[dict], fresh: list[dict]) -> dict:
    a = {r["id"]: r for r in committed}
    b = {r["id"]: r for r in fresh}
    rows = []
    for gid in sorted(set(a) | set(b)):
        x, y = a.get(gid), b.get(gid)
        if x is None or y is None:
            rows.append({"id": gid, "outcome": "only-committed" if y is None else "only-fresh"})
            continue
        diffs = [k for k in ("source_template_sha256", "frames", "output_sha256") if x.get(k) != y.get(k)]
        rows.append({"id": gid, "outcome": "matches" if not diffs else "differs", "fields": diffs,
                     "committed_sha256": x.get("output_sha256"), "fresh_sha256": y.get("output_sha256")})
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
    return {"all_match": all(r["outcome"] == "matches" for r in rows), "counts": counts, "rows": rows}


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
            print(f"graphics: {r['id']}: {r['outcome']} {','.join(r.get('fields') or [])}")
    print(f"graphics: {res['counts']}; " + ("every row matches the committed ledger" if res["all_match"] else
          "the fresh ledger differs: uploaded for a local commit, and this run renders from it"))
    if a.report:
        Path(a.report).write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
