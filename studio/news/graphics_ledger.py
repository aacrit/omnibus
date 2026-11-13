# Net-new in omnibus (E9i).
"""E6's graphics ledger read as the engine's graphic items. Pure: no I/O (render.py reads the files and passes them).

E6 (``studio/graphics/ledger.py``) writes ``episodes/<issue>/graphics-ledger.json``: a JSON list, one row per rendered
graphic, every pixel typeset or composited by code::

    {"id", "subtype", "data_ref", "source_template_sha256", "output_path", "output_sha256", "frames", "class": "DRAWN",
     ...extras (hold_s, rows, release, dot_labels, words, ...)}

The engine's graphic kind (studio/news/graphic.py, schema.graphic_problems) needs ``file``, ``fps``, ``frames``,
``alpha``, ``content_date`` with ``content_basis`` (A0), a licence, a credit and ``shows_bodies``. A screenplay names
E6's ledger with ``"format": "e6-graphics"`` in its ledger reference::

    "graphics": {"path": "graphics-ledger.json", "media": "D:/omnibus-media/33/graphics", "format": "e6-graphics"}

and each row becomes an item by these rules (a field the row states itself always wins, so E6 may write any of them):

- ``file``: the bare file name of ``output_path`` (the ledger records a bare name; the media folder is the reference's
  ``media``); ``sha256``: ``output_sha256``; ``frames``: as E6 counted them;
- ``fps``: ``"30"``, E6's one encode rate (``studio/graphics/encode.py`` FPS); ``alpha``: ``"straight"``, since E6
  encodes every layer from RGBA frames to ProRes 4444 with alpha (unassociated);
- ``kind``: ``graphic``; ``subtype``: E6's name in the engine's spelling (SUBTYPES below);
- ``class`` must be DRAWN (a row that is not is refused); ``generator`` names E6; ``shows_bodies``: false (drawn by
  code: no photograph is in a graphic); licence ``CC BY-SA 4.0`` and credit ``void omnibus, drawn by code`` (the
  episode's own licence, show bible f, as the end board prints it);
- ``content_date`` and ``content_basis``: the horizon of what the graphic draws, read from ``data_ref`` against the
  episode's news inputs: the LATEST date any of its ``;``-separated refs reads (a graphic is as late as the latest
  data it draws). ``rundown:<part id>`` or ``rundown:<word> testcard``: that part's ``as_of``, or, when the part is
  dated per beat, its latest beat's; ``rundown:<part id>.beats[<beat id>]``: the beat's own ``date`` or ``as_of``,
  else its part's (E4 dated every rundown entry under A0); ``week:days[i]...``: that day's ``printed_at``; any other
  ``week:`` field: the record's ``as_of``, except ``week:bars`` beside a ``rundown:<word> testcard``, which is the
  bars that card draws, dated by the record field its rundown testcard names (``field``: summed over ``days[i]``, the
  latest day's ``printed_at``; otherwise the record's ``as_of``); ``release`` (the clock, which shows only the programme's airtime): the
  record's ``as_of``. A ref that names no data is skipped (non_data_refs: the Echo test card's decorative
  ``week:bars``, CoS decision). A ``data_ref`` none of these reads (``echo-pick:`` alone: echo-pick holds later
  printings) leaves the item undated, so A0 refuses it if a shot cites it: a date is never guessed.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath, PureWindowsPath

FORMAT = "e6-graphics"
E6 = "studio/graphics (E6)"
FPS = "30"                    # studio/graphics/encode.py FPS
ALPHA = "straight"
LICENCE = "CC BY-SA 4.0"
CREDIT = "void omnibus, drawn by code"
SUBTYPES = {                  # E6's subtype -> the engine's (graphic.SUBTYPES; title_macro is E4b's title macro)
    "testcard": "testcard", "board": "board", "lower-third": "lower_third", "count-card": "count",
    "day-bars": "day", "clock": "clock", "credits": "credits", "end-board": "end_board", "title-macro": "title_macro",
}
TESTCARD_PARTS = {"week": "the-week", "weight": "the-weight", "echo": "the-echo", "margins": "the-margins"}
REQUIRED = ("id", "subtype", "data_ref", "output_path", "output_sha256", "frames", "class")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
_BEAT = re.compile(r"^([\w-]+)\.beats\[([\w-]+)\]")
_DAY = re.compile(r"^days\[(\d+)\]")


def is_e6(ref) -> bool:
    return isinstance(ref, dict) and ref.get("format") == FORMAT


def _iso(v) -> str | None:
    return v if isinstance(v, str) and ISO.match(v.strip()) else None


def _part(rundown: dict, pid: str) -> dict | None:
    return next((p for p in (rundown or {}).get("parts") or [] if isinstance(p, dict) and p.get("id") == pid), None)


def _part_date(part: dict) -> tuple[str | None, str]:
    own = _iso(part.get("as_of"))
    if own:
        return own, f"rundown parts[{part['id']}].as_of"
    beats = [(b.get("as_of"), b.get("id")) for b in part.get("beats") or [] if isinstance(b, dict) and _iso(b.get("as_of"))]
    if beats:
        from studio.news.lints import instant      # pure
        latest = max(beats, key=lambda x: instant(x[0])[1])
        return latest[0], f"rundown parts[{part['id']}], its latest beat ({latest[1]}).as_of"
    return None, ""


def _rundown_date(path: str, rundown: dict) -> tuple[str | None, str]:
    path = path.strip()
    m = re.match(r"^(\w+) testcard\b", path)
    if m and m.group(1) in TESTCARD_PARTS:
        part = _part(rundown, TESTCARD_PARTS[m.group(1)])
        return _part_date(part) if part else (None, "")
    m = _BEAT.match(path)
    if m:
        part = _part(rundown, m.group(1))
        if part is None:
            return None, ""
        beat = next((b for b in part.get("beats") or [] if isinstance(b, dict) and b.get("id") == m.group(2)), None)
        if beat is None:
            return None, ""
        for k in ("date", "as_of"):
            if _iso(beat.get(k)):
                return beat[k], f"rundown parts[{part['id']}].beats[{beat['id']}].{k}"
        return _part_date(part)
    for tok in (t.strip() for t in path.split(",")):       # "title.title_lines, strike"; "voices, credits.disclosures"
        part = _part(rundown, re.split(r"[.\[]", tok)[0])
        if part is not None:
            return _part_date(part)
    return None, ""


def _week_date(path: str, record: dict) -> tuple[str | None, str]:
    m = _DAY.match(path.strip())
    if m:
        days = (record or {}).get("days") or []
        i = int(m.group(1))
        if i < len(days) and _iso((days[i] or {}).get("printed_at")):
            return days[i]["printed_at"], f"the week record's days[{i}].printed_at"
        return None, ""
    v = _iso((record or {}).get("as_of"))
    return (v, "the week record's as_of") if v else (None, "")


def _testcard(refs: list[str], rundown: dict) -> dict | None:
    """The rundown testcard a data_ref's ``rundown:<word> testcard`` names (E6 data.py _find_testcard), or None."""
    for r in refs:
        m = re.match(r"^rundown:(\w+) testcard\b", r)
        if m and m.group(1) in TESTCARD_PARTS:
            part = _part(rundown, TESTCARD_PARTS[m.group(1)]) or {}
            if isinstance(part.get("testcard"), dict):
                return part["testcard"]
            for b in part.get("beats") or []:
                if isinstance(b, dict) and isinstance(b.get("testcard"), dict):
                    return b["testcard"]
    return None


