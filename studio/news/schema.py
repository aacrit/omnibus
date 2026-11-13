# Net-new in omnibus (E3).
"""The omnibus screenplay's own fields, checked at plan time. Pure: no I/O.

What an omnibus screenplay (``show: "omnibus"``, studio/news/profile.py) adds to screenplay v2 (GRAMMAR 12):

- top level: ``issue`` (the week's number: its pages are /e/<issue>/...), ``news`` naming its inputs
  (``{"week": "data/week-33.json", "rundown": "episodes/33/rundown.json", "echo_pick": "episodes/33/echo-pick.json"}``,
  each relative to the film folder or, failing that, to the repo root);
- each part: ``segment`` (one of SEGMENTS: which part of the bible's spine it is) and its own ``as_of`` (an ISO
  date or date-time with a zone: the part's horizon; The Week's beats each carry the day's print time, The Echo its
  own century). The clock (its time is the release time, clock-true at release) and the credits are exempt;
- the spine (``segment-spine``): the clock is the first part and the credits the last, each exactly once, and the
  parts run in SEGMENTS order (The Week's days may repeat a segment). A label is trusted only where the order puts
  it (``segments``): an exemption (the clock's, the credits') is read from that checked order, never from a part's
  own label or its ``kind``, so a news part labelled ``credits`` or ``clock`` is still linted as news;
- the ``graphic`` kind (studio/news/graphic.py), as a shot (full frame) or a part's text element (over a picture):
  ``subtype`` (graphic.SUBTYPES), ``asset`` (its graphics-ledger item), ``data_ref`` (a field path into the week
  record, ``echo:`` for echo-pick.json) for the subtypes that draw figures, and ``shows``: what it puts on screen,
  as data the lints read (``lines`` of our own text, ``figures`` [{value, field}], board ``rows``, ``headlines``
  [{text, headline_sha256}], ``title_lines`` and ``week_line``). A testcard, day or count graphic declares at least
  one figure; a board declares its rows;
- every reader line (a ``testimony`` line read by a computer voice) carries ``quote_sha256``, the sha256 of its
  text as extracted (rundown reader[]), and ``read_by``, the cast voice that reads it (``reader-read-by``);
- the alteration ``text composited`` (type laid over an archival picture: the title's teleprinter) is allowed, and a
  shot that names any alteration is RECONSTRUCTED;
- every ``silence: intended`` moment (a shot, a part, a cue or a top-level ``moments`` entry) states its ``reason``
  (the founder's ruling: no music under any quote, so the windows the score leaves open are declared, and why).
"""

from __future__ import annotations

import re

from studio.news import graphic as G
from studio.news import profile as SHOW

GRAMMAR = "omnibus E3"
SEGMENTS = ("clock", "cold_open", "title", "week", "weight", "echo", "margins", "question", "credits")
NEWS_SEGMENTS = ("cold_open", "week", "weight", "margins")      # bible g: no music under news (and none in the open)
AS_OF_EXEMPT = ("clock", "credits")
SPINE_ONCE = ("clock", "credits")                                 # first and last, exactly once each
TEXT_COMPOSITED = "text composited"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REASON_MIN_WORDS = 4
SHOWS_KEYS = {"lines", "figures", "rows", "headlines", "title_lines", "week_line"}
# An ISO date (YYYY-MM-DD) or a date-time with a zone (Z or +hh:mm): a part's horizon is an instant, or a whole day
AS_OF_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$")


def _check(rule, ok, *, unit=None, severity="block", evidence=None) -> dict:
    return {"rule": rule, "ok": bool(ok), "unit": unit, "severity": severity, "evidence": evidence, "grammar": GRAMMAR}


def _words(text) -> int:
    return len(re.findall(r"[A-Za-z']+", text)) if isinstance(text, str) else 0


def is_news(play: dict) -> bool:
    try:
        return bool(SHOW.of(play)["news"])
    except SHOW.ShowError:
        return False


def reader_lines(play: dict) -> list[tuple[dict, dict]]:
    """(part, line) for every line a computer voice reads as a quotation: a testimony line that plays no clip."""
    return [(p, ln) for p in play.get("parts") or [] for ln in p.get("lines") or []
            if ln.get("kind") == "testimony" and not ln.get("clip") and not ln.get("archival_audio")]


