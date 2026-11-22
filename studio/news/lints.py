# Net-new in omnibus (E3).
"""The programme's blocking lints (show bible v2, section o), for an omnibus screenplay.

    python -m studio.news.lints <film dir> [--json]

``render.build_plan`` journals every check ``checks`` returns for a screenplay whose show is omnibus (with each voice
line's measured length), so a render refuses on any blocking failure; the command runs the same checks read-only (a
line with no WAV yet is timed by its ``dur_s``, else at 150 words a minute). Each check is
``{rule, ok, unit, severity, evidence, grammar}``, the shape studio/engine/aswas.py returns.

The rules, each over the screenplay and the inputs it names (``news``: the week record, the rundown and the echo
pick; studio/news/schema.py):

Which part is which comes from the checked order (schema.segments), never from a part's own label or kind: only
the first part labelled clock and the last labelled credits are exempt where the rules exempt them, and a part whose
label is out of the spine's order is linted as news. The spine is the screenplay's (schema.spine): v2's, or v1's for
the frozen issue 33 (V1 ONLY paths below read The Week's day parts and the board, which only issue 33 has).

- ``as-of`` (part level): everything a part shows or says is dated on or before its horizon (its own ``as_of``,
  clamped to the episode's), to the second when both state a time: each shot's and each graphic overlay's ledger
  item (a studio-made item by its ``content_date``), each graphic's record data (every field under its ``data_ref``
  whose key is a date key, ``date`` or ends ``_date``, ``_at`` or ``_on``; a value that does not read is undated),
  each reading's date (a reader line's own, else its extract's), each quoted card's source date, and no year after
  the horizon in its narration or text. A date-time with no zone is every instant it can be in the world's zones,
  never UTC. A whole-day date on the horizon's own day is a review item; a part's horizon is an instant or a day
  before the episode's, never after it or a whole day straddling it.
- ``picture_published_by_edition`` (founder ruling A, 2026-11-13): a news part's picture (a shot's or overlay's
  ledger item with a ``published_at``) is public by the part's horizon; in The Week only (V1 ONLY, until ticket 6's
  ``picture-in-week``), a picture of the day's own
  event (its ``date`` on or before the day's horizon) may be published by the edition cutoff (the episode's
  ``as_of``) instead, and then its ledger item and the shot both carry the dot label ``FILMED {date} · PUBLISHED
  {date}``. Facts and narration stay at the day's horizon (``as-of``).
- ``never-tell`` and ``hindsight-language``: the bible's news list (studio/news/lexicon.json) on the narration and
  our own on-screen text, quotations exempt; and (V1 ONLY: no v2 graphic is a board) no narration line paraphrases a
  headline the board on screen shows.
- ``no-outlet-characterisation``: no characterising word next to an outlet's name (in any case) or a media noun (a
  legal status the screenplay states, with its basis, aside).
- ``no-bridge``: none of the week's named persons, places and parties-as-actors (the rundown's Echo ``no_bridge``
  list, refused when empty; founder ruling 2026-11-12: full names, word boundaries; the 1952 party names are
  allowed) in anything the Echo says or shows, quotations included, read after Unicode NFKC and whitespace folding,
  as written or in capitals, with a single listed word's demonyms and derived forms and a listed place's period
  spellings (CoS ruling under the founder's narrow rule); and no bridging phrase ("like today", "just as") anywhere.
  The reverse direction (no Echo-era entity in a news part) is declared ``not_implemented`` with its reason.
- ``counts-match``: every figure an element declares (``figures`` on a card or text element, ``shows.figures`` on a
  graphic) equals its record field, and every count its on-screen text states (numerals and written-out numbers; a
  date's own day, month and year aside) is one of its own declared figures.
- ``quote-verbatim``: every reader line's text hashes to its ``quote_sha256``, and that hash is an extract the
  rundown or the echo pick records; every displayed headline hashes to its ``headline_sha256``, a hash the record
  holds; and our own text that reproduces a record headline carries its ``headline_sha256``.
- ``dot-label-carried`` (S4 review round 3): every shot of a ledger item that names a ``dot_label`` (a sourcing
  pass's: another place or day than the line names, or a montage dated only by its upload day, "WHITE HOUSE VIDEO ·
  PUBLISHED 6 NOV 2026") carries that label's text as its own ``dot_label``; ruling A's label is checked by
  ``picture_published_by_edition``.
- ``no-music-under-news``: no music cue over a news part (the spine's news segments: v2's tease, lead, packages and
  briefs).
- ``no-music-under-quote`` (founder ruling): no music cue under any reader line.
- ``fair-use-refused`` (bible o, replacing ``fair-use-excerpt`` and ``fair-use-on-timeline``): no shot, overlay, cue
  or clip whose ledger item rests on fair use (its licence class, a ``fair_use`` record, or a basis citing it).
- ``narration-ceiling``: at most 55% of the runtime voiced.
- ``voice-disclosed``: the narrator and every reader voice state a credit naming the synthesised or computer voice,
  and their dot label; a reader line that names no voice fails.
- ``tour-window-inside``: every window of a filled still's authored camera path lies inside the picture (z 1 or
  more) and off its ledger item's no-tour bands; the picture's size comes from the ledger, never the file.
- ``total of`` in a figure's field sums every number under it (a week's bars to its placed total).
- ``black-share``: black on screen (a black shot, a black card, a card that draws only its text with none) is at
  most 3% of the runtime, and each states its reason.

A lint that cannot read its inputs fails its rule with the reason; it never crashes the run.

Killed by bible v2 (DIED, for every screenplay, issue 33 included): ``board-rule``, ``tour-no-claim-before-board``,
``ladder-labels-derived``, ``ending-question``, ``fair-use-excerpt``, ``fair-use-on-timeline``,
``title-lines-verbatim``. Their replacements that are not ``fair-use-refused`` (``title-lines-from-rundown`` and the
rest of section o's new table) land with tickets 3, 4, 6 and 7.

Declared here and run later (``not_implemented`` until then): ``clock-true``, ``sources-last``, ``no-youtube`` (the
release step), ``no-bridge-reverse`` (the echo pick's entity list).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path

from studio.engine import aswas as AW
from studio.engine import score as SCORE
from studio.news import graphic as G
from studio.news import schema as SC

REPO = Path(__file__).resolve().parents[2]
LEXICON_PATH = Path(__file__).resolve().parent / "lexicon.json"
LADDER_PATH = REPO / "web" / "src" / "lib" / "ladder.mjs"
GRAMMAR = "show bible j"
NARRATION_CEILING = 0.55
BLACK_SHARE_MAX = 0.03
VOICED_KINDS = ("narration", "testimony", *SC.LINE_KINDS)   # v1's engine kinds (issue 33) and v2's (bible o)
ECHO_BED_GAP_S = 2.0                  # bible j/h (ticket 3): the Echo's bed ends at least this long before sign-off
EST_WPM = 150.0                       # a line with no WAV and no dur_s is timed at the narrator's rate (rundown voices)
OVERLAP_EPS = 1.0 / 60.0              # under half a frame at 30 fps is not an overlap
PARAPHRASE_SHARE, PARAPHRASE_MIN_WORDS = 0.6, 3
BLACK_REASON_MIN_WORDS = 4
VOICE_CREDIT = re.compile(r"computer voice|synthesi[sz]ed", re.I)
DOT_LABELS = {"narrator": "synthesised voice", "reader": "computer voice"}   # bible g
DATE_KEYS = ("printed_at", "published_at", "record_date", "printed_on", "date", "as_of", "content_date")
STOP = set("the a an and or of to in on at for from with by as is was were be been are it its this that these those "
           "after before over under into than then their his her they he she we our you your not no".split())
DEFERRED = {      # rule: (where it runs, what it checks and why it cannot run here)
    "clock-true": ("release", "the clock's time equals the release timestamp within one second: known only when the "
                              "release is cut"),
    "sources-last": ("release", "the sources page is published before the episode: checked by the release step"),
    "no-youtube": ("release", "no YouTube upload while the registry row's audit_passed is false: checked by the "
                              "release step"),
    "no-bridge-reverse": ("the echo pick's entity list (E5)", "the bible's other direction: no person, place or event "
                          "of the Echo's period named in a news part. It needs the Echo's own named entities as data, "
                          "which the echo pick does not yet record (it lists this week's names to keep out of the "
                          "Echo, not the Echo's names to keep out of the week); until it does, the reviewer reads the "
                          "news parts for it"),
}


def _check(rule, ok, *, unit=None, severity="block", evidence=None) -> dict:
    return {"rule": rule, "ok": bool(ok), "unit": unit, "severity": severity, "evidence": evidence, "grammar": GRAMMAR}


def _summary(rule: str, found: list[dict], checked: int) -> list[dict]:
    if any(not c["ok"] and c["severity"] == "block" for c in found):
        return found
    return found + [_check(rule, True, evidence={"checked": checked})]


@lru_cache(maxsize=4)
def lexicon(path: str | None = None) -> dict:
    return json.loads(Path(path or LEXICON_PATH).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def rungs() -> tuple[str, ...]:
    """The ladder's seven rungs, far left first, read from the one copy (web/src/lib/ladder.mjs), never retyped."""
    text = LADDER_PATH.read_text(encoding="utf-8")
    block = re.search(r"LEAN_BASELINES\s*=\s*\[(.*?)\];", text, re.S)
    names = tuple(re.findall(r'\["([a-z-]+)",\s*\d+\]', block.group(1))) if block else ()
    if len(names) != 7:
        raise ValueError(f"{LADDER_PATH}: LEAN_BASELINES does not read as seven rungs ({names})")
    return names


