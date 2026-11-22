# Net-new in omnibus (C8, issue 33): the engine's media roots, configurable by environment.
"""Where the media live on this machine.

An episode's committed JSON names its media where the laptop keeps them, under one root (``D:/omnibus-media``: the
screenplay's ``ledgers.*.media``, its music cues' ``wav``, the voicing manifest's ``media``). The media never enter
git, so a machine that keeps them elsewhere (the GitHub Actions runner of ``.github/workflows/episode-draft.yml``)
says where with ``OMNIBUS_MEDIA_ROOT``; every path under the laptop's root then reads under that root instead, with
the same sub-path. ``OMNIBUS_MEDIA_ROOT_FROM`` names the root being replaced (default ``D:/omnibus-media``).

Unset, nothing changes: ``remap`` returns every value as given, so the laptop's renders read exactly what they did.
Only an absolute path that starts with the replaced root (case-insensitive, either slash) moves; a relative path, a
path under any other root and every non-path string stay as written. Nothing is written back to a committed file.
"""
from __future__ import annotations

import os

DEFAULT_FROM = "D:/omnibus-media"


def _norm(s: str) -> str:
    return s.replace("\\", "/").rstrip("/")


def roots(env=None) -> tuple[str, str] | None:
    """(the replaced root, the root it reads under) normalised to forward slashes, or None when no root is set."""
    env = os.environ if env is None else env
    to = str(env.get("OMNIBUS_MEDIA_ROOT") or "").strip()
    if not to:
        return None
    frm = str(env.get("OMNIBUS_MEDIA_ROOT_FROM") or "").strip() or DEFAULT_FROM
    return _norm(frm), _norm(to)


def remap(value, env=None):
    """``value`` read under this machine's media root: a string under the replaced root gets the new root, with the
    same sub-path (forward slashes); anything else is returned unchanged."""
    if not isinstance(value, str):
        return value
    r = roots(env)
    if r is None:
        return value
    frm, to = r
    s = value.replace("\\", "/")
    low, flow = s.lower(), frm.lower()
    if low.rstrip("/") == flow:
        return to
    if low.startswith(flow + "/"):
        return to + s[len(frm):]
    return value


def remap_tree(doc, env=None):
    """``doc`` (parsed JSON) with every string under the replaced root remapped (``remap``); a new structure, the
    input untouched. Keys are never changed."""
    r = roots(env)
    if r is None:
        return doc

    def walk(x):
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return remap(x, env)

    return walk(doc)


def rights_dir(film, env=None) -> str:
    """T9c: the folder a film's rights-ledger media live in on this machine: its screenplay's ``ledgers.rights.media``
    read under this machine's root, else the rights ledger's own folder (the engine's load_ledgers reading)."""
    import json
    from pathlib import Path
    film = Path(film)
    ref = (json.loads((film / "screenplay.json").read_text(encoding="utf-8")).get("ledgers") or {}).get("rights")
    if isinstance(ref, dict) and ref.get("media"):
        media = _norm(remap(ref["media"], env))
        absolute = media.startswith("/") or (len(media) > 1 and media[1] == ":")    # POSIX or a drive, on any OS
        return media if absolute else _norm(str(film / media))
    path = film / (ref if isinstance(ref, str) else (ref or {}).get("path", "rights-ledger.json"))
    return _norm(str(path.parent))


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == "rights-dir":
        print(rights_dir(sys.argv[2]))
        raise SystemExit(0)
    print("usage: python -m studio.engine.mediaroot rights-dir <film>", file=sys.stderr)
    raise SystemExit(2)