def segments(play: dict) -> list[str | None]:
    """Each part's segment as the checked order trusts it (aligned with ``parts``), None where it does not: a label
    outside SEGMENTS, a clock that is not the first part, credits that are not the last, or a part off the longest
    run of labels in SEGMENTS order (the clock and the credits never repeat). Every exemption reads this, never a
    part's own label or kind, so a mislabelled news part is still linted as news."""
    parts = play.get("parts") or []
    n = len(parts)
    rank = {x: i for i, x in enumerate(SEGMENTS)}
    labels = [p.get("segment") if isinstance(p, dict) and isinstance(p.get("segment"), str) else None for p in parts]
    cand = [k for k, x in enumerate(labels) if x in rank and not (x == "clock" and k != 0)
            and not (x == "credits" and k != n - 1)]
    best, prev = [1] * len(cand), [-1] * len(cand)
    for a in range(len(cand)):
        ra = rank[labels[cand[a]]]
        for b in range(a):
            rb = rank[labels[cand[b]]]
            if (rb < ra or (rb == ra and labels[cand[a]] not in SPINE_ONCE)) and best[b] + 1 > best[a]:
                best[a], prev[a] = best[b] + 1, b
    out: list[str | None] = [None] * n
    if cand:
        k = max(range(len(cand)), key=lambda i: (best[i], -i))
        while k != -1:
            out[cand[k]] = labels[cand[k]]
            k = prev[k]
    return out


def spine_problems(play: dict) -> list[str]:
    """Why the parts do not run as the bible's spine, one line each ([] when they do)."""
    parts = play.get("parts") or []
    if not parts:
        return ["the screenplay has no parts"]
    labels = [p.get("segment") if isinstance(p, dict) else None for p in parts]
    trusted = segments(play)
    out = []
    if labels[0] != "clock":
        out.append(f"the first part is the clock, not {labels[0]!r}")
    if labels[-1] != "credits":
        out.append(f"the last part is the credits, not {labels[-1]!r}")
    for seg in SPINE_ONCE:
        c = labels.count(seg)
        if c > 1:
            out.append(f"{c} parts are labelled {seg}: there is exactly one")
    for p, lab, t in zip(parts, labels, trusted):
        if lab in SEGMENTS and t is None:
            out.append(f"part {p.get('id')} ({lab}) is out of the spine's order {list(SEGMENTS)}: it is linted as news")
    return out


def graphic_problems(x: dict, item: dict | None, *, overlay: bool) -> list[str]:
    """Why a graphic shot (or, with ``overlay``, a graphic text element) is malformed, one line each."""
    out = []
    sub = x.get("subtype")
    allowed = G.OVERLAY_SUBTYPES if overlay else G.SUBTYPES
    if sub not in allowed:
        out.append(f"subtype must be one of {list(allowed)}, not {sub!r}")
    if not x.get("asset"):
        out.append("a graphic cites its pre-rendered clip as its asset (the graphics ledger)")
    elif item is None:
        out.append(f"asset {x.get('asset')!r} is in no ledger")
    if not overlay and x.get("mark") != "DRAWN":
        out.append(f"a graphic is DRAWN, not {x.get('mark')!r}")
    if sub in G.DATA_SUBTYPES and not (isinstance(x.get("data_ref"), str) and x["data_ref"].strip()):
        out.append(f"a {sub} graphic draws figures from the record, so it names its data_ref")
    shows = x.get("shows")
    if shows is not None:
        if not isinstance(shows, dict):
            out.append("shows is an object")
        else:
            extra = sorted(set(shows) - SHOWS_KEYS)
            if extra:
                out.append(f"shows has unknown keys {extra} (known: {sorted(SHOWS_KEYS)})")
    sh = shows if isinstance(shows, dict) else {}
    if sub in G.FIGURE_SUBTYPES and not (isinstance(sh.get("figures"), list) and sh["figures"]):
        out.append(f"a {sub} graphic declares the figures it draws (shows.figures: at least one {{value, field}}), so "
                   "counts-match can hold them to the record")
    if sub == "board" and not (isinstance(sh.get("rows"), list) and sh["rows"]):
        out.append("a board declares the rows it shows (shows.rows), so board-rule can hold them to the record")
    if item is not None:
        alpha = item.get("alpha")
        if alpha not in (None, False) and alpha not in G.ALPHA_MODES:
            out.append(f"alpha must be 'straight' (or absent for an opaque clip), not {alpha!r}: loom and the overlay "
                       "pass read alpha straight")
        if overlay and alpha not in G.ALPHA_MODES:
            out.append("a graphic drawn over a picture needs a straight alpha (alpha: 'straight')")
        if G.rate_of(item) is None:
            out.append(f"the clip's fps must be 24, 30000/1001 or 30, not {item.get('fps')!r}")
        if not isinstance(item.get("frames"), int) or isinstance(item.get("frames"), bool) or item["frames"] <= 0:
            out.append("the clip states its frame count (frames)")
    if overlay:
        try:
            if not float(x["end_s"]) > float(x["start_s"]):
                out.append("end_s is after start_s")
        except (KeyError, TypeError, ValueError):
            out.append("a graphic over a picture states start_s and end_s")
    return out