def sha256_text(text: str) -> str:
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------


def _resolve_path(ref: str, film: Path | None) -> Path:
    p = Path(ref)
    if p.is_absolute():
        return p
    if film is not None and (film / p).exists():
        return film / p
    return REPO / p


def load_inputs(play: dict, film: Path | None = None) -> tuple[dict, list[str]]:
    """The inputs the screenplay's ``news`` names, read: {record, rundown, echo}, and what could not be read."""
    news = play.get("news") if isinstance(play.get("news"), dict) else {}
    out, problems = {"record": None, "rundown": None, "echo": None}, []
    for key, name, required in (("week", "record", True), ("rundown", "rundown", True), ("echo_pick", "echo", False)):
        ref = news.get(key)
        if not ref:
            if required:
                problems.append(f"news.{key} is not named")
            continue
        path = _resolve_path(str(ref), film)
        try:
            out[name] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            problems.append(f"news.{key} ({path}) cannot be read: {e}")
    return out, problems


# --------------------------------------------------------------------------
# Time: every date is an interval of instants (UTC); a date-time is one instant
# --------------------------------------------------------------------------

UTC = dt.timezone.utc


# A clock time with no zone is local somewhere between UTC-12 and UTC+14: as UTC, 14 h before it to 12 h after
ZONE_EARLIEST, ZONE_LATEST = dt.timedelta(hours=14), dt.timedelta(hours=12)


def instant(value):
    """``(lo, hi, precise)``: a date-time with its zone as one instant; a date-time with no zone as every instant it
    can be in the world's zones (never read as UTC: imprecise, so it fails against any horizon it may pass); a date
    as its whole UTC day; anything aswas.parse_date reads (a year, a month, "before 1948") as its span. None when
    unread."""
    if isinstance(value, bool) or value is None:
        return None
    s = str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", s):
        try:
            t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
        if t.tzinfo is None:
            u = t.replace(tzinfo=UTC)
            return u - ZONE_EARLIEST, u + ZONE_LATEST, False
        return t.astimezone(UTC), t.astimezone(UTC), True
    span = AW.parse_date(value)
    if span is None:
        return None
    lo = dt.datetime.combine(span[0], dt.time.min, UTC)
    hi = dt.datetime.combine(span[1], dt.time.max, UTC)
    return lo, hi, False


def against(date, horizon) -> str:
    """``ok`` (all of it on or before the horizon), ``after``, ``same-day`` (a whole day straddling an instant
    horizon on that day: a review item) or ``imprecise`` (any other straddle)."""
    if date[1] <= horizon[1]:
        return "ok"
    if date[0] > horizon[1]:
        return "after"
    if not date[2] and horizon[2] and date[0] <= horizon[1] and (date[1] - date[0]) <= dt.timedelta(days=1):
        return "same-day"
    return "imprecise"


def _fmt(span) -> str:
    return span[1].isoformat() if span[2] else f"{span[0].date().isoformat()}..{span[1].date().isoformat()}"


# --------------------------------------------------------------------------
# Record fields: "days[0].lead.source_count", "sum of days[i].lead.buckets", "echo:counts_on_screen[0].values.Truman"
# --------------------------------------------------------------------------

_TOKEN = re.compile(r"\.?([A-Za-z_][\w-]*)|\[(\d+|i)\]")


class FieldError(ValueError):
    pass


def _walk(x, tokens):
    if not tokens:
        return x, False
    (name, idx), rest = tokens[0], tokens[1:]
    if name:
        if not isinstance(x, dict) or name not in x:
            raise FieldError(f"no field {name!r}")
        return _walk(x[name], rest)
    if not isinstance(x, list):
        raise FieldError("not a list")
    if idx == "i":
        return [_walk(y, rest)[0] for y in x], True
    k = int(idx)
    if k >= len(x):
        raise FieldError(f"index {k} past the list's {len(x)}")
    return _walk(x[k], rest)


def resolve(field: str, inputs: dict):
    """The value a figure's ``field`` names in the week record (``echo:`` for the echo pick)."""
    f = str(field).strip()
    grand = f.startswith("total of ")
    if grand:
        f = f[len("total of "):].strip()
    total = f.startswith("sum of ")
    if total:
        f = f[len("sum of "):].strip()
    src = inputs.get("record")
    if f.startswith("echo:"):
        src, f = inputs.get("echo"), f[len("echo:"):]
    if src is None:
        raise FieldError("its input is not loaded")
    pos, tokens = 0, []
    for m in _TOKEN.finditer(f):
        if m.start() != pos:
            raise FieldError(f"cannot read {field!r}")
        tokens.append((m.group(1), m.group(2)))
        pos = m.end()
    if pos != len(f) or not tokens:
        raise FieldError(f"cannot read {field!r}")
    v, mapped = _walk(src, tokens)
    if grand:
        flat = list(_numbers_in(v))
        if not flat:
            raise FieldError(f"'total of' finds no numbers at {field!r}")
        return sum(flat)
    if not total:
        return v
    if mapped and v and all(isinstance(y, list) for y in v):
        n = {len(y) for y in v}
        if len(n) != 1:
            raise FieldError("rows of different lengths")
        return [sum(col) for col in zip(*v)]
    if isinstance(v, list) and all(_is_num(y) for y in v):
        return sum(v)
    raise FieldError(f"'sum of' needs numbers or rows of numbers at {field!r}")


def _numbers_in(x):
    if _is_num(x):
        yield x
    elif isinstance(x, list):
        for y in x:
            yield from _numbers_in(y)


def _is_num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


NUMERAL = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])")


def numerals(text: str) -> list[float]:
    """Every numeral in a string (thousands commas read; "22:16" is 22 and 16)."""
    out = []
    for m in NUMERAL.finditer(str(text)):
        tok = m.group(0).rstrip(",")
        try:
            out.append(float(tok.replace(",", "")))
        except ValueError:
            continue
    return out


def is_date_key(k) -> bool:
    """A record field that holds a date: the named keys, ``date``, and any key ending ``_date``, ``_at`` or ``_on``."""
    return isinstance(k, str) and (k in DATE_KEYS or k.endswith(("_date", "_at", "_on")))


def _dates_under(x) -> list:
    """Every (key, value) under a date key, whatever the value: one that does not read as a date is undated."""
    out = []
    if isinstance(x, dict):
        for k, v in x.items():
            if is_date_key(k):
                out.append((k, v))
            else:
                out += _dates_under(v)
    elif isinstance(x, list):
        for v in x:
            out += _dates_under(v)
    return out


# --------------------------------------------------------------------------
# The screenplay, read
# --------------------------------------------------------------------------


def shot_dur(s: dict) -> float:
    if s.get("kind") == "archive_video" and s.get("out_s") is not None and s.get("in_s") is not None:
        return float(s["out_s"]) - float(s["in_s"])
    return float(s.get("dur_s") or 0.0)


def part_span(p: dict) -> tuple[float, float] | None:
    """The part's time on screen: its shots', else (a part with no shots of its own) its lines' and text's."""
    shots = p.get("shots") or []
    if shots:
        return (min(float(s.get("start_s") or 0.0) for s in shots),
                max(float(s.get("start_s") or 0.0) + shot_dur(s) for s in shots))
    spans = [(float(x["start_s"]), float(x["start_s"]) + float(x.get("dur_s") or 0.0)) for x in p.get("lines") or []
             if x.get("start_s") is not None]
    spans += [(float(x["start_s"]), float(x["end_s"])) for x in p.get("text") or []
              if x.get("start_s") is not None and x.get("end_s") is not None]
    return (min(a for a, _ in spans), max(b for _, b in spans)) if spans else None


def runtime(play: dict) -> float:
    ends = [float(s.get("start_s") or 0.0) + shot_dur(s) for p in play.get("parts") or [] for s in p.get("shots") or []]
    return max(ends) if ends else 0.0


def line_dur(ln: dict, durations: dict | None) -> tuple[float, str]:
    if durations and ln.get("id") in durations:
        return float(durations[ln["id"]]), "measured"
    if ln.get("dur_s") is not None:
        return float(ln["dur_s"]), "dur_s"
    words = len(re.findall(r"[\w']+", str(ln.get("text") or "")))
    return words / (EST_WPM / 60.0), f"estimated at {EST_WPM:g} words a minute"


def voiced(play: dict, durations: dict | None) -> list[dict]:
    out = []
    for p in play.get("parts") or []:
        for ln in p.get("lines") or []:
            if ln.get("kind") in VOICED_KINDS:
                d, how = line_dur(ln, durations)
                a = float(ln.get("start_s") or 0.0)
                out.append({"id": ln.get("id"), "kind": ln["kind"], "start": a, "end": a + d, "how": how,
                            "part": p.get("id"), "segment": p.get("segment"), "text": ln.get("text") or "", "ref": ln})
    return sorted(out, key=lambda v: (v["start"], v["id"] or ""))


