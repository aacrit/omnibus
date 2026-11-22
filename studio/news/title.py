# Net-new in omnibus (show bible v2, ticket 7).
"""The title's printed and spoken lines, built from the rundown (bible d, o).

The teleprinter title is kept whole (the master, its homographies, the strikes, the bell, the tear, the
lockup): only the words change, and the words are never authored twice. This module is the one place that
turns an ``omnibus.rundown/2`` dict (studio/news/rundown_shape.py's schema) into the title's text:

- ``title_lines``: one line per package in rank order (``f"{rank}  {place:<10} {slug}"``, bible o's own
  formula), then the two fixed segment lines (``AROUND THE WORLD``, ``THE ECHO`` with its year);
- ``week_line``: ``ISSUE {n}   {d1} TO {d2} {MON} {year}   CLOSED {DOW} {d2} {MON} {HH:MM} UTC``, the window
  from the rundown's ``edition`` and the pinned cutoff, printed to the minute (bible d S3: "whatever it
  was"; truncated, never rounded, so a :37 cutoff prints as :17, not :18);
- ``signon``: the sign-on spoken over the lockup (bible d S5), ending on the house tagline's own clause
  (``TAGLINE``, section a), so the tagline is never typed out a second time, word for word, where it could
  drift from the founder's pick.

``recompose(rundown, echo_pick=None)`` is the recompositor (bible d: "If a story is dropped after the title
is composited, the title is recomposited"): the one function a writer or a CI step calls to rebuild a
screenplay's title content after the rundown changes, in well under the two minutes of CPU the bible allows
(it is pure Python; no browser, no ffmpeg). ``studio/news/lints.py``'s ``title-lines-from-rundown`` calls it
to check a screenplay's title part against it; this CLI calls it to show or apply the rebuild:

    python -m studio.news.title episodes/35               # prints the recomposited lines
    python -m studio.news.title episodes/35 --check        # exit 1 if the screenplay's title part disagrees
    python -m studio.news.title episodes/35 --write         # rewrites the screenplay's title part in place

Pure: every function here takes dicts already read from disk and returns text; nothing opens a file except
the CLI's own ``main``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path

RUNDOWN_V2 = "omnibus.rundown/2"
GRAMMAR = "show bible d, o"

PLACE_COL = 10                                  # bible o: f"{rank}  {place:<10} {slug}"
MAX_SLUG_CHARS = 32                              # bible d: at most 32 characters after the place column
MAX_LINE_CHARS = 48                              # bible d: at most 48 characters, whole line
PACKAGE_SLOT_RE = re.compile(r"^package_[1-9]\d*$")
CUTOFF_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$")
ECHO_YEAR_RE = re.compile(r"-(\d{4})$")

BRIEFS_WORD = "AROUND THE WORLD"                 # graphic.BUMPER_WORDS["briefs"]; the segment line carries no rank
ECHO_WORD = "THE ECHO"                           # graphic.BUMPER_WORDS["echo"]
BRIEFS_LINE = f"   {BRIEFS_WORD}"                # bible d: "   AROUND THE WORLD" (confirmed verbatim, issue 35)
TAGLINE = "The week, on the record."             # bible a: the founder's pick, 2026-11-21
# The clause the sign-on (bible d S5) and the sign-off (bible h) both end on, derived once from TAGLINE so
# neither ever carries its own, separately-typed copy of the founder's words.
TAGLINE_CLAUSE = TAGLINE.split(", ", 1)[1]
SIGNON_TEMPLATE = "This is void omnibus. The week of {date}, " + TAGLINE_CLAUSE

_ONES = ("", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_TEENS = ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
_TENS = ("", "", "twenty", "thirty")


def spoken_cardinal(n: int) -> str:
    """A day of the month as the sign-on speaks it (bible d: "sixteen November", a cardinal, never an ordinal
    or a leading zero, military-radio grammar): 1 to 31."""
    if not isinstance(n, int) or isinstance(n, bool) or not (1 <= n <= 31):
        raise ValueError(f"spoken_cardinal: {n!r} is not a day of the month (1 to 31)")
    if n < 10:
        return _ONES[n]
    if n < 20:
        return _TEENS[n - 10]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + ("-" + _ONES[ones] if ones else "")


def rank_line(rank: int, place: str, slug: str) -> str:
    """One package's title line (bible o): rank, two spaces, the place left-justified in ``PLACE_COL``, one
    space, the slug. Raises if the result would break the teleprinter's own budget (bible d): the slug over
    ``MAX_SLUG_CHARS`` after the place column, or the whole line over ``MAX_LINE_CHARS``."""
    place, slug = str(place), str(slug)
    if len(slug) > MAX_SLUG_CHARS:
        raise ValueError(f"rank {rank} ({place!r}): slug {slug!r} is {len(slug)} characters, over the {MAX_SLUG_CHARS} cap")
    line = f"{rank}  {place:<{PLACE_COL}} {slug}"
    if len(line) > MAX_LINE_CHARS:
        raise ValueError(f"rank {rank} ({place!r}): the printed line is {len(line)} characters, over the {MAX_LINE_CHARS} cap")
    return line


def echo_line(year) -> str:
    """The Echo's segment line (bible d): confirmed verbatim against issue 35's screenplay, "   THE ECHO       1945"."""
    return f"   {ECHO_WORD}       {year}"


def packages_in_rank_order(rundown: dict) -> list[dict]:
    """The rundown's ``stories`` with a package slot (``lead`` or ``package_<n>``; briefs are never printed
    individually, bible d), sorted by rank. A story missing ``rank``, ``place`` or ``slug`` is a malformed
    rundown, raised rather than silently skipped (``_guarded`` in lints.py turns that into one failing check,
    not a crash that hides every other lint)."""
    stories = rundown.get("stories")
    if not isinstance(stories, list):
        raise ValueError("rundown.stories is missing or not a list")
    out = []
    for s in stories:
        if not isinstance(s, dict):
            continue
        slot = str(s.get("slot") or "")
        if slot == "lead" or PACKAGE_SLOT_RE.match(slot):
            for key in ("rank", "place", "slug"):
                if s.get(key) in (None, ""):
                    raise ValueError(f"story in slot {slot!r} has no {key}")
            out.append(s)
    return sorted(out, key=lambda s: s["rank"])


def echo_year(rundown: dict, echo_pick: dict | None = None) -> str:
    """The Echo's year, as printed (bible d): the echo pick's own ``year`` (echo-pick.json, the record a
    screenplay names in ``news.echo_pick``) first, then the rundown's own ``echo.year`` when a screenplay
    carries no echo pick, then the trailing ``-<year>`` of the bank id (``yalta-conference-1945``) as a last
    resort, for a bank entry whose id states one. Raises when none of the three does."""
    if isinstance(echo_pick, dict) and echo_pick.get("year") is not None:
        return str(int(echo_pick["year"]))
    echo = rundown.get("echo") if isinstance(rundown.get("echo"), dict) else {}
    if echo.get("year") is not None:
        return str(int(echo["year"]))
    m = ECHO_YEAR_RE.search(str(echo.get("id") or ""))
    if m:
        return m.group(1)
    raise ValueError("the Echo's year is not in the echo pick, the rundown's echo.year, or its bank id's -YYYY suffix")


def title_lines(rundown: dict, echo_pick: dict | None = None) -> list[str]:
    """Every line the teleprinter prints in rank order (bible d S2): one per package, then the two segment
    lines, in the fixed order the bible gives (briefs before the Echo, every week)."""
    lines = [rank_line(s["rank"], s["place"], s["slug"]) for s in packages_in_rank_order(rundown)]
    lines.append(BRIEFS_LINE)
    lines.append(echo_line(echo_year(rundown, echo_pick)))
    return lines


def _parse_date(s: str) -> dt.date:
    try:
        return dt.datetime.strptime(str(s), "%Y-%m-%d").date()
    except (ValueError, TypeError) as e:
        raise ValueError(f"not an ISO date (YYYY-MM-DD): {s!r}") from e


def _parse_cutoff(s: str) -> dt.datetime:
    m = CUTOFF_RE.match(str(s or ""))
    if not m:
        raise ValueError(f"edition.cutoff_utc {s!r} is not news-fields' CUTOFF_RE shape (YYYY-MM-DDTHH:MMZ or ...:SSZ)")
    y, mo, d, h, mi = (int(g) for g in m.groups()[:5])
    return dt.datetime(y, mo, d, h, mi, tzinfo=dt.timezone.utc)   # seconds dropped: the minute prints, never rounded


def _mon(d: dt.date) -> str:
    return d.strftime("%b").upper()


def week_line(rundown: dict) -> str:
    """The week line (bible d S3): ``ISSUE {n}   {d1} TO {d2} {MON} {year}   CLOSED {DOW} {d2} {MON} {HH:MM}
    UTC``. The CLOSED clause is the pinned archive commit's own timestamp, "whatever it was" (bible d): the
    cutoff truncated to the minute, never rounded, so a :37 second cutoff prints as :17, confirmed verbatim
    against issue 35. ``{d1} TO {d2} {MON}`` reads the window's own month when ``to`` crosses into another
    one (the bible's one example never does, so this is this ticket's own extension, not a bible formula)."""
    edition = rundown.get("edition")
    if not isinstance(edition, dict):
        raise ValueError("rundown.edition is missing or not a dict")
    issue = edition.get("issue")
    if issue is None:
        raise ValueError("rundown.edition.issue is missing")
    window = edition.get("window")
    if not isinstance(window, dict) or not window.get("from") or not window.get("to"):
        raise ValueError("rundown.edition.window.from/to is missing")
    d_from, d_to = _parse_date(window["from"]), _parse_date(window["to"])
    cutoff = _parse_cutoff(edition.get("cutoff_utc"))
    span = (f"{d_from.day} TO {d_to.day} {_mon(d_to)} {d_to.year}" if _mon(d_from) == _mon(d_to) and d_from.year == d_to.year
            else f"{d_from.day} {_mon(d_from)} TO {d_to.day} {_mon(d_to)} {d_to.year}")
    closed = f"CLOSED {cutoff.strftime('%a').upper()} {cutoff.day} {_mon(cutoff)} {cutoff.strftime('%H:%M')} UTC"
    return f"ISSUE {issue}   {span}   {closed}"


def signon_line(rundown: dict) -> str:
    """The sign-on (bible d S5), spoken over the lockup: the week's first day, spoken, ending on the house
    tagline's own clause. Confirmed verbatim against issue 35: "This is void omnibus. The week of sixteen
    November, on the record."."""
    edition = rundown.get("edition") if isinstance(rundown.get("edition"), dict) else {}
    window = edition.get("window") if isinstance(edition.get("window"), dict) else {}
    if not window.get("from"):
        raise ValueError("rundown.edition.window.from is missing")
    d_from = _parse_date(window["from"])
    return SIGNON_TEMPLATE.format(date=f"{spoken_cardinal(d_from.day)} {d_from.strftime('%B')}")


