# Net-new in omnibus (C8, issue 33).
"""Checks the finished score the Actions draft mixes (the laptop's E8 takes, published unchanged as the
own-score-<issue> prerelease), before any frame is rendered:

1. every file ``episodes/<n>/score/score.take.json`` lists under ``outputs`` is in the score folder and hashes to the
   sha256 the take records (the score is never re-composed here; the engine reads the finished takes);
2. every music cue the screenplay plays names a WAV that exists on this machine (its path read under
   ``OMNIBUS_MEDIA_ROOT``), so the engine's warn-and-play-silence path for a missing cue is never taken.

Any failure exits 1: the draft never falls back to a silent score.

After the render, ``--journal`` reads the run's journal and requires the founder's silence rules to have run and
passed: ``no-music-under-quote`` (the score is silent under every quote) and ``no-music-under-news``, and no
duck or silence lint failing at block severity.

    python -m studio.news.score_check episodes/<n> [--report <file.json>]
    python -m studio.news.score_check --journal <run journal.jsonl>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from studio.engine import mediaroot as MR


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def music_cues(play: dict) -> list[dict]:
    out = []

    def walk(x):
        if isinstance(x, dict):
            if x.get("kind") == "music" and x.get("wav"):
                out.append(x)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(play)
    return out


def _decoded(p: Path) -> str:
    import soundfile as sf
    from studio.news.studio_items import decoded_sha
    x, rate = sf.read(str(p), dtype="float32", always_2d=False)
    return decoded_sha(x, rate)


def check(film: Path, env=None, sha=_sha, decoded=_decoded, takes_only: bool = False) -> dict:
    film = Path(film)
    take = json.loads((film / "score" / "score.take.json").read_text(encoding="utf-8"))
    score_dir = Path(MR.remap(take["media_dir"], env))
    problems, files = [], []
    for name, rec in (take.get("outputs") or {}).items():
        p = score_dir / name
        want = rec.get("sha256")
        if not want:
            problems.append(f"{name}: score.take.json records no sha256")
            continue
        got = sha(p) if p.is_file() else None
        row = {"file": name, "sha256": got, "ok": got == want}
        files.append(row)
        if got is None:
            problems.append(f"{name}: missing from {score_dir}")
        elif got != want:
            problems.append(f"{name}: sha256 {got[:12]} is not the take's {want[:12]}")
        elif decoded is not None and rec.get("decoded_sha256"):
            row["decoded_sha256"] = d = decoded(p)
            if d != rec["decoded_sha256"]:
                problems.append(f"{name}: decoded samples {d[:12]} are not the take's {rec['decoded_sha256'][:12]}")
    if not take.get("outputs"):
        problems.append("score.take.json lists no outputs")
    play = MR.remap_tree(json.loads((film / "screenplay.json").read_text(encoding="utf-8")), env)
    cues = []
    if takes_only:
        return {"ok": not problems, "score_dir": score_dir.as_posix(), "files": files, "cues": cues, "problems": problems}
    hashed = {(score_dir / n).as_posix().lower() for n, r in (take.get("outputs") or {}).items() if r.get("sha256")}
    for c in music_cues(play):
        wav = Path(c["wav"]) if Path(c["wav"]).is_absolute() else film / c["wav"]
        ok = wav.is_file()
        cues.append({"cue": c.get("id"), "wav": wav.as_posix(), "exists": ok})
        if not ok:
            problems.append(f"music cue {c.get('id')}: {wav.as_posix()} is missing (the draft never plays a silent score)")
        under = wav.as_posix().lower().startswith(score_dir.as_posix().lower().rstrip("/") + "/")
        if under and wav.as_posix().lower() not in hashed:
            problems.append(f"music cue {c.get('id')}: {wav.name} is in the score folder but is not an output "
                            "score.take.json hashes")
    return {"ok": not problems, "score_dir": score_dir.as_posix(), "files": files, "cues": cues, "problems": problems}


REQUIRED_SILENCE = ("no-music-under-quote", "no-music-under-news")


def journal_check(events: list[dict]) -> dict:
    """The silence and duck lints in a render journal's events: each required one present, and every one of its events
    'pass' (anything else, inconclusive and review included, is a problem); and no duck or silence lint failing at
    block severity."""
    lints = [e for e in events if e.get("type") == "lint" or e.get("kind") == "lint" or "rule" in e]
    problems = []
    for rule in REQUIRED_SILENCE:
        got = [e for e in lints if e.get("rule") == rule]
        if not got:
            problems.append(f"{rule} never ran in this render")
        for e in got:
            if e.get("status") != "pass":     # fail, inconclusive, review, or any status this check does not know
                problems.append(f"{rule} is {e.get('status')!r}, not 'pass' ({e.get('unit')})")
    for e in lints:
        r = str(e.get("rule") or "")
        if ("duck" in r or "silence" in r) and e.get("status") == "fail" and e.get("severity") == "block":
            problems.append(f"{r} failed ({e.get('unit')})")
    seen = sorted({str(e.get("rule")) for e in lints if any(k in str(e.get("rule")) for k in ("duck", "silence", "no-music"))})
    return {"ok": not problems, "checked": seen, "problems": problems}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.news.score_check", description=__doc__.split("\n\n")[0])
    ap.add_argument("film", nargs="?")
    ap.add_argument("--report")
    ap.add_argument("--journal")
    ap.add_argument("--takes-only", action="store_true", help="only the takes against score.take.json (before the cuts)")
    a = ap.parse_args(argv)
    if a.journal:
        events = [json.loads(ln) for ln in Path(a.journal).read_text(encoding="utf-8").splitlines() if ln.strip()]
        res = journal_check(events)
        for p in res["problems"]:
            print(f"score_check: refused: {p}", file=sys.stderr)
        print(f"score_check: silence and duck lints checked: {', '.join(res['checked']) or 'none'}")
        return 0 if res["ok"] else 1
    if not a.film:
        ap.error("the film folder, or --journal")
    res = check(Path(a.film), takes_only=a.takes_only)
    if a.report:
        Path(a.report).write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    for p in res["problems"]:
        print(f"score_check: refused: {p}", file=sys.stderr)
    if not res["ok"]:
        return 1
    print(f"score_check: {len(res['files'])} score files match score.take.json; {len(res['cues'])} music cues present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