def music_cues(play: dict) -> list[dict]:
    cues = [c for p in play.get("parts") or [] for c in p.get("cues") or []] + list(play.get("music") or [])
    return [c for c in cues if c.get("kind") == "music" and c.get("start_s") is not None and c.get("end_s") is not None]


def _overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def parts(play: dict):
    """(part, segment) for every part, the segment as the checked order trusts it (schema.segments: None where a
    label is out of place, so the part is linted as news). No exemption is read from a part's own label or kind."""
    ps = [p for p in play.get("parts") or [] if isinstance(p, dict)]
    return list(zip(ps, SC.segments(dict(play, parts=ps))))


def _as_linted(part: dict) -> dict:
    """The part as A0's surfaces read it, its self-declared exemptions removed: A0 skips a ``kind: credits`` part
    and a card labelled credits, attribution or mark key; in a news part those are labels, not exemptions."""
    q = dict(part, kind="chapter" if part.get("kind") == "credits" else part.get("kind"))
    q["lines"] = [SC.engine_line(ln) for ln in part.get("lines") or []]     # a v2 vo line is narration, read/sot quotation
    q["shots"] = [dict(s, card="statement") if s.get("card") in AW.EXEMPT_CARDS else s for s in part.get("shots") or []]
    return q


def part_surfaces(part: dict) -> list[dict]:
    """A0's surfaces of one part (narration, our cards, lower thirds, overlays, part titles), plus every graphic's
    own lines of text (``shows.lines``). The caller skips the trusted credits; nothing else is exempt."""
    out = AW.surfaces({"parts": [_as_linted(part)]})
    for coll in ("shots", "text"):
        for x in part.get(coll) or []:
            if G.is_graphic(x):
                for k, ln in enumerate((x.get("shows") or {}).get("lines") or []):
                    out.append({"unit": f"{x.get('id')}.shows.lines[{k}]", "role": "graphic", "text": str(ln)})
    return out


def everything_said(part: dict) -> list[dict]:
    """Every word a part says or shows, quotations included: no-bridge reads them all."""
    out = [{"unit": f"part {part.get('id')}", "text": str(part.get(k))} for k in ("title", "dates")
           if isinstance(part.get(k), str)]
    for ln in part.get("lines") or []:
        out.append({"unit": ln.get("id"), "text": str(ln.get("text") or "")})
    for s in part.get("shots") or []:
        out += [{"unit": s.get("id"), "text": str(x)} for x in s.get("text") or []]
        out += [{"unit": s.get("id"), "text": str(x)} for x in _shows_text(s)]
    for t in part.get("text") or []:
        out += [{"unit": t.get("id"), "text": str(x)} for x in t.get("lines") or []]
        out += [{"unit": t.get("id"), "text": str(x)} for x in _shows_text(t)]
    return out


def _shows_text(x: dict) -> list[str]:
    sh = x.get("shows") if isinstance(x.get("shows"), dict) else {}
    return ([str(v) for v in sh.get("lines") or []] + [str(h.get("text") or "") for h in sh.get("headlines") or []]
            + [str(r.get("headline") or "") for r in sh.get("rows") or []] + [str(v) for v in sh.get("title_lines") or []]
            + ([str(sh["week_line"])] if sh.get("week_line") else []))


def _graphics(play: dict):
    for p in play.get("parts") or []:
        for coll in ("shots", "text"):
            for x in p.get(coll) or []:
                if G.is_graphic(x):
                    yield p, x


# --------------------------------------------------------------------------
# The lints
# --------------------------------------------------------------------------


def as_of_checks(play: dict, assets: dict, inputs: dict) -> list[dict]:
    found, checked = [], 0
    episode = instant(play.get("as_of"))
    if episode is None:
        return [_check("as-of", False, unit="as_of", evidence={"as_of": play.get("as_of"),
                                                               "why": "the episode's horizon does not read as a date"})]

    def judge(unit, status, ev):
        if status == "ok":
            return
        if status == "same-day":
            found.append(_check("as-of", True, unit=unit, severity="review", evidence=dict(ev, why=(
                "dated by the day only, on the horizon's own day: the reviewer confirms it predates the horizon"))))
            return
        found.append(_check("as-of", False, unit=unit, evidence=dict(ev, why={
            "after": "dated after the part's horizon", "imprecise": "its date may fall after the part's horizon",
            "undated": "no date it can be judged by"}[status])))

    readers = {id(ln) for _, ln in SC.reader_lines(play)}
    extracts = _extract_dates(inputs)
    for p, seg in parts(play):
        if seg in SC.AS_OF_EXEMPT:
            continue                          # the trusted clock and credits only (schema.segments)
        own = instant(p.get("as_of")) if p.get("as_of") else episode
        if own is None:
            continue                          # schema's part-as-of-declared names it
        checked += 1
        rel = against(own, episode)
        if rel != "ok":
            found.append(_check("as-of", False, unit=f"part {p.get('id')}", evidence={
                "part": p.get("id"), "as_of": p.get("as_of"), "episode_as_of": _fmt(episode), "why": {
                    "after": "the part's horizon is after the episode's",
                    "same-day": "a whole day on the episode's own day may run past the episode's instant: the part's "
                                "horizon is an instant (with its zone), or a day before the episode's",
                }.get(rel, "the part's horizon may fall after the episode's")}))
        hz = own if own[1] <= episode[1] else episode       # every item is judged by the earlier of the two
        base = {"part": p.get("id"), "as_of": _fmt(hz)}

        def item_check(unit, item, graphic, asset, hz=hz, base=base):
            nonlocal checked
            if item is None or item.get("test_fixture"):
                return
            checked += 1
            studio = bool(item.get("generator") or item.get("synthetic") or graphic)
            v = item.get("content_date") if item.get("content_date") is not None else (
                None if studio else (item.get("date") if item.get("date") is not None else item.get("year")))
            d = instant(v)
            judge(unit, "undated" if d is None else against(d, hz),
                  dict(base, asset=asset, date=v, **({"fix": "a studio-made item declares content_date"}
                                                     if studio and v is None else {})))

        for s in p.get("shots") or []:
            if s.get("asset"):
                item_check(s.get("id"), assets.get(s["asset"]), G.is_graphic(s), s["asset"])
            if s.get("kind") == "card" and s.get("source_date") is not None:
                checked += 1
                d = instant(s["source_date"])
                judge(s.get("id"), "undated" if d is None else against(d, hz), dict(base, source_date=s["source_date"]))
        for t in p.get("text") or []:         # a graphic over a picture is dated like a shot (schema names a missing item)
            if G.is_graphic(t) and t.get("asset"):
                item_check(t.get("id"), assets.get(t["asset"]), True, t["asset"])
        for g in [x for x in (p.get("shots") or []) + (p.get("text") or []) if G.is_graphic(x)]:
            if not g.get("data_ref"):
                continue
            try:
                sub = resolve(g["data_ref"], inputs)
            except FieldError as e:
                found.append(_check("as-of", False, unit=g.get("id"), evidence=dict(base, data_ref=g["data_ref"],
                                                                                     why=f"data_ref does not resolve: {e}")))
                continue
            for k, v in _dates_under(sub):
                checked += 1
                d = instant(v)
                judge(g.get("id"), "undated" if d is None else against(d, hz),
                      dict(base, data_ref=g["data_ref"], field=k, date=v))
        for ln in p.get("lines") or []:
            if ln.get("kind") not in ("testimony", *SC.READER_KINDS):
                continue                      # a v2 sot line is dated by its clip's ledger item
            v = ln.get("date") if ln.get("date") is not None else ln.get("year")
            src = "line"
            if v is None and id(ln) in readers:
                v, src = extracts.get(ln.get("quote_sha256")), "extract"
            if v is None and id(ln) not in readers:
                continue                      # an archival clip is dated by its ledger item
            checked += 1
            d = instant(v)
            judge(ln.get("id"), "undated" if d is None else against(d, hz), dict(base, date=v, dated_by=src, **(
                {"fix": "a reader line states its date (or its extract in the rundown or the echo pick does)"}
                if d is None else {})))
        for srf in part_surfaces(p):
            late = [y for y in AW.years_in(srf["text"]) if y > hz[1].year]
            if late:
                found.append(_check("as-of", False, unit=srf["unit"], evidence=dict(
                    base, text=srf["text"], years=late, why="names a year after the part's horizon")))
    return _summary("as-of", found, checked)


PUBLISHED_BY_EDITION = "picture_published_by_edition"
_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


def dot_day(value) -> str | None:
    """"2 NOV 2026": an ISO day as written, an instant by its UTC day (scripts/lib/rights/fetcher.mjs dotDay)."""
    sp = instant(value)
    if sp is None:
        return None
    d = sp[0].date() if sp[2] else (sp[0].date() if (sp[1] - sp[0]) <= dt.timedelta(days=1) else None)
    return None if d is None else f"{d.day} {_MONTHS[d.month - 1]} {d.year}"