def recompose(rundown: dict, echo_pick: dict | None = None) -> dict:
    """The recompositor: the title's whole content, derived from the rundown alone (bible d, o). The one
    source of truth ``title-lines-from-rundown`` checks a screenplay's title part against, and the one a
    writer or a CI step calls to rebuild it after the rundown changes."""
    return {
        "title_lines": title_lines(rundown, echo_pick),
        "week_line": week_line(rundown),
        "signon": signon_line(rundown),
    }


# --------------------------------------------------------------------------
# CLI: read an episode's rundown (and, where named, its echo pick) and a screenplay's title part; show, check
# or write the recomposited content. No part of this module's own functions touch a file.
# --------------------------------------------------------------------------


def _title_part(play: dict) -> dict | None:
    for p in play.get("parts") or []:
        if isinstance(p, dict) and p.get("segment") == "title":
            return p
    return None


def _title_shot(part: dict) -> dict | None:
    for s in part.get("shots") or []:
        if isinstance(s, dict) and isinstance(s.get("shows"), dict) and s["shows"].get("title_lines") is not None:
            return s
    return None


def _signon_line_obj(part: dict) -> dict | None:
    for ln in part.get("lines") or []:
        if isinstance(ln, dict) and ln.get("kind") == "signon":
            return ln
    return None


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.news.title",
                                description="the recompositor: rebuild the title's lines from the rundown")
    ap.add_argument("episode", type=Path, help="the episode folder (its rundown.json, screenplay.json)")
    ap.add_argument("--check", action="store_true", help="exit 1 if the screenplay's title part disagrees")
    ap.add_argument("--write", action="store_true", help="rewrite the screenplay's title part in place")
    a = ap.parse_args(argv)

    rundown = _load(a.episode / "rundown.json")
    if rundown.get("schema") != RUNDOWN_V2:
        print(f"{a.episode}: rundown.json is not {RUNDOWN_V2}; nothing to recompose", file=__import__("sys").stderr)
        return 2
    echo_pick_path = a.episode / "echo-pick.json"
    echo_pick = _load(echo_pick_path) if echo_pick_path.is_file() else None
    want = recompose(rundown, echo_pick)

    screenplay_path = a.episode / "screenplay.json"
    play = _load(screenplay_path)
    part = _title_part(play)
    if part is None:
        print(f"{a.episode}: screenplay.json has no title part", file=__import__("sys").stderr)
        return 2
    shot = _title_shot(part)
    signon = _signon_line_obj(part)

    if a.write:
        if shot is None or signon is None:
            print(f"{a.episode}: nothing to rewrite (no title shot with shows.title_lines, or no signon line)",
                  file=__import__("sys").stderr)
            return 2
        shot["shows"]["title_lines"] = want["title_lines"]
        shot["shows"]["week_line"] = want["week_line"]
        signon["text"] = want["signon"]
        screenplay_path.write_text(json.dumps(play, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{a.episode}: screenplay.json's title part recomposited from rundown.json")
        return 0

    got = {
        "title_lines": (shot or {}).get("shows", {}).get("title_lines"),
        "week_line": (shot or {}).get("shows", {}).get("week_line"),
        "signon": (signon or {}).get("text"),
    }
    agree = got == want
    print(json.dumps({"want": want, "got": got, "agree": agree}, indent=2, ensure_ascii=False))
    if a.check:
        return 0 if agree else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