def _bars_date(tc: dict, record: dict) -> tuple[str | None, str]:
    """``week:bars`` on a test card: the bars the card draws, from the record field its rundown testcard names
    (``field``): summed over ``days[i]`` they are as late as the latest day's print; any other field, the record's
    ``as_of``."""
    field = str(tc.get("field") or "")
    if "days[" in field:
        from studio.news.lints import instant      # pure
        days = [(d.get("printed_at"), i) for i, d in enumerate((record or {}).get("days") or [])
                if isinstance(d, dict) and _iso(d.get("printed_at"))]
        if days:
            at, i = max(days, key=lambda x: instant(x[0])[1])
            return at, f"week:bars, the testcard's field {field!r}: its latest day, days[{i}].printed_at"
        return None, ""
    d, how = _week_date("as_of", record)
    return d, (f"week:bars, the testcard's field {field!r}: {how}" if d else "")


def non_data_refs(refs: list[str]) -> set[str]:
    """The refs in a data_ref that name no data the graphic draws. One, by CoS decision (E9i review, 2026-11-13): the
    Echo's test card prints ``week:bars`` beside ``rundown:echo testcard``, but its bars are the grey test pattern
    (spec 3.4; E6 studio/graphics/data.py testcard_spec sets ``bars`` to None for the echo card: "decorative, not
    measured"), so they carry no week data and do not date it; it is dated by the Echo's own horizon. Every card that
    truly draws the week's bars keeps ``week:bars`` and dates by the week."""
    if "rundown:echo testcard" in refs:
        return {"week:bars"}
    return set()