def edition_dot_label(event_date, published_at) -> str | None:
    a, b = dot_day(event_date), dot_day(published_at)
    return None if a is None or b is None else f"FILMED {a} \u00b7 PUBLISHED {b}"


def published_by_edition_checks(play: dict, assets: dict) -> list[dict]:
    """Ruling A: every news picture public by its part's horizon, or, in The Week, a picture of the day's own event
    published by the edition cutoff and carrying its FILMED/PUBLISHED dot label on its ledger item and its shot."""
    found, checked = [], 0
    episode = instant(play.get("as_of"))
    if episode is None:
        return []                             # as-of names the unreadable horizon
    week_hz = []                              # V1 ONLY: The Week's horizons so far (a day's window starts at the last)
    news = SC.spine(play).news
    for p, seg in parts(play):
        if seg is not None and seg not in news:
            continue                          # news parts only, the checked order deciding (a mislabelled part is news)
        own = instant(p.get("as_of")) if p.get("as_of") else episode
        if own is None:
            continue
        hz = own if own[1] <= episode[1] else episode
        earlier = [h for h in week_hz if h[1] < hz[0]] if seg == "week" else []
        day_start = max(earlier, key=lambda h: h[1]) if earlier else None
        if seg == "week":
            week_hz.append(hz)
        for x in (p.get("shots") or []) + (p.get("text") or []):
            item = assets.get(x.get("asset")) if x.get("asset") else None
            if item is None or item.get("test_fixture") or G.is_graphic(x) or item.get("generator") or item.get("synthetic"):
                continue
            if item.get("published_at") is None:
                continue                      # the fetcher refuses a news picture with no publication time
            if item.get("own_property") or item.get("adapter") == "voidnews":
                continue                      # void news's own printed page: held to the capture rules, not publication
            checked += 1
            base = {"part": p.get("id"), "asset": x.get("asset"), "published_at": item.get("published_at"),
                    "as_of": _fmt(hz)}
            pub = instant(item.get("published_at"))
            if pub is None:
                found.append(_check(PUBLISHED_BY_EDITION, False, unit=x.get("id"), evidence=dict(
                    base, why="the item's publication time does not read")))
                continue
            if against(pub, hz) == "ok":
                continue
            probs = []
            if seg != "week":
                probs.append("published after the part's horizon; only The Week's days may show a picture published "
                             "later, by the edition cutoff")
            else:
                ev = instant(item.get("date"))
                if ev is None or not (ev[1] - ev[0]) <= dt.timedelta(days=1) or against(ev, hz) not in ("ok", "same-day"):
                    probs.append("published after the day's horizon, and its event is not dated to a day on or before it")
                # The window's start (S4 review): the ledger's day_from, else the previous Week day's horizon day.
                pbe = item.get("published_by_edition") if isinstance(item.get("published_by_edition"), dict) else {}
                start = instant(pbe.get("day_from")) if pbe.get("day_from") else day_start
                if ev is not None and start is not None and ev[0].date() < start[0].date():
                    probs.append(f"its event ({item.get('date')}) is dated before the day's window starts "
                                 f"({start[0].date().isoformat()})")
                if against(pub, episode) != "ok":
                    probs.append(f"published after the edition cutoff {_fmt(episode)}")
                want = edition_dot_label(item.get("date"), item.get("published_at"))
                lab = item.get("dot_label")
                got = lab.get("text") if isinstance(lab, dict) else lab
                if want and got != want:
                    probs.append(f"its ledger item carries the dot label {got!r}, not {want!r}")
                if want and x.get("dot_label") != want:
                    probs.append(f"the shot carries the dot label {x.get('dot_label')!r}, not {want!r}")
            if probs:
                found.append(_check(PUBLISHED_BY_EDITION, False, unit=x.get("id"), evidence=dict(base, problems=probs)))
    return _summary(PUBLISHED_BY_EDITION, found, checked)


DOT_LABEL_CARRIED = "dot-label-carried"


def dot_label_checks(play: dict, assets: dict) -> list[dict]:
    """``dot-label-carried``: a shot of a ledger item with a sourcing dot label carries that label, word for word."""
    found, checked = [], 0
    for p, _seg in parts(play):
        for x in p.get("shots") or []:
            item = assets.get(x.get("asset")) if x.get("asset") else None
            if not isinstance(item, dict) or item.get("published_by_edition"):
                continue                      # ruling A's label: picture_published_by_edition holds it
            lab = item.get("dot_label")
            want = lab.get("text") if isinstance(lab, dict) else lab
            if not (isinstance(want, str) and want.strip()):
                continue
            checked += 1
            if x.get("dot_label") != want:
                found.append(_check(DOT_LABEL_CARRIED, False, unit=x.get("id"), evidence={
                    "part": p.get("id"), "asset": x.get("asset"), "want": want, "got": x.get("dot_label"),
                    "why": "the ledger item airs only with its dot label on screen"}))
    return _summary(DOT_LABEL_CARRIED, found, checked)


FAIR_USE = "fair-use-excerpt"
FAIR_USE_REFUSED = "fair-use-refused"
_FAIR_USE_BASIS = re.compile(r"\bfair[\s-]?(?:use|dealing)\b|\b17\s*U\.?S\.?C\.?\s*(?:\u00a7+|sec(?:tion|\.)?)?\s*107\b",
                             re.I)


def is_fair_use(item: dict | None) -> bool:
    """A ledger item that rests on fair use: the fair-use-excerpt class, a fair_use record, or a basis that says so."""
    if not isinstance(item, dict):
        return False
    return (item.get("licence") == FAIR_USE or item.get("fair_use") is not None
            or bool(_FAIR_USE_BASIS.search(str(item.get("basis") or ""))))


def fair_use_refused_checks(play: dict, assets: dict) -> list[dict]:
    """``fair-use-refused`` (bible o): fair use was tied to The Weight, which is gone, so any picture or sound whose
    ledger item rests on fair use blocks, wherever it airs, until the founder re-rules."""
    found, checked = [], 0
    for p, _seg in parts(play):
        for coll in ("shots", "text", "cues"):
            for x in p.get(coll) or []:
                aid = x.get("asset") or x.get("clip") or (x.get("source") if coll == "cues" else None)
                if not isinstance(aid, str) or not aid:
                    continue
                checked += 1
                if is_fair_use(assets.get(aid)):
                    found.append(_check(FAIR_USE_REFUSED, False, unit=x.get("id"), evidence={
                        "part": p.get("id"), "asset": aid, "licence": assets[aid].get("licence"),
                        "why": "fair use is unavailable in v2 (bible n): replace the item with a cleared one"}))
    shots = {s.get("id"): s for p in play.get("parts") or [] for s in p.get("shots") or []}
    for ln in (ln for p in play.get("parts") or [] for ln in p.get("lines") or []):
        refs = [ln.get("clip"), ln.get("transcript_ref"), (shots.get(ln.get("shot_ref")) or {}).get("asset")]
        for aid in dict.fromkeys(r for r in refs if isinstance(r, str) and r):
            checked += 1
            if is_fair_use(assets.get(aid)):
                found.append(_check(FAIR_USE_REFUSED, False, unit=ln.get("id"), evidence={
                    "asset": aid, "why": "fair use is unavailable in v2 (bible n)"}))
    for c in play.get("music") or []:
        aid = c.get("asset") or c.get("clip") or c.get("source")
        if isinstance(aid, str) and aid:
            checked += 1
            if is_fair_use(assets.get(aid)):
                found.append(_check(FAIR_USE_REFUSED, False, unit=c.get("id"), evidence={
                    "asset": aid, "why": "fair use is unavailable in v2 (bible n)"}))
    return _summary(FAIR_USE_REFUSED, found, checked)


def _extract_dates(inputs: dict) -> dict:
    """{quote_sha256: its date} for every extract the rundown or the echo pick records with a date."""
    out = {}
    for src in (inputs.get("rundown"), inputs.get("echo")):
        for d in _iter_dicts(src):
            h = d.get("quote_sha256")
            if not isinstance(h, str) or h in out:
                continue
            v = next((d[k] for k in d if is_date_key(k) and d[k] is not None), d.get("year"))
            if v is not None:
                out[h] = v
    return out


def _content_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z'-]+", AW._norm(text).lower()) if len(w) >= 4 and w not in STOP}