def _silences(play: dict):
    for p in play.get("parts") or []:
        if p.get("silence") == "intended":
            yield f"part {p.get('id')}", p
        for coll in ("shots", "cues"):
            for x in p.get(coll) or []:
                if x.get("silence") == "intended":
                    yield x.get("id"), x
    for coll in ("music", "moments"):
        for x in play.get(coll) or []:
            if x.get("silence") == "intended":
                yield x.get("id"), x


def checks(play: dict, assets: dict | None = None) -> list[dict]:
    """Every schema check for an omnibus screenplay ([] for any other show: these fields bind only on news)."""
    assets = assets or {}
    out = []
    probs = SHOW.problems(play)
    out.append(_check("show-profile", not probs, unit="show", evidence={"show": play.get("show"), "problems": probs}))
    if probs or not is_news(play):
        return out
    # parts: a segment each, in the spine's order, and a horizon each (the trusted clock and credits aside)
    sp = spine_problems(play)
    out.append(_check("segment-spine", not sp, unit="parts", evidence={
        "segments": [p.get("segment") for p in play.get("parts") or []], "problems": sp}))
    for p, trusted in zip(play.get("parts") or [], segments(play)):
        seg = p.get("segment")
        out.append(_check("part-segment", seg in SEGMENTS, unit=f"part {p.get('id')}",
                          evidence={"segment": seg, "segments": list(SEGMENTS)}))
        if trusted in AS_OF_EXEMPT:
            continue
        a = p.get("as_of")
        ok = isinstance(a, str) and bool(AS_OF_RE.match(a.strip()))
        out.append(_check("part-as-of-declared", ok, unit=f"part {p.get('id')}",
                          evidence={"as_of": a, **({} if ok else {
                              "fix": "the part's horizon: an ISO date, or a date-time with its zone (2026-11-02T00:59:28Z)"})}))
    # graphics, as shots and as text elements
    for p in play.get("parts") or []:
        for s in p.get("shots") or []:
            if G.is_graphic(s):
                pr = graphic_problems(s, assets.get(s.get("asset")), overlay=False)
                out.append(_check("graphic-schema", not pr, unit=s.get("id"),
                                  evidence={"subtype": s.get("subtype"), "problems": pr}))
            alts = s.get("alterations") or []
            if alts:
                ok = s.get("mark") == "RECONSTRUCTED"
                out.append(_check("alteration-marked", ok, unit=s.get("id"), evidence={
                    "alterations": alts, "mark": s.get("mark"),
                    **({} if ok else {"fix": "a shot that names an alteration (text composited included) is RECONSTRUCTED"})}))
        for t in p.get("text") or []:
            if G.is_graphic(t):
                pr = graphic_problems(t, assets.get(t.get("asset")), overlay=True)
                out.append(_check("graphic-schema", not pr, unit=t.get("id"),
                                  evidence={"subtype": t.get("subtype"), "problems": pr}))
    # reader lines carry the hash of their extract
    for _, ln in reader_lines(play):
        h = ln.get("quote_sha256")
        ok = isinstance(h, str) and bool(SHA256.match(h))
        out.append(_check("reader-quote-sha", ok, unit=ln.get("id"), evidence={
            "quote_sha256": h, **({} if ok else {"fix": "a reader line carries quote_sha256: its extract's sha256 (rundown reader[])"})}))
        rb = ln.get("read_by")
        ok = isinstance(rb, str) and bool(rb.strip())
        out.append(_check("reader-read-by", ok, unit=ln.get("id"), evidence={
            "read_by": rb, **({} if ok else {"fix": "a reader line names the cast voice that reads it (read_by), so its "
                                                    "computer voice is disclosed"})}))
    # every intended silence says why
    for unit, x in _silences(play):
        ok = _words(x.get("reason")) >= REASON_MIN_WORDS
        out.append(_check("silence-reason", ok, unit=unit, evidence={
            "reason": x.get("reason"), **({} if ok else {"fix": f"silence: intended states its reason (a sentence, at least "
                                                               f"{REASON_MIN_WORDS} words)"})}))
    return out