def content_date(data_ref, inputs: dict) -> tuple[str | None, str | None]:
    """(content_date, content_basis) from E6's ``data_ref``: the LATEST date any of its refs reads (a graphic is as
    late as the latest data it draws), or (None, None) when none is read. A ref no rule reads adds nothing; one that
    names no data (non_data_refs) is skipped and named in the basis."""
    from studio.news.lints import instant      # pure
    refs = [r.strip() for r in str(data_ref or "").split(";") if r.strip()]
    rundown, record = inputs.get("rundown") or {}, inputs.get("record") or {}
    skip = non_data_refs(refs)
    found: list[tuple[str, str]] = []
    for r in refs:
        if r in skip:
            continue
        if r.startswith("rundown:"):
            d, how = _rundown_date(r[len("rundown:"):], rundown)
        elif r == "week:bars" and _testcard(refs, rundown) is not None:
            d, how = _bars_date(_testcard(refs, rundown), record)
        elif r.startswith("week:"):
            d, how = _week_date(r[len("week:"):], record)
        elif r == "release":
            d, how = _week_date("as_of", record)
            how = (f"{how} (the clock shows only the programme's airtime, its release, clock-true at release, and "
                   "draws nothing from a later record)") if d else how
        else:
            d, how = None, ""
        if d and instant(d) is not None:
            found.append((d, how))
    if not found:
        return None, None
    d, how = max(found, key=lambda x: instant(x[0])[1])
    extra = f"; {', '.join(sorted(skip))} draws no data (non_data_refs)" if skip else ""
    return d, f"E6 data_ref {data_ref!r}: dated by its latest ref, {how}{extra}"


def file_name(output_path) -> str:
    s = str(output_path or "")
    return (PureWindowsPath(s) if "\\" in s or re.match(r"^[A-Za-z]:", s) else PurePosixPath(s)).name


def row_problems(row) -> list[str]:
    if not isinstance(row, dict):
        return ["a graphics-ledger row is an object"]
    rid = row.get("id", "?")
    out = [f"{rid}: E6's row states {k}" for k in REQUIRED if row.get(k) in (None, "")]
    if row.get("class") not in (None, "DRAWN"):
        out.append(f"{rid}: a graphic is DRAWN, not {row.get('class')!r}")
    if row.get("subtype") not in (None, "") and row["subtype"] not in SUBTYPES and row["subtype"] not in SUBTYPES.values():
        out.append(f"{rid}: E6 subtype {row['subtype']!r} is not one the engine knows ({sorted(SUBTYPES)})")
    if row.get("output_sha256") and not SHA256.match(str(row["output_sha256"])):
        out.append(f"{rid}: output_sha256 is a sha256 (64 hex)")
    f = row.get("frames")
    if f is not None and not (isinstance(f, int) and not isinstance(f, bool) and f > 0):
        out.append(f"{rid}: frames is a whole number above 0")
    return out


def adapt(rows, inputs: dict, *, source: str = "graphics-ledger.json") -> tuple[list[dict], list[str]]:
    """(items, problems): E6's rows as engine items, and why any row cannot be read (that row is left out)."""
    if not isinstance(rows, list):
        return [], [f"{source} is E6's list of rows"]
    items, problems = [], []
    for row in rows:
        p = row_problems(row)
        if p:
            problems += p
            continue
        it = {k: v for k, v in row.items() if k not in ("output_path", "output_sha256", "class", "source_template_sha256")}
        it.update(kind="graphic", subtype=SUBTYPES.get(row["subtype"], row["subtype"]),
                  file=row.get("file") or file_name(row["output_path"]), sha256=row["output_sha256"],
                  source_template_sha256=row.get("source_template_sha256"),
                  derived_from=f"{source}#{row['id']} (E6)")
        it.setdefault("fps", FPS)
        it.setdefault("alpha", ALPHA)
        it.setdefault("generator", E6)
        it.setdefault("shows_bodies", False)
        it.setdefault("licence", LICENCE)
        it.setdefault("credit", CREDIT)
        if row.get("content_date") is None:
            d, basis = content_date(row["data_ref"], inputs)
            if d is not None:
                it["content_date"], it["content_basis"] = d, basis
        items.append(it)
    return items, problems