def language_checks(play: dict, inputs: dict, durations: dict | None) -> list[dict]:
    lex = lexicon()
    tell, hind, n = [], [], 0
    for p, seg in parts(play):
        if seg == "credits":
            continue
        for srf in part_surfaces(p):
            n += 1
            th = AW.phrase_hits(srf["text"], lex["never_tell"])
            if th:
                tell.append(_check("never-tell", False, unit=srf["unit"], evidence={"text": srf["text"], "hits": th,
                                                                                    "list": "news (bible e)"}))
            hh = AW.phrase_hits(srf["text"], lex["hindsight"])
            if hh:
                hind.append(_check("hindsight-language", False, unit=srf["unit"], evidence={"text": srf["text"], "hits": hh,
                                                                                           "list": "news (bible j)"}))
    # V1 ONLY (frozen, issue 33): a narration line spoken over a board never paraphrases a headline the board shows
    boards = []
    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if G.is_graphic(s) and s.get("subtype") == "board":
                a = float(s.get("start_s") or 0.0)
                boards.append((s, a, a + shot_dur(s)))
    for v in voiced(play, durations):
        if v["kind"] not in SC.NARRATOR_KINDS:
            continue
        nw = _content_words(v["text"])
        for s, a, b in boards:
            if _overlap(v["start"], v["end"], a, b) <= OVERLAP_EPS:
                continue
            for r in (s.get("shows") or {}).get("rows") or []:
                hw = _content_words(str(r.get("headline") or ""))
                if len(hw) >= PARAPHRASE_MIN_WORDS and len(hw & nw) / len(hw) >= PARAPHRASE_SHARE:
                    tell.append(_check("never-tell", False, unit=v["id"], evidence={
                        "text": v["text"], "board": s.get("id"), "headline": r.get("headline"),
                        "shared": sorted(hw & nw), "why": "the narration paraphrases a headline the board is showing"}))
    return _summary("never-tell", tell, n) + _summary("hindsight-language", hind, n)


def _outlets(inputs: dict) -> list[str]:
    rec = inputs.get("record") or {}
    names = set()
    for x in _iter_dicts(rec):
        if isinstance(x.get("outlet"), str):
            names.add(x["outlet"])
    return sorted(names, key=len, reverse=True)


def _iter_dicts(x):
    if isinstance(x, dict):
        yield x
        for v in x.values():
            yield from _iter_dicts(v)
    elif isinstance(x, list):
        for v in x:
            yield from _iter_dicts(v)


_WORD = re.compile(r"[\w'-]+")


def outlet_checks(play: dict, inputs: dict) -> list[dict]:
    spec = lexicon()["outlet_characterisation"]
    outlets = _outlets(inputs) + [str(x) for x in (play.get("news") or {}).get("outlets") or []]
    legal = {o.lower(): {str(t).lower() for t in (v.get("terms") or [])}
             for o, v in ((play.get("news") or {}).get("legal_status") or {}).items()
             if isinstance(v, dict) and str(v.get("basis") or "").strip()}
    media = {w.lower() for w in spec["media_nouns"]}
    win = int(spec["window_words"])
    terms = list(spec["terms"]) + [r for r in rungs()]
    found, n = [], 0
    for p, seg in parts(play):
        if seg == "credits":
            continue
        for srf in part_surfaces(p):
            n += 1
            text = AW._norm(srf["text"])
            words = [(m.start(), m.group(0).lower()) for m in _WORD.finditer(text)]

            def word_at(pos):
                return max([i for i, (a, _) in enumerate(words) if a <= pos] or [0])
            names = []
            for o in outlets:
                for m in re.finditer(r"(?<![\w])" + re.escape(o) + r"(?![\w])", text, re.I):   # any case
                    names.append((o, word_at(m.start()), word_at(m.end() - 1)))
            hits = []
            for t in terms:
                is_rung = t in rungs()
                for m in AW._rx(t, True).finditer(text):
                    i = word_at(m.start())
                    j = word_at(m.end() - 1)
                    near = [o for o, a, b in names if min(abs(i - b), abs(a - j)) <= (3 if is_rung else win)]
                    noun = (not is_rung) and (t.split()[-1].lower() in media or any(
                        w in media for _, w in words[j + 1:j + 3] + words[max(0, i - 1):i]))
                    near = [o for o in near if t.lower() not in legal.get(o.lower(), set())]
                    if near or noun:
                        hits.append({"term": t, "outlets": near, "media_noun": bool(noun)})
            if hits:
                found.append(_check("no-outlet-characterisation", False, unit=srf["unit"], evidence={
                    "text": srf["text"], "hits": hits,
                    "fix": "the outlet's rung and colour are on screen; the narration names it and nothing more"}))
    return _summary("no-outlet-characterisation", found, n)


def bridge_list(inputs: dict) -> list[str] | None:
    """The week's named persons, places and parties-as-actors the Echo may not name: the rundown's Echo no_bridge,
    else the echo pick's (founder ruling 2026-11-12)."""
    for p in (inputs.get("rundown") or {}).get("parts") or []:
        nb = p.get("no_bridge") if isinstance(p.get("no_bridge"), dict) else None
        if nb and isinstance(nb.get("must_not_appear"), list):
            return [str(x) for x in nb["must_not_appear"]]
    nb = (inputs.get("echo") or {}).get("no_bridge")
    if isinstance(nb, dict) and isinstance(nb.get("must_not_appear_in_echo_lines"), list):
        return [str(x) for x in nb["must_not_appear_in_echo_lines"]]
    return None


def bridge_variants(inputs: dict) -> dict:
    """{name: [spellings]} the rundown's Echo no_bridge declares (``variants``), e.g. {"Kyiv": ["Kiev"]}."""
    for p in (inputs.get("rundown") or {}).get("parts") or []:
        nb = p.get("no_bridge") if isinstance(p.get("no_bridge"), dict) else None
        if nb and isinstance(nb.get("variants"), dict):
            return {str(k): [str(v) for v in vs] for k, vs in nb["variants"].items() if isinstance(vs, list)}
    return {}


def fold(text) -> str:
    """Text as no-bridge reads it: Unicode NFKC (composed accents, a no-break space as a space), curly apostrophes
    straightened, and every run of whitespace (line breaks included) one space."""
    t = unicodedata.normalize("NFKC", str(text or "")).replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", t)


def _spellings(name: str, variants: dict) -> list[str]:
    """A listed name and the forms it may take in the Echo: its declared variants and its period spellings (A0's
    table, modern to period, and the news lexicon's), each as written and in capitals (CoS ruling under the founder's
    narrow rule, 2026-11-12: full names as listed, no case-folding into common words)."""
    lex = lexicon()
    forms = [name] + list(variants.get(name) or []) + list((lex.get("period_spellings") or {}).get(name) or [])
    forms += [str(e["period"]) for e in AW.lexicon()["period_names"] if e.get("modern") == name and e.get("period")]
    out = []
    for f in forms:
        f = fold(f).strip()
        for g in (f, f.upper()):
            if g and g not in out:
                out.append(g)
    return out


def bridge_matchers(names, variants: dict | None = None) -> list[tuple[str, re.Pattern]]:
    """(listed name, pattern) for each name the Echo may not say, over ``fold``ed text: whole words; each listed
    spelling as written or in capitals; and a single listed word of four letters or more with its demonyms and
    derived forms ("Iran" "Iranian", "Ruritania" "Ruritanian", "Ukraine" "Ukrainian", "Congo" "Congolese", "Saudi"
    "Saudis"). A short or multi-word name matches only as listed (so "Doe" never matches "Does")."""
    sx = "|".join(re.escape(x) for x in lexicon()["demonym_suffixes"])
    out = []
    for nm in names or []:
        alts = []
        for f in _spellings(str(nm), variants or {}):
            body = r"\s+".join(re.escape(w) for w in f.split(" "))
            if " " in f or len(f) < 4:
                alts.append(body)
                continue
            alts.append(body + f"(?i:{sx})?")
            if f[-1].lower() in "aeo":
                alts.append(re.escape(f[:-1]) + f"(?i:{sx})")       # Ukraine: Ukrain-ian; Congo: Cong-olese
            if f[-1].lower() in "aeiou":
                alts.append(body + "(?i:s)")                         # Saudi: Saudis
        out.append((str(nm), re.compile(r"(?<![\w])(?:" + "|".join(alts) + r")(?![\w])")))
    return out


def bridge_checks(play: dict, inputs: dict) -> list[dict]:
    found, n = [], 0
    echo_parts = [p for p in play.get("parts") or [] if p.get("segment") == "echo"]   # by label: stricter, never looser
    names = bridge_list(inputs)
    if echo_parts and names is None:
        return [_check("no-bridge", False, unit="news.rundown", evidence={
            "why": "the screenplay has an Echo but no no_bridge list was found in the rundown or the echo pick"})]
    if echo_parts and not names:
        return [_check("no-bridge", False, unit="news.rundown", evidence={
            "why": "the Echo's no_bridge list is empty: it names no one, so nothing the Echo says can be checked"})]
    rxs = bridge_matchers(names, bridge_variants(inputs))
    for p in echo_parts:
        for srf in everything_said(p):
            n += 1
            text = fold(srf["text"])
            hits = [nm for nm, rx in rxs if rx.search(text)]
            if hits:
                found.append(_check("no-bridge", False, unit=srf["unit"], evidence={
                    "part": p.get("id"), "text": srf["text"], "names": hits,
                    "why": "a person, place or party acting in this week's news is named in the Echo"}))
    phrases = lexicon()["bridge_phrases"]
    for p, seg in parts(play):
        if seg == "credits":
            continue
        for srf in part_surfaces(p):
            n += 1
            hits = AW.phrase_hits(srf["text"], [phrases])
            if hits:
                found.append(_check("no-bridge", False, unit=srf["unit"], evidence={
                    "part": p.get("id"), "text": srf["text"], "hits": hits,
                    "why": "a sentence points between the Echo and the week"}))
    return _summary("no-bridge", found, n)


