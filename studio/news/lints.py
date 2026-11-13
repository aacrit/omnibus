# Net-new in omnibus (E3).
"""The programme's blocking lints (show bible j), for an omnibus screenplay.

    python -m studio.news.lints <film dir> [--json]

``render.build_plan`` journals every check ``checks`` returns for a screenplay whose show is omnibus (with each voice
line's measured length), so a render refuses on any blocking failure; the command runs the same checks read-only (a
line with no WAV yet is timed by its ``dur_s``, else at 150 words a minute). Each check is
``{rule, ok, unit, severity, evidence, grammar}``, the shape studio/engine/aswas.py returns.

The rules, each over the screenplay and the inputs it names (``news``: the week record, the rundown and the echo
pick; studio/news/schema.py):

- ``as-of`` (part level): everything a part shows or says is dated on or before its own ``as_of``, to the second
  when both state a time: each shot's ledger item (a studio-made item by its ``content_date``), each graphic's
  record data (every dated field under its ``data_ref``), each reading's date, each quoted card's source date, and
  no year after the part's horizon in its narration or text. A whole-day date on the horizon's own day is a review
  item. No part's horizon is after the episode's.
- ``never-tell`` and ``hindsight-language``: the bible's news list (studio/news/lexicon.json) on the narration and
  our own on-screen text, quotations exempt; and no narration line paraphrases a headline the board on screen shows.
- ``no-outlet-characterisation``: no characterising word next to an outlet's name or a media noun (a legal status the
  screenplay states, with its basis, aside).
- ``no-bridge``: none of the week's named persons, places and parties-as-actors (the rundown's Echo ``no_bridge``
  list, founder ruling 2026-11-12: full names, word boundaries, case as written; the 1952 party names are allowed) in
  anything the Echo says or shows, quotations included; and no bridging phrase ("like today", "just as") anywhere.
- ``board-rule``: a board shows the record's rows only (claim records, never context), one per titled occupied rung,
  verbatim and sha-matched, at least three when three are titled; an occupied rung with no titled headline has no
  row (the untitled-rung exception).
- ``counts-match``: every figure a graphic declares equals its record field, and every numeral on screen (cards,
  lower thirds, overlays, graphic lines) is a number the week record or the echo pick holds.
- ``quote-verbatim``: every reader line's text hashes to its ``quote_sha256``, and that hash is an extract the
  rundown or the echo pick records; every displayed headline hashes to its ``headline_sha256``, a hash the record holds.
- ``title-lines-verbatim``: each printed day line is the day's rank-1 headline and count as the record holds them,
  and the week line is the edition's.
- ``no-music-under-news``: no music cue over the cold open, The Week, The Weight or The Margins.
- ``no-music-under-quote`` (founder ruling): no music cue under any reader line.
- ``narration-ceiling``: at most 55% of the runtime voiced.
- ``voice-disclosed``: the narrator and every reader voice state a credit naming the synthesised or computer voice,
  and their dot label.
- ``ending-question``: the last voiced line before the credits is the narrator's, a question, followed by at least
  6 s with no voice.
- ``black-share``: black is at most 3% of the runtime, and every black shot states its reason.

Declared here and run at release (``not_implemented`` until then): ``clock-true``, ``sources-last``, ``no-youtube``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

from studio.engine import aswas as AW
from studio.news import graphic as G
from studio.news import schema as SC

REPO = Path(__file__).resolve().parents[2]
LEXICON_PATH = Path(__file__).resolve().parent / "lexicon.json"
LADDER_PATH = REPO / "web" / "src" / "lib" / "ladder.mjs"
GRAMMAR = "show bible j"
NARRATION_CEILING = 0.55
BLACK_SHARE_MAX = 0.03
QUESTION_SILENCE_S = 6.0
BOARD_MIN_RUNGS, BOARD_MAX_ROWS = 3, 6
EST_WPM = 150.0                       # a line with no WAV and no dur_s is timed at the narrator's rate (rundown voices)
OVERLAP_EPS = 1.0 / 60.0              # under half a frame at 30 fps is not an overlap
PARAPHRASE_SHARE, PARAPHRASE_MIN_WORDS = 0.6, 3
BLACK_REASON_MIN_WORDS = 4
VOICE_CREDIT = re.compile(r"computer voice|synthesi[sz]ed", re.I)
DOT_LABELS = {"narrator": "synthesised voice", "reader": "computer voice"}   # bible g
DATE_KEYS = ("printed_at", "published_at", "record_date", "printed_on", "date", "as_of", "content_date")
STOP = set("the a an and or of to in on at for from with by as is was were be been are it its this that these those "
           "after before over under into than then their his her they he she we our you your not no".split())
DEFERRED = {
    "clock-true": "the clock's time equals the release timestamp within one second: known only when the release is cut",
    "sources-last": "the sources page is published before the episode: checked by the release step",
    "no-youtube": "no YouTube upload while the registry row's audit_passed is false: checked by the release step",
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


def instant(value):
    """``(lo, hi, precise)``: a date-time (with its zone; UTC when it states none) as one instant, a date as its
    whole UTC day, anything aswas.parse_date reads (a year, a month, "before 1948") as its span. None when unread."""
    if isinstance(value, bool) or value is None:
        return None
    s = str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", s):
        try:
            t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
        t = t if t.tzinfo else t.replace(tzinfo=UTC)
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


def record_numbers(inputs: dict) -> set[float]:
    """Every number the week record and the echo pick hold: numeric leaves and the numerals inside their strings."""
    out: set[float] = set()

    def walk(x):
        if _is_num(x):
            out.add(float(x))
        elif isinstance(x, str):
            out.update(numerals(x))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(inputs.get("record"))
    walk(inputs.get("echo"))
    return out


def _dates_under(x) -> list:
    out = []
    if isinstance(x, dict):
        for k, v in x.items():
            if k in DATE_KEYS and isinstance(v, str):
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
    shots = p.get("shots") or []
    if not shots:
        return None
    return (min(float(s.get("start_s") or 0.0) for s in shots),
            max(float(s.get("start_s") or 0.0) + shot_dur(s) for s in shots))


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
            if ln.get("kind") in ("narration", "testimony"):
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


def part_surfaces(part: dict) -> list[dict]:
    """A0's surfaces of one part (narration, our cards, lower thirds, overlays, part titles), plus every graphic's
    own lines of text (``shows.lines``)."""
    out = AW.surfaces({"parts": [part]})
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

    def date_of(value):
        return instant(value)

    for p in play.get("parts") or []:
        if p.get("segment") in SC.AS_OF_EXEMPT:
            continue
        hz = instant(p.get("as_of")) if p.get("as_of") else episode
        if hz is None:
            continue                          # schema's part-as-of-declared names it
        base = {"part": p.get("id"), "as_of": _fmt(hz)}
        checked += 1
        if against(hz, episode) not in ("ok", "same-day"):
            found.append(_check("as-of", False, unit=f"part {p.get('id')}", evidence=dict(
                base, episode_as_of=_fmt(episode), why="the part's horizon is after the episode's")))
        for s in p.get("shots") or []:
            item = assets.get(s.get("asset")) if s.get("asset") else None
            if item is not None and not item.get("test_fixture"):
                checked += 1
                studio = bool(item.get("generator") or item.get("synthetic") or G.is_graphic(s))
                v = item.get("content_date") if item.get("content_date") is not None else (
                    None if studio else (item.get("date") if item.get("date") is not None else item.get("year")))
                d = date_of(v)
                judge(s.get("id"), "undated" if d is None else against(d, hz),
                      dict(base, asset=s.get("asset"), date=v, **({"fix": "a studio-made item declares content_date"}
                                                                    if studio and v is None else {})))
            if s.get("kind") == "card" and s.get("source_date") is not None:
                checked += 1
                d = date_of(s["source_date"])
                judge(s.get("id"), "undated" if d is None else against(d, hz), dict(base, source_date=s["source_date"]))
        for _, g in [(p, x) for x in (p.get("shots") or []) + (p.get("text") or []) if G.is_graphic(x)]:
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
                d = date_of(v)
                if d is not None:
                    judge(g.get("id"), against(d, hz), dict(base, data_ref=g["data_ref"], field=k, date=v))
        for ln in p.get("lines") or []:
            if ln.get("kind") == "testimony":
                v = ln.get("date") if ln.get("date") is not None else ln.get("year")
                if v is not None:
                    checked += 1
                    d = date_of(v)
                    judge(ln.get("id"), "undated" if d is None else against(d, hz), dict(base, date=v))
        for srf in part_surfaces(p):
            late = [y for y in AW.years_in(srf["text"]) if y > hz[1].year]
            if late:
                found.append(_check("as-of", False, unit=srf["unit"], evidence=dict(
                    base, text=srf["text"], years=late, why="names a year after the part's horizon")))
    return _summary("as-of", found, checked)


def _content_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z'-]+", AW._norm(text).lower()) if len(w) >= 4 and w not in STOP}


def language_checks(play: dict, inputs: dict, durations: dict | None) -> list[dict]:
    lex = lexicon()
    tell, hind, n = [], [], 0
    for p in play.get("parts") or []:
        if p.get("segment") == "credits":
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
    # a narration line spoken over a board never paraphrases a headline the board shows
    boards = []
    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if G.is_graphic(s) and s.get("subtype") == "board":
                a = float(s.get("start_s") or 0.0)
                boards.append((s, a, a + shot_dur(s)))
    for v in voiced(play, durations):
        if v["kind"] != "narration":
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
    legal = {o: {str(t).lower() for t in (v.get("terms") or [])}
             for o, v in ((play.get("news") or {}).get("legal_status") or {}).items()
             if isinstance(v, dict) and str(v.get("basis") or "").strip()}
    media = {w.lower() for w in spec["media_nouns"]}
    win = int(spec["window_words"])
    terms = list(spec["terms"]) + [r for r in rungs()]
    found, n = [], 0
    for p in play.get("parts") or []:
        if p.get("segment") == "credits":
            continue
        for srf in part_surfaces(p):
            n += 1
            text = AW._norm(srf["text"])
            words = [(m.start(), m.group(0).lower()) for m in _WORD.finditer(text)]

            def word_at(pos):
                return max([i for i, (a, _) in enumerate(words) if a <= pos] or [0])
            names = []
            for o in outlets:
                for m in re.finditer(r"(?<![\w])" + re.escape(o) + r"(?![\w])", text):
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
                    near = [o for o in near if t.lower() not in legal.get(o, set())]
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


def bridge_checks(play: dict, inputs: dict) -> list[dict]:
    found, n = [], 0
    echo_parts = [p for p in play.get("parts") or [] if p.get("segment") == "echo"]
    names = bridge_list(inputs)
    if echo_parts and names is None:
        return [_check("no-bridge", False, unit="news.rundown", evidence={
            "why": "the screenplay has an Echo but no no_bridge list was found in the rundown or the echo pick"})]
    rxs = [(nm, re.compile(r"(?<![\w])" + re.escape(nm) + r"(?![\w])")) for nm in names or []]
    for p in echo_parts:
        for srf in everything_said(p):
            n += 1
            hits = [nm for nm, rx in rxs if rx.search(srf["text"])]
            if hits:
                found.append(_check("no-bridge", False, unit=srf["unit"], evidence={
                    "part": p.get("id"), "text": srf["text"], "names": hits,
                    "why": "a person, place or party acting in this week's news is named in the Echo"}))
    phrases = lexicon()["bridge_phrases"]
    for p in play.get("parts") or []:
        if p.get("segment") == "credits":
            continue
        for srf in part_surfaces(p):
            n += 1
            hits = AW.phrase_hits(srf["text"], [phrases])
            if hits:
                found.append(_check("no-bridge", False, unit=srf["unit"], evidence={
                    "part": p.get("id"), "text": srf["text"], "hits": hits,
                    "why": "a sentence points between the Echo and the week"}))
    return _summary("no-bridge", found, n)


def board_checks(play: dict, inputs: dict) -> list[dict]:
    found, n = [], 0
    names = rungs()
    for _, g in _graphics(play):
        if g.get("subtype") != "board":
            continue
        n += 1
        ref = str(g.get("data_ref") or "")
        probs = []
        if not ref.endswith(".board"):
            found.append(_check("board-rule", False, unit=g.get("id"), evidence={
                "data_ref": ref, "why": "a board's data_ref names a record's board (…board)"}))
            continue
        try:
            rec_rows = resolve(ref, inputs)
            parent = resolve(ref[: -len(".board")], inputs)
        except FieldError as e:
            found.append(_check("board-rule", False, unit=g.get("id"), evidence={"data_ref": ref, "why": str(e)}))
            continue
        claim = parent.get("claim") or {}
        clusters = set(claim.get("clusters") or [])
        titled = claim.get("titled_by_rung") or []
        counts = claim.get("rung_counts") or []
        shown = (g.get("shows") or {}).get("rows") or []
        by_key = {(r.get("rung"), r.get("outlet"), r.get("headline")): r for r in rec_rows if isinstance(r, dict)}
        for r in rec_rows:
            if r.get("cluster_id") not in clusters:
                probs.append(f"the record's {r.get('rung')} row ({r.get('outlet')}) is from a context record, not the claim")
        seen = []
        for k, r in enumerate(shown):
            key = (r.get("rung"), r.get("outlet"), r.get("headline"))
            rec = by_key.get(key)
            if rec is None:
                probs.append(f"row {k} ({r.get('rung')}, {r.get('outlet')}) is not a row of the record's board, verbatim")
                continue
            if r.get("headline_sha256") != sha256_text(r.get("headline")) or r.get("headline_sha256") != rec.get("headline_sha256"):
                probs.append(f"row {k}'s headline_sha256 does not match its headline and the record's")
            if r.get("rung") in seen:
                probs.append(f"rung {r.get('rung')} has two rows")
            seen.append(r.get("rung"))
        titled_rungs = [names[i] for i, c in enumerate(titled) if i < len(names) and c > 0]
        untitled = [names[i] for i, c in enumerate(counts) if i < len(names) and c > 0 and not (i < len(titled) and titled[i] > 0)]
        missing = [x for x in titled_rungs if x not in seen][: max(0, BOARD_MAX_ROWS - len(seen))]
        if missing:
            probs.append(f"titled occupied rungs with no row: {missing}")
        for x in seen:
            if x in untitled:
                probs.append(f"rung {x} has no titled headline in the claim, so it has no row (untitled-rung exception)")
            elif x not in titled_rungs:
                probs.append(f"rung {x} is not occupied by the claim's titled headlines")
        if len(titled_rungs) >= BOARD_MIN_RUNGS and len(seen) < BOARD_MIN_RUNGS:
            probs.append(f"{len(titled_rungs)} rungs are titled, so the board shows at least {BOARD_MIN_RUNGS}")
        if len(shown) > BOARD_MAX_ROWS:
            probs.append(f"{len(shown)} rows: a board shows at most {BOARD_MAX_ROWS}")
        rec_untitled = sorted(parent.get("board_untitled_rungs") or [])
        if sorted(untitled) != rec_untitled:
            probs.append(f"the record's board_untitled_rungs {rec_untitled} disagree with its counts {sorted(untitled)}")
        found.append(_check("board-rule", not probs, unit=g.get("id"), evidence={
            "data_ref": ref, "rows": len(shown), "titled_rungs": titled_rungs, "untitled_rungs": untitled,
            "problems": probs}))
    return _summary("board-rule", found, n) if n else [_check("board-rule", True, evidence={"boards": 0})]


def _values_equal(a, b) -> bool:
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_values_equal(x, y) for x, y in zip(a, b))
    if _is_num(a) and _is_num(b):
        return abs(float(a) - float(b)) < 1e-9
    return a == b


def counts_checks(play: dict, inputs: dict) -> list[dict]:
    found, n = [], 0
    known = record_numbers(inputs)

    def loose(unit, text, allowed: set[float]):
        nonlocal n
        n += 1
        bad = [x for x in numerals(AW.strip_quotes(text)) if x not in known and x not in allowed]
        if bad:
            found.append(_check("counts-match", False, unit=unit, evidence={
                "text": text, "numerals": [int(x) if x.is_integer() else x for x in bad],
                "why": "a numeral on screen that neither the week record nor the echo pick holds"}))

    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if s.get("kind") == "card" and not s.get("quote"):
                for k, x in enumerate(s.get("text") or []):
                    loose(f"{s.get('id')}.text[{k}]", str(x), set())
        for t in p.get("text") or []:
            if t.get("quote"):
                continue
            for k, x in enumerate(t.get("lines") or []):
                loose(f"{t.get('id')}.lines[{k}]", str(x), set())
    for _, g in _graphics(play):
        sh = g.get("shows") or {}
        allowed: set[float] = set()
        for k, f in enumerate(sh.get("figures") or []):
            n += 1
            try:
                want = resolve(f.get("field"), inputs)
            except FieldError as e:
                found.append(_check("counts-match", False, unit=f"{g.get('id')}.figures[{k}]", evidence={
                    "field": f.get("field"), "value": f.get("value"), "why": f"the field does not resolve: {e}"}))
                continue
            if not _values_equal(f.get("value"), want):
                found.append(_check("counts-match", False, unit=f"{g.get('id')}.figures[{k}]", evidence={
                    "field": f.get("field"), "shown": f.get("value"), "record": want}))
                continue
            for v in (f["value"] if isinstance(f["value"], list) else [f["value"]]):
                if _is_num(v):
                    allowed.add(float(v))
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
    return _summary("quote-verbatim", found, n)


DOW = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
MON = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


def day_stamp(d: dt.date) -> str:
    return f"{DOW[d.weekday()]} {d.day:02d} {MON[d.month - 1]}"


def expected_title_lines(record: dict) -> list[str]:
    """Each printed day line as the record holds it: day, count and the rank-1 headline (in capitals, the
    teleprinter's case), or NO PRINT for a day the record does not hold."""
    out = []
    for day in record.get("days") or []:
        d = dt.date.fromisoformat(day["date"])
        lead = day.get("lead") or {}
        if day.get("available") and lead.get("title"):
            out.append(f"{day_stamp(d)}   {lead.get('source_count')} SRC  {str(lead['title']).upper()}")
        else:
            out.append(f"{day_stamp(d)}   NO PRINT")
    return out


def expected_week_line(record: dict) -> str:
    t = instant(record.get("as_of"))[0]
    return f"WEEK {record.get('issue')}  CLOSED {day_stamp(t.date())} {t.hour:02d}:{t.minute:02d} UTC"


def title_checks(play: dict, inputs: dict) -> list[dict]:
    found, n = [], 0
    rec = inputs.get("record") or {}
    for p in play.get("parts") or []:
        for x in (p.get("shots") or []) + (p.get("text") or []):
            sh = x.get("shows") if isinstance(x.get("shows"), dict) else {}
            if "title_lines" not in sh and "week_line" not in sh:
                continue
            n += 1
            probs = []
            if "title_lines" in sh:
                want, got = expected_title_lines(rec), list(sh.get("title_lines") or [])
                if len(got) != len(want):
                    probs.append(f"{len(got)} day lines; the record has {len(want)} days")
                for k, (a, b) in enumerate(zip(got, want)):
                    if a != b:
                        probs.append({"line": k, "shown": a, "record": b})
            if "week_line" in sh and sh.get("week_line") != expected_week_line(rec):
                probs.append({"week_line": sh.get("week_line"), "record": expected_week_line(rec)})
            found.append(_check("title-lines-verbatim", not probs, unit=x.get("id"), evidence={"problems": probs}))
    return _summary("title-lines-verbatim", found, n) if n else [_check("title-lines-verbatim", True,
                                                                         evidence={"title_lines": 0})]


def music_checks(play: dict, durations: dict | None) -> list[dict]:
    cues = music_cues(play)
    out, news = [], []
    for p in play.get("parts") or []:
        if p.get("segment") not in SC.NEWS_SEGMENTS:
            continue
        sp = part_span(p)
        if sp is None:
            continue
        for c in cues:
            ov = _overlap(sp[0], sp[1], float(c["start_s"]), float(c["end_s"]))
            if ov > OVERLAP_EPS:
                news.append(_check("no-music-under-news", False, unit=c.get("id"), evidence={
                    "part": p.get("id"), "segment": p.get("segment"), "overlap_s": round(ov, 3),
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
            if ln.get("kind") == "narration":
                roles.setdefault(ln.get("read_by") or "v-narrator", "narrator")
    for _, ln in SC.reader_lines(play):
        if ln.get("read_by"):
            roles.setdefault(ln["read_by"], "reader")
    found = []
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


def ending_checks(play: dict, durations: dict | None) -> list[dict]:
    credits = [part_span(p) for p in play.get("parts") or [] if p.get("segment") == "credits"]
    end = min((c[0] for c in credits if c), default=runtime(play))
    vs = [v for v in voiced(play, durations) if v["start"] < end]
    if not vs:
        return [_check("ending-question", False, evidence={"why": "the episode has no voiced line"})]
    last = max(vs, key=lambda v: v["end"])
    probs = []
    if last["kind"] != "narration":
        probs.append("the last voiced line before the credits is not the narrator's")
    elif not AW.QUESTION_END.search(last["text"].rstrip()):
        probs.append("the last narration line is not a question")
    gap = end - last["end"]
    if gap < QUESTION_SILENCE_S - 1e-9:
        probs.append(f"{gap:.2f} s with no voice after it; at least {QUESTION_SILENCE_S:g} s")
    return [_check("ending-question", not probs, unit=last["id"], evidence={
        "text": last["text"], "silence_after_s": round(gap, 2), "timed": last["how"], "problems": probs})]


def black_checks(play: dict) -> list[dict]:
    rt = runtime(play)
    blacks = [s for p in play.get("parts") or [] for s in p.get("shots") or [] if s.get("kind") == "black"]
    total = sum(shot_dur(s) for s in blacks)
    share = total / rt if rt > 0 else 0.0
    out = [_check("black-share", share <= BLACK_SHARE_MAX + 1e-9, unit="film", evidence={
        "black_s": round(total, 2), "runtime_s": round(rt, 2), "share": round(share, 4), "max": BLACK_SHARE_MAX})]
    for s in blacks:
        reason = s.get("black_reason") or s.get("reason")
        words = re.findall(r"[A-Za-z']+", reason) if isinstance(reason, str) else []
        ok = bool(s.get("intent")) or (len(words) >= BLACK_REASON_MIN_WORDS and len({w.lower() for w in words}) > 1)
        out.append(_check("black-share", ok, unit=s.get("id"), evidence={
            "black_reason": reason, "intent": s.get("intent"),
            **({} if ok else {"fix": "every black shot states its reason (black_reason, a sentence)"})}))
    return out


def deferred_checks() -> list[dict]:
    return [_check(rule, True, severity="not_implemented", evidence={"deferred_to": "release", "what": what})
            for rule, what in DEFERRED.items()]


def checks(play: dict, assets: dict | None = None, *, film: Path | None = None, durations: dict | None = None,
           inputs: dict | None = None) -> list[dict]:
    """Every news check for an omnibus screenplay (none for another show): the schema's, then the bible's."""
    if not SC.is_news(play):
        return []
    assets = assets or {}
    out = SC.checks(play, assets)
    problems = []
    if inputs is None:
        inputs, problems = load_inputs(play, film)
    out.append(_check("news-inputs", not problems, unit="news", evidence={"news": play.get("news"), "problems": problems}))
    if inputs.get("record") is None:
        return out + deferred_checks()
    out += as_of_checks(play, assets, inputs)
    out += language_checks(play, inputs, durations)
    out += outlet_checks(play, inputs)
    out += bridge_checks(play, inputs)
    out += board_checks(play, inputs)
    out += counts_checks(play, inputs)
    out += quote_checks(play, inputs)
    out += title_checks(play, inputs)
    out += music_checks(play, durations)
    out += ceiling_checks(play, durations)
    out += disclosure_checks(play)
    out += ending_checks(play, durations)
    out += black_checks(play)
    return out + deferred_checks()


RULES = ("show-profile", "part-segment", "part-as-of-declared", "graphic-schema", "alteration-marked",
         "reader-quote-sha", "silence-reason", "news-inputs", "as-of", "never-tell", "hindsight-language",
         "no-outlet-characterisation", "no-bridge", "board-rule", "counts-match", "quote-verbatim",
         "title-lines-verbatim", "no-music-under-news", "no-music-under-quote", "narration-ceiling", "voice-disclosed",
         "ending-question", "black-share", *DEFERRED)


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