def _values_equal(a, b) -> bool:
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_values_equal(x, y) for x, y in zip(a, b))
    if _is_num(a) and _is_num(b):
        return abs(float(a) - float(b)) < 1e-9
    return a == b


_MONTH = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
          r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?")
_DOW = r"(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?"
DATE_EXPR = re.compile(
    r"\b\d{4}-\d{2}-\d{2}\b"
    rf"|\b(?:{_DOW}\s+)?\d{{1,2}}(?:st|nd|rd|th)?\s+{_MONTH}(?:,?\s+\d{{4}})?(?![\w])"
    rf"|\b{_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,\s*\d{{4}})?(?![\w])"
    rf"|\b{_MONTH}\s+\d{{4}}(?![\w])", re.I)
_UNITS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen "
                                     "fourteen fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
_SCALES = {"hundred": 100, "thousand": 1000, "million": 10 ** 6, "billion": 10 ** 9}
_NUMWORD = re.compile(r"\b(?:" + "|".join(list(_UNITS) + list(_TENS) + list(_SCALES)) + r")(?:(?:[\s-]+(?:and[\s-]+)?)(?:"
                      + "|".join(list(_UNITS) + list(_TENS) + list(_SCALES)) + r"))*\b", re.I)


def spelled_numbers(text: str) -> list[float]:
    """The numbers written out in words ("seven thousand", "twenty-one"); a lone "one" is a pronoun as often as a
    count, so it is read only inside a longer number."""
    out = []
    for m in _NUMWORD.finditer(str(text)):
        words = [w.lower() for w in re.split(r"[\s-]+", m.group(0)) if w.lower() != "and"]
        if words == ["one"]:
            continue
        total = cur = 0
        for w in words:
            if w in _UNITS:
                cur += _UNITS[w]
            elif w in _TENS:
                cur += _TENS[w]
            elif w == "hundred":
                cur = max(cur, 1) * 100
            else:
                total += max(cur, 1) * _SCALES[w]
                cur = 0
        out.append(float(total + cur))
    return out


def on_screen_numbers(text: str) -> list[float]:
    """Every count a line of our own on-screen text states: its numerals and its written-out numbers, a date's own
    day, month and year aside (the as-of lint judges dates)."""
    t = DATE_EXPR.sub(" ", AW.strip_quotes(str(text)))
    return numerals(t) + spelled_numbers(t)


def counts_checks(play: dict, inputs: dict) -> list[dict]:
    """Every figure an element declares (``figures`` on a card or a text element, ``shows.figures`` on a graphic)
    equals its record field; every count its on-screen text states is one of its own declared figures."""
    found, n = [], 0

    def declared(unit, figs) -> set[float]:
        nonlocal n
        allowed: set[float] = set()
        for k, f in enumerate(figs if isinstance(figs, list) else []):
            n += 1
            f = f if isinstance(f, dict) else {}
            try:
                want = resolve(f.get("field"), inputs)
            except FieldError as e:
                found.append(_check("counts-match", False, unit=f"{unit}.figures[{k}]", evidence={
                    "field": f.get("field"), "value": f.get("value"), "why": f"the field does not resolve: {e}"}))
                continue
            if not _values_equal(f.get("value"), want):
                found.append(_check("counts-match", False, unit=f"{unit}.figures[{k}]", evidence={
                    "field": f.get("field"), "shown": f.get("value"), "record": want}))
                continue
            for v in (f["value"] if isinstance(f["value"], list) else [f["value"]]):
                if _is_num(v):
                    allowed.add(float(v))
        return allowed

    def loose(unit, text, allowed: set[float]):
        nonlocal n
        n += 1
        bad = [x for x in on_screen_numbers(text) if x not in allowed]
        if bad:
            found.append(_check("counts-match", False, unit=unit, evidence={
                "text": text, "numbers": [int(x) if x.is_integer() else x for x in bad], "declared": sorted(allowed),
                "why": "a count on screen that is not one of the element's declared figures",
                "fix": "declare it: figures [{value, field}] naming the record field it is"}))

    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if s.get("kind") == "card" and not s.get("quote"):
                allowed = declared(s.get("id"), s.get("figures"))
                for k, x in enumerate(s.get("text") or []):
                    loose(f"{s.get('id')}.text[{k}]", str(x), allowed)
        for t in p.get("text") or []:
            if t.get("quote") or G.is_graphic(t):
                continue
            allowed = declared(t.get("id"), t.get("figures"))
            for k, x in enumerate(t.get("lines") or []):
                loose(f"{t.get('id')}.lines[{k}]", str(x), allowed)
    for _, g in _graphics(play):
        sh = g.get("shows") or {}
        allowed = declared(g.get("id"), sh.get("figures"))
        if g.get("subtype") == "clock":
            continue                         # the clock shows the release time: clock-true, at release
        for k, x in enumerate(sh.get("lines") or []):
            loose(f"{g.get('id')}.shows.lines[{k}]", str(x), allowed)
    return _summary("counts-match", found, n)


def _hashes_under(x, keys=("quote_sha256",)) -> set[str]:
    return {str(d[k]) for d in _iter_dicts(x) for k in keys if isinstance(d.get(k), str)}


def record_headline_hashes(inputs: dict) -> set[str]:
    rec = inputs.get("record") or {}
    out = _hashes_under(rec, ("headline_sha256", "sha256"))
    for d in _iter_dicts(rec):
        for k in ("headline", "title"):
            if isinstance(d.get(k), str):
                out.add(sha256_text(d[k]))
    return out


def quote_checks(play: dict, inputs: dict) -> list[dict]:
    found, n = [], 0
    extracts = _hashes_under(inputs.get("rundown")) | _hashes_under(inputs.get("echo"))
    for _, ln in SC.reader_lines(play):
        n += 1
        got, want = sha256_text(ln.get("text") or ""), ln.get("quote_sha256")
        probs = []
        if got != want:
            probs.append("the line's text does not hash to its quote_sha256: it is not the extract, verbatim")
        if want not in extracts:
            probs.append("quote_sha256 is not an extract the rundown or the echo pick records")
        if probs:
            found.append(_check("quote-verbatim", False, unit=ln.get("id"), evidence={
                "text": ln.get("text"), "quote_sha256": want, "text_sha256": got, "problems": probs}))
    heads = record_headline_hashes(inputs)
    shown = []
    for _, g in _graphics(play):
        sh = g.get("shows") or {}
        shown += [(f"{g.get('id')}.headlines[{k}]", h.get("text"), h.get("headline_sha256"))
                  for k, h in enumerate(sh.get("headlines") or [])]
        shown += [(f"{g.get('id')}.rows[{k}]", r.get("headline"), r.get("headline_sha256"))
                  for k, r in enumerate(sh.get("rows") or [])]
    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if s.get("kind") == "card" and s.get("headline_sha256"):
                shown.append((s.get("id"), (s.get("text") or [""])[0], s.get("headline_sha256")))
        for t in p.get("text") or []:
            if t.get("headline_sha256") and not G.is_graphic(t):
                shown.append((t.get("id"), (t.get("lines") or [""])[0], t.get("headline_sha256")))
    for unit, text, h in shown:
        n += 1
        probs = []
        if h != sha256_text(text or ""):
            probs.append("the headline shown does not hash to its headline_sha256")
        if h not in heads:
            probs.append("headline_sha256 is not a headline the week record holds")
        if probs:
            found.append(_check("quote-verbatim", False, unit=unit, evidence={"text": text, "headline_sha256": h,
                                                                              "problems": probs}))
    # our own on-screen text that reproduces a record headline is a displayed headline: it carries its hash
    record_heads = [(t, _content_words(t)) for t in record_headlines(inputs)]
    for unit, text, has_sha in _own_screen_lines(play):
        if has_sha:
            continue
        n += 1
        tw = _content_words(text)
        like = [t for t, hw in record_heads if len(hw) >= PARAPHRASE_MIN_WORDS and len(hw & tw) / len(hw) >= PARAPHRASE_SHARE]
        if like:
            found.append(_check("quote-verbatim", False, unit=unit, evidence={
                "text": text, "record_headline": like[0],
                "why": "the text reproduces a headline the week record holds, so it is shown verbatim with its "
                       "headline_sha256 (a card's text[0])"}))
    return _summary("quote-verbatim", found, n)


def record_headlines(inputs: dict) -> list[str]:
    """Every headline and story title the week record holds."""
    return sorted({d[k] for d in _iter_dicts(inputs.get("record") or {}) for k in ("headline", "title")
                   if isinstance(d.get(k), str) and d[k].strip()})


def _own_screen_lines(play: dict):
    """(unit, text, carries headline_sha256) for every line of our own on-screen text: cards (a period quote aside),
    text elements, and graphics' own lines."""
    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if s.get("kind") == "card" and not s.get("quote"):
                for k, x in enumerate(s.get("text") or []):
                    yield f"{s.get('id')}.text[{k}]", str(x), bool(s.get("headline_sha256"))
            if G.is_graphic(s):
                for k, x in enumerate((s.get("shows") or {}).get("lines") or []):
                    yield f"{s.get('id')}.shows.lines[{k}]", str(x), False
        for t in p.get("text") or []:
            if t.get("quote"):
                continue
            if t.get("kind") != "lower_third":       # a name and a role, which share a headline's words by nature
                for k, x in enumerate(t.get("lines") or []):
                    yield f"{t.get('id')}.lines[{k}]", str(x), bool(t.get("headline_sha256"))
            if G.is_graphic(t):
                for k, x in enumerate((t.get("shows") or {}).get("lines") or []):
                    yield f"{t.get('id')}.shows.lines[{k}]", str(x), False


def music_checks(play: dict, durations: dict | None) -> list[dict]:
    cues = music_cues(play)
    out, news = [], []
    for p, seg in parts(play):
        if seg is not None and seg not in SC.spine(play).news:
            continue                          # a part the checked order does not trust is news
        sp = part_span(p)
        if sp is None:
            continue
        for c in cues:
            ov = _overlap(sp[0], sp[1], float(c["start_s"]), float(c["end_s"]))
            if ov > OVERLAP_EPS:
                news.append(_check("no-music-under-news", False, unit=c.get("id"), evidence={
                    "part": p.get("id"), "segment": p.get("segment"), "trusted_segment": seg, "overlap_s": round(ov, 3),
                    "why": "footage's own sound is the only bed under the news (bible g)"}))
    out += _summary("no-music-under-news", news, len(cues))
    quotes = []
    readers = {ln.get("id") for _, ln in SC.reader_lines(play)}
    for v in voiced(play, durations):
        if v["id"] not in readers:
            continue
        for c in cues:
            ov = _overlap(v["start"], v["end"], float(c["start_s"]), float(c["end_s"]))
            if ov > OVERLAP_EPS:
                quotes.append(_check("no-music-under-quote", False, unit=v["id"], evidence={
                    "cue": c.get("id"), "overlap_s": round(ov, 3), "timed": v["how"],
                    "why": "no music under any quotation (founder ruling): close the cue, and declare the window "
                           "silence: intended with its reason"}))
    out += _summary("no-music-under-quote", quotes, len(readers))
    return out


def echo_bed_ending_checks(play: dict) -> list[dict]:
    """``echo-bed-ending`` (bible j, section g/h; ticket 3): the Echo's bed cue (SCORE.cue_role ``bed``, the one
    playing inside an Echo part) ends at least ECHO_BED_GAP_S before the sign-off part begins (its written ending,
    then 2 s of room, then the hard cut to the ident card), and never overlaps the theme (SCORE.cue_role
    ``main_title``, played whole at the title and under the credits): "never a crossfade into the theme".

    V1 ONLY (frozen, issue 33): v1's spine has no signoff segment (margins and question follow the Echo instead),
    so this lint is inert for it (``SC.spine(play).name``, not a part's own label) rather than blocking on a
    segment its spine never had."""
    if SC.spine(play).name != SC.V2.name:
        return [_check("echo-bed-ending", True, evidence={"why": "v1 (issue 33's frozen spine) has no signoff part"})]
    echo_parts = [p for p, seg in parts(play) if seg == "echo"]
    if not echo_parts:
        return [_check("echo-bed-ending", True, evidence={"echo_parts": 0})]
    spans = [part_span(p) for p in echo_parts]
    cues = music_cues(play)
    beds = [c for c in cues if SCORE.cue_role(c) == "bed"
            and any(sp and _overlap(float(c["start_s"]), float(c["end_s"]), sp[0], sp[1]) > OVERLAP_EPS for sp in spans)]
    if not beds:
        return [_check("echo-bed-ending", False, unit="echo", evidence={
            "why": "the Echo has no bed cue (score.cue_role bed): the closer's written ending cannot be checked"})]
    signoff_start = next((part_span(p)[0] for p, seg in parts(play) if seg == "signoff" and part_span(p)), None)
    theme_cues = [c for c in cues if SCORE.cue_role(c) == "main_title"]
    found = []
    for c in beds:
        probs = []
        if signoff_start is None:
            probs.append("no sign-off part in the spine's order: the bed's ending cannot be timed to it")
        else:
            gap = signoff_start - float(c["end_s"])
            if gap < ECHO_BED_GAP_S - 1e-6:
                probs.append(f"ends {gap:.2f} s before the sign-off; bible h needs at least {ECHO_BED_GAP_S:g} s of room")
        for t in theme_cues:
            ov = _overlap(float(c["start_s"]), float(c["end_s"]), float(t["start_s"]), float(t["end_s"]))
            if ov > OVERLAP_EPS:
                probs.append(f"overlaps the theme ({t.get('id')}) by {ov:.2f} s: never a crossfade into the theme")
        found.append(_check("echo-bed-ending", not probs, unit=c.get("id"), evidence={
            "problems": probs, "bed_end_s": float(c["end_s"]), "signoff_start_s": signoff_start}))
    return _summary("echo-bed-ending", found, len(beds))


def ceiling_checks(play: dict, durations: dict | None) -> list[dict]:
    rt = runtime(play)
    spans = sorted((v["start"], v["end"]) for v in voiced(play, durations))
    total, cur = 0.0, None
    for a, b in spans:
        if cur is None or a > cur[1]:
            if cur:
                total += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        total += cur[1] - cur[0]
    share = total / rt if rt > 0 else 0.0
    return [_check("narration-ceiling", share <= NARRATION_CEILING + 1e-9, unit="film", evidence={
        "voiced_s": round(total, 2), "runtime_s": round(rt, 2), "share": round(share, 4), "ceiling": NARRATION_CEILING})]


def disclosure_checks(play: dict) -> list[dict]:
    voices = {v.get("id"): v for v in (play.get("cast") or {}).get("voices", []) if isinstance(v, dict)}
    roles: dict[str, str] = {}
    for p in play.get("parts") or []:
        for ln in p.get("lines") or []:
            if ln.get("kind") in SC.NARRATOR_KINDS:
                roles.setdefault(ln.get("read_by") or "v-narrator", "narrator")
    found = []
    for _, ln in SC.reader_lines(play):
        if ln.get("read_by"):
            roles.setdefault(ln["read_by"], "reader")
        else:
            found.append(_check("voice-disclosed", False, unit=ln.get("id"), evidence={
                "role": "reader", "problems": ["the reader line names no voice (read_by), so no credit or dot label "
                                               "discloses the computer voice that reads it"]}))
    for vid, role in roles.items():
        v = voices.get(vid)
        probs = []
        if v is None:
            probs.append(f"the {role}'s voice {vid!r} is not in cast.voices")
        else:
            if not VOICE_CREDIT.search(str(v.get("credit") or "")):
                probs.append("its credit names the synthesised or computer voice (credits and sources page)")
            if v.get("dot_label") != DOT_LABELS[role]:
                probs.append(f"its dot_label is {DOT_LABELS[role]!r} (bible g)")
        found.append(_check("voice-disclosed", not probs, unit=vid, evidence={"role": role, "problems": probs}))
    return found or [_check("voice-disclosed", True, evidence={"voices": 0})]


BLANK_CARDS = ("statement", "silent", "perspective")     # cards that draw only their text[]: blank without it


def card_drawn_as(s: dict, part: dict, first: bool) -> str:
    """The card kind the engine draws for a card shot (render.card_kind's order): what reaches the screen, so a
    ``kind: credits`` part draws the credits roll, a title part the wordmark."""
    if s.get("kind") == "black":
        return "black"
    if s.get("card"):
        return str(s["card"])
    if s.get("silent_record"):
        return "silent"
    if part.get("kind") in ("title", "credits"):
        return part["kind"]
    if part.get("kind") == "chapter" and first:
        return "chapter"
    return "statement"


def black_shots(play: dict) -> list[tuple[dict, str]]:
    """(shot, how) for every shot that puts black on screen: a black shot, a black card, and a card that draws only
    its text[] with no text in it."""
    out = []
    for p in play.get("parts") or []:
        for k, s in enumerate(p.get("shots") or []):
            if s.get("kind") not in ("black", "card"):
                continue
            ck = card_drawn_as(s, p, k == 0)
            if ck == "black":
                out.append((s, "black shot" if s.get("kind") == "black" else "black card"))
            elif ck in BLANK_CARDS and not any(str(x).strip() for x in s.get("text") or []):
                out.append((s, "blank card"))
    return out


def black_checks(play: dict) -> list[dict]:
    rt = runtime(play)
    blacks = black_shots(play)
    total = sum(shot_dur(s) for s, _ in blacks)
    share = total / rt if rt > 0 else 0.0
    out = [_check("black-share", share <= BLACK_SHARE_MAX + 1e-9, unit="film", evidence={
        "black_s": round(total, 2), "runtime_s": round(rt, 2), "share": round(share, 4), "max": BLACK_SHARE_MAX,
        "shots": [{"id": s.get("id"), "as": how, "dur_s": shot_dur(s)} for s, how in blacks]})]
    for s, how in blacks:
        # a black shot's reason is black_reason (the engine refuses it on a card); a card's is its intent or reason
        reason = s.get("black_reason") or s.get("reason") if s.get("kind") == "black" else s.get("reason")
        words = re.findall(r"[A-Za-z']+", reason) if isinstance(reason, str) else []
        ok = bool(s.get("intent")) or (len(words) >= BLACK_REASON_MIN_WORDS and len({w.lower() for w in words}) > 1)
        out.append(_check("black-share", ok, unit=s.get("id"), evidence={
            "as": how, "reason": reason, "intent": s.get("intent"),
            **({} if ok else {"fix": "every black on screen states its reason: a black shot's black_reason (a "
                                     "sentence), a card's intent or reason"})}))
    return out


FRAME_ASPECT = 16 / 9
TOUR_SAMPLE_S = 0.1


def _own_page(item: dict | None) -> dict | None:
    op = (item or {}).get("own_property")
    return op if isinstance(op, dict) and isinstance(op.get("page"), dict) else None


def picture_size(item: dict | None):
    """A still's (width, height) from its ledger item: an own page's captured page, or the item's own width and
    height. None when the ledger does not say (the lint never opens the file: CI holds no media)."""
    op = _own_page(item)
    if op and op["page"].get("width") and op["page"].get("height"):
        return float(op["page"]["width"]), float(op["page"]["height"])
    if item and item.get("width") and item.get("height"):
        return float(item["width"]), float(item["height"])
    return None


def stop_window(size, stop: dict):
    """The window (x0, y0, x1, y1) a camera stop asks for, unclamped (tour.py's geometry: the centre as fractions
    of the picture, z relative to the fill window), so a stop that would leave the picture is seen."""
    iw, ih = size
    fw, fh = (ih * FRAME_ASPECT, ih) if iw / ih >= FRAME_ASPECT else (iw, iw / FRAME_ASPECT)
    z = float(stop.get("z", 1.0))
    w, h = fw / z, fh / z
    cx, cy = float(stop.get("x", 0.5)) * iw, float(stop.get("y", 0.5)) * ih
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


def path_windows(size, camera: list) -> list:
    """Every window along an authored camera path: the stops and the straight line between them every 0.1 s."""
    stops = sorted((s for s in camera if isinstance(s, dict) and "t" in s), key=lambda s: float(s["t"]))
    out = []
    for a, b in zip(stops, stops[1:] or stops):
        ta, tb = float(a["t"]), float(b["t"])
        n = max(1, int((tb - ta) / TOUR_SAMPLE_S))
        for k in range(n + 1):
            u = k / n
            out.append(stop_window(size, {key: float(a.get(key, d)) + u * (float(b.get(key, d)) - float(a.get(key, d)))
                                          for key, d in (("x", 0.5), ("y", 0.5), ("z", 1.0))}))
    return out


def _box(b: dict):
    return float(b["x"]), float(b["y"]), float(b["x"]) + float(b["w"]), float(b["y"]) + float(b["h"])


def _meets(w, b) -> bool:
    return w[0] < b[2] and b[0] < w[2] and w[1] < b[3] and b[1] < w[3]


def tour_checks(play: dict, assets: dict, inputs: dict) -> list[dict]:
    """``tour-window-inside``: every window of a filled still's authored camera path (``fill_ok``) lies inside the
    picture, at z 1 or more, and off every band its ledger item marks no-tour."""
    inside, n_in = [], 0
    for p, _seg in parts(play):
        for s in p.get("shots") or []:
            cam = s.get("camera")
            if not isinstance(cam, list) or not cam or not s.get("asset"):
                continue
            item = assets.get(s["asset"])
            size = picture_size(item)
            if size is None:
                if s.get("fill_ok"):
                    inside.append(_check("tour-window-inside", True, unit=s.get("id"), severity="review", evidence={
                        "asset": s["asset"], "why": "the ledger states no picture size, so the path cannot be read"}))
                continue
            wins = path_windows(size, cam)
            if s.get("fill_ok"):
                n_in += 1
                bands = [_box(b["box"]) for b in ((_own_page(item) or {}).get("no_tour") or [])
                         if isinstance(b, dict) and isinstance(b.get("box"), dict)]
                low_z = [st for st in cam if float(st.get("z", 1.0)) < 1.0]
                out = [w for w in wins if w[0] < -0.5 or w[1] < -0.5 or w[2] > size[0] + 0.5 or w[3] > size[1] + 0.5]
                on_band = [w for w in wins if any(_meets(w, b) for b in bands)]
                ok = not (low_z or out or on_band)
                first = (out or on_band or [None])[0]
                inside.append(_check("tour-window-inside", ok, unit=s.get("id"), evidence={
                    "asset": s["asset"], "size": size, "windows": len(wins), "outside": len(out),
                    "on_no_tour": len(on_band), "below_fill": len(low_z),
                    **({} if ok else {"first": [round(v, 1) for v in first] if first else None,
                                      "fix": "a path whose every window is inside the picture, off its no-tour bands"})}))
    return _summary("tour-window-inside", inside, n_in)


def deferred_checks() -> list[dict]:
    return [_check(rule, True, severity="not_implemented", evidence={"deferred_to": to, "what": what})
            for rule, (to, what) in DEFERRED.items()]


def _guarded(rule: str, fn, *args) -> list[dict]:
    """A lint's checks, or one failure of ``rule`` when the record (or the screenplay) has a shape the lint cannot
    read: a malformed input is a finding, never a crash that hides every other lint."""
    try:
        return fn(*args)
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as e:
        return [_check(rule, False, unit="news", evidence={
            "why": f"the inputs cannot be read by this lint: {type(e).__name__}: {e}",
            "fix": "the week record, rundown and echo pick have the shapes studio/news/schema.py states"})]


def checks(play: dict, assets: dict | None = None, *, film: Path | None = None, durations: dict | None = None,
           inputs: dict | None = None) -> list[dict]:
    """Every news check for an omnibus screenplay (none for another show): the schema's, then the bible's."""
    if not SC.is_news(play):
        return []
    play = SC.settled(SC.news_play(play), film)     # the screenplay's own line kinds; its spine, judged once
    assets = assets or {}
    out = SC.checks(play, assets)
    problems = []
    if inputs is None:
        inputs, problems = load_inputs(play, film)
    out.append(_check("news-inputs", not problems, unit="news", evidence={"news": play.get("news"), "problems": problems}))
    if inputs.get("record") is None:
        return out + deferred_checks()
    out += _guarded("as-of", as_of_checks, play, assets, inputs)
    out += _guarded(PUBLISHED_BY_EDITION, published_by_edition_checks, play, assets)
    out += _guarded(FAIR_USE_REFUSED, fair_use_refused_checks, play, assets)
    out += _guarded(DOT_LABEL_CARRIED, dot_label_checks, play, assets)
    out += _guarded("never-tell", language_checks, play, inputs, durations)
    out += _guarded("no-outlet-characterisation", outlet_checks, play, inputs)
    out += _guarded("no-bridge", bridge_checks, play, inputs)
    out += _guarded("counts-match", counts_checks, play, inputs)
    out += _guarded("quote-verbatim", quote_checks, play, inputs)
    out += _guarded("no-music-under-news", music_checks, play, durations)
    out += _guarded("echo-bed-ending", echo_bed_ending_checks, play)
    out += _guarded("narration-ceiling", ceiling_checks, play, durations)
    out += _guarded("voice-disclosed", disclosure_checks, play)
    out += _guarded("black-share", black_checks, play)
    out += _guarded("tour-window-inside", tour_checks, play, assets, inputs)
    return out + deferred_checks()


RULES = ("show-profile", "news-fields", "segment-spine", "package-count", "part-segment", "part-as-of-declared",
         "part-shape", "graphic-schema", "alteration-marked", "sound-role", "card-kind", "line-schema",
         "reader-quote-sha", "reader-read-by", "silence-reason", "news-inputs", "as-of", PUBLISHED_BY_EDITION,
         FAIR_USE_REFUSED, DOT_LABEL_CARRIED, "never-tell", "hindsight-language", "no-outlet-characterisation",
         "no-bridge", "counts-match", "quote-verbatim", "no-music-under-news", "no-music-under-quote",
         "echo-bed-ending", "narration-ceiling", "voice-disclosed", "black-share", "tour-window-inside", *DEFERRED)
# Show bible v2 section o's die list, gone from every screenplay (the frozen issue 33 included): never a rule here.
DIED = ("board-rule", "tour-no-claim-before-board", "ladder-labels-derived", "ending-question", "fair-use-excerpt",
        "fair-use-on-timeline", "title-lines-verbatim")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.news.lints", description=__doc__.split("\n\n")[0])
    ap.add_argument("film", type=Path, help="the film folder (its screenplay.json and ledgers)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    from studio.engine.render import load_ledgers     # the engine's own ledger reader (a CLI only: no cycle at import)
    play = json.loads((a.film / "screenplay.json").read_text(encoding="utf-8"))
    res = checks(play, load_ledgers(a.film, play), film=a.film)
    if a.json:
        print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
    else:
        for c in res:
            if not c["ok"] or c["severity"] != "block":
                print(f"{'PASS' if c['ok'] else 'FAIL'} [{c['severity']}] {c['rule']} {c['unit'] or ''}: "
                      f"{json.dumps(c['evidence'], ensure_ascii=False, default=str)[:300]}")
    bad = [c for c in res if not c["ok"] and c["severity"] == "block"]
    print(f"news lints: {len(res)} checks, {len(bad)} blocking failure(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
