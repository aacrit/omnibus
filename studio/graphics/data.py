"""Extraction: turn `data/week-<n>.json`, `episodes/<n>/rundown.json`,
`episodes/<n>/echo-pick.json` and `episodes/<n>/rights-ledger.json` into
the small, typed specs `typeset.py` draws from. Every function here is
pure (given the already-loaded JSON dicts) and names the field it read
in a comment or a `field` attribute, the same provenance habit the
rundown itself uses, so a reviewer can trace any number on screen back
to the record. No network, no filesystem beyond what the caller already
loaded.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def as_of_line(iso: str) -> str:
    """Spec 3.7's date line, ``AS OF 26 OCT 2026``, from an ISO time."""
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return f"AS OF {d.day:02d} {MONTHS[d.month - 1]} {d.year}"


# ---- shared -------------------------------------------------------------

def _part(rundown: dict, part_id: str) -> dict:
    for p in rundown["parts"]:
        if p.get("id") == part_id:
            return p
    raise KeyError(f"rundown has no part {part_id!r}")


def _find_testcard(part: dict) -> dict:
    if "testcard" in part:
        return part["testcard"]
    for beat in part.get("beats", []):
        if "testcard" in beat:
            return beat["testcard"]
    raise KeyError(f"part {part.get('id')!r} has no testcard")


# ---- test cards (3.3, 3.4) ----------------------------------------------

@dataclass(frozen=True)
class TestCardSpec:
    subtype: str          # "week" | "weight" | "echo" | "margins"
    word: str
    week_line: str
    hold_s: float = 1.8
    bars: tuple[int, ...] | None = None     # None for the echo card (decorative, not measured)
    placed: int | None = None
    caption: str | None = None
    year: str | None = None                  # echo only


def testcard_spec(rundown: dict, subtype: str, *, issue: int) -> TestCardSpec:
    part_id = {"week": "the-week", "weight": "the-weight", "echo": "the-echo", "margins": "the-margins"}[subtype]
    tc = _find_testcard(_part(rundown, part_id))
    if subtype == "echo":
        return TestCardSpec(
            subtype=subtype,
            word=tc["word"],
            week_line=tc["line"],
            year=tc["year"],
        )
    return TestCardSpec(
        subtype=subtype,
        word=tc["word"],
        week_line=tc.get("week_line") or f"WEEK {issue}",
        bars=tuple(tc["bars"]),
        placed=tc.get("placed"),
        caption=tc["caption"],
    )


def all_testcards(rundown: dict, *, issue: int) -> list[TestCardSpec]:
    return [testcard_spec(rundown, s, issue=issue) for s in ("week", "weight", "echo", "margins")]


# ---- day lean bars (the-week's per-day device) --------------------------

@dataclass(frozen=True)
class DayBarSpec:
    day: str
    slate: str
    bars: tuple[int, ...]
    placed: int
    unplaced: int
    caption: str
    bars_field: str = ""   # the week record's field the bars were read from (counts-match reads it back)


def day_bars(rundown: dict) -> list[DayBarSpec]:
    part = _part(rundown, "the-week")
    out = []
    for beat in part.get("beats", []):
        dev = beat.get("device", {})
        if dev.get("kind") != "day-bars":
            continue
        out.append(DayBarSpec(
            day=beat["day"],
            slate=beat["slate"],
            bars=tuple(dev["bars"]),
            placed=dev["placed"],
            unplaced=dev["unplaced"],
            caption=dev["caption"],
            bars_field=dev.get("bars_field", ""),
        ))
    return out


# ---- framings board (3.6) -----------------------------------------------

@dataclass(frozen=True)
class BoardRow:
    rung: str
    outlet: str
    headline: str
    headline_sha256: str


@dataclass(frozen=True)
class BoardSpec:
    head_left: str
    head_right: str
    rows: tuple[BoardRow, ...]
    untitled: dict[str, list[str]] = field(default_factory=dict)   # rung -> outlet names, no headline
    rung_labels: dict[str, str] = field(default_factory=dict)      # LEAN_LABEL_TEXT, read from ladder.mjs


def board_spec(rundown: dict, week: dict, *, issue: int, rung_labels: dict[str, str]) -> BoardSpec:
    part = _part(rundown, "the-weight")
    rows_raw = None
    for beat in part.get("beats", []):
        if beat.get("id") == "weight-board":
            rows_raw = beat["rows"]
            break
    if rows_raw is None:
        raise KeyError("the-weight has no weight-board beat")
    rows = tuple(
        BoardRow(rung=r["rung"], outlet=r["outlet"], headline=r["headline"], headline_sha256=r["headline_sha256"])
        for r in rows_raw
    )
    untitled = week.get("lead", {}).get("board_untitled_outlets", {}) or {}
    return BoardSpec(head_left="THE WEIGHT", head_right=f"WEEK {issue}", rows=rows, untitled=untitled,
                     rung_labels=dict(rung_labels))


# ---- count cards (3.7) ---------------------------------------------------

@dataclass(frozen=True)
class CountRow:
    hero: str
    context: str
    qualifier: str | None = None


def _words(text: str | None) -> int:
    return len(text.split()) if text else 0


@dataclass(frozen=True)
class CountCardSpec:
    id: str
    eyebrow: str
    week_label: str
    rows: tuple[CountRow, ...]
    date_line: str | None = None
    echo: bool = False

    @property
    def words(self) -> int:
        """Every word the viewer reads below the card's head: each row's
        qualifier, numeral and context line, and the date line."""
        return (sum(_words(r.qualifier) + _words(r.hero) + _words(r.context) for r in self.rows)
                + _words(self.date_line))

    @property
    def hold_s(self) -> float:
        """Spec 3.7: hold words / 3 + 1.5 s."""
        return self.words / 3 + 1.5


def claim_term_card(week: dict, *, issue: int, date_line: str) -> CountCardSpec:
    """cw-1: the consensus card's reason words (Iran, Israel, inflation for
    week 33), `lead.claim.terms` - each term's titled-headline count, of
    the claim's total titled headlines."""
    claim = week["lead"]["claim"]
    total_titled = claim["titled"]
    rows = tuple(
        CountRow(hero=str(t["titled"]), context=f"{t['term']}, of {total_titled} titled headlines")
        for t in claim["terms"]
    )
    return CountCardSpec(id="cw-1", eyebrow="THE WEIGHT", week_label=f"WEEK {issue}", rows=rows, date_line=date_line)


def weight_known_count_cards(rundown: dict, *, issue: int, date_line: str) -> list[CountCardSpec]:
    """cw-2, cw-3: the rundown's own count cards. The context line is the
    rundown's sentence as written; its `of` field is a number that
    sentence already carries ("titled headlines of 89 articles"), so it is
    checked against the context and never appended a second time."""
    part = _part(rundown, "the-weight")
    cards = []
    for beat in part.get("beats", []):
        if beat.get("id") != "weight-known":
            continue
        for i, cc in enumerate(beat.get("count_cards", []), start=2):
            context = cc["context"]
            if "of" in cc and f"of {cc['of']}" not in context:
                raise ValueError(f"cw-{i}: context {context!r} does not carry its 'of {cc['of']}'")
            rows = (CountRow(hero=str(cc["hero"]), context=context),)
            cards.append(CountCardSpec(id=f"cw-{i}", eyebrow="THE WEIGHT", week_label=f"WEEK {issue}",
                                        rows=rows, date_line=date_line))
    return cards


def echo_comparison_card(rundown: dict, echo_pick: dict, *, issue: int) -> CountCardSpec | None:
    """cw-4, the Echo's New Hampshire count (echo-x5). Numerals and basis
    come from echo-pick's `counts_on_screen` (src-nh-manual-1953: the New
    Hampshire primary of 11 Mar 1952, the State canvass printed in 1953).
    The rundown's count card must name the same source and values, and its
    date line must be the one echo-pick's basis quotes; any disagreement
    raises. The first row carries echo-pick's own `what` as its qualifier
    (typeset.py shows a multi-row card's qualifier once, above the rows,
    since it is shared), so the card names these as New Hampshire
    Democratic primary votes rather than bare candidate names; it is not
    repeated on every row, which would double its word count and over-hold
    the card."""
    part = _part(rundown, "the-echo")
    for beat in part.get("beats", []):
        for cc in beat.get("count_cards", []) or []:
            src = cc.get("source")
            picks = [c for c in echo_pick.get("counts_on_screen", []) if c.get("source") == src]
            if not picks:
                raise ValueError(f"{beat['id']}: count card source {src!r} is not in echo-pick counts_on_screen")
            pick = picks[0]
            if cc.get("values") != pick["values"]:
                raise ValueError(f"{beat['id']}: rundown values {cc.get('values')} differ from echo-pick {pick['values']}")
            date_line = cc.get("date_line")
            if not date_line or f"'{date_line}'" not in pick.get("basis", ""):
                raise ValueError(f"{beat['id']}: date line {date_line!r} is not the one echo-pick's basis quotes")
            qualifier = pick.get("what")
            rows = tuple(
                CountRow(hero=f"{v:,}", context=name, qualifier=qualifier if i == 0 else None)
                for i, (name, v) in enumerate(pick["values"].items())
            )
            return CountCardSpec(id="cw-4", eyebrow="THE ECHO", week_label=f"WEEK {issue}", rows=rows,
                                  date_line=date_line, echo=True)
    return None


def all_count_cards(rundown: dict, week: dict, echo_pick: dict, *, issue: int) -> list[CountCardSpec]:
    date_line = as_of_line(week["as_of"])
    out = [claim_term_card(week, issue=issue, date_line=date_line)]
    out.extend(weight_known_count_cards(rundown, issue=issue, date_line=date_line))
    echo_card = echo_comparison_card(rundown, echo_pick, issue=issue)
    if echo_card:
        out.append(echo_card)
    return out


# ---- lower thirds (3.5, 3.10) ---------------------------------------------

@dataclass(frozen=True)
class LowerThirdSpec:
    id: str
    place: str
    date: str
    speaker_name: str
    role: str
    dot_labels: tuple[str, ...]
    echo: bool = False


COMPUTER_VOICE = "COMPUTER VOICE"
SYNTHESISED_VOICE = "SYNTHESISED VOICE"
TRANSCRIBED_PAGE = "TRANSCRIBED PAGE"


def voice_dot_label(voice: dict) -> str:
    """Spec 3.5's dot label for a voice. A stock engine voice (Kokoro) is
    COMPUTER VOICE; the founder's own voice, synthesised with consent
    (`founder: true` on the voice), is SYNTHESISED VOICE. Anything else is
    refused: a voice is never labelled by guess, and never RECONSTRUCTED."""
    if voice.get("founder"):
        return SYNTHESISED_VOICE
    if voice.get("engine") == "kokoro":
        return COMPUTER_VOICE
    raise ValueError(f"no dot label for voice {voice!r}")


_PAREN = re.compile(r"\s*\(([^)]*)\)")


def normalise_source_id(raw: str) -> tuple[str, str]:
    """``"src-eisenhower-19521024 (transcribed from the scan)"`` becomes
    ``("src-eisenhower-19521024", "transcribed from the scan")``: the id
    without its parentheticals, and the notes they carried."""
    notes = "; ".join(m.group(1).strip() for m in _PAREN.finditer(raw))
    return _PAREN.sub("", raw).strip(), notes


def _split_slate(slate: str) -> tuple[str, str]:
    place, _, date = slate.partition(" · ")
    return place.strip(), date.strip()


def _split_who(who: str) -> tuple[str, str]:
    name, _, role = who.partition(",")
    return name.strip(), role.strip()


def lower_thirds(rundown: dict, echo_pick: dict) -> list[LowerThirdSpec]:
    """One lower third for every Echo beat whose words the reader speaks:
    the slate's place and date; the speaker from echo-pick's
    `period_perspectives` (joined on the normalised source id) or, for a
    period document the reader voices (`period_documents`), no speaker.
    The dot labels the voice from `voices.reader`, plus TRANSCRIBED PAGE
    when the source's own record says its text is a transcription. A
    reader beat that cannot be joined raises: no voice goes unlabelled."""
    voice_label = voice_dot_label(rundown["voices"]["reader"])
    people: dict[str, tuple[dict, str]] = {}
    for pp in echo_pick.get("period_perspectives", []):
        if pp.get("source"):
            sid, notes = normalise_source_id(pp["source"])
            people[sid] = (pp, notes)
    documents = {normalise_source_id(d["id"])[0] for d in echo_pick.get("period_documents", []) if d.get("id")}
    part = _part(rundown, "the-echo")
    out: list[LowerThirdSpec] = []
    reader_beats: list[str] = []
    for beat in part.get("beats", []):
        readers = beat.get("reader")
        if not readers:
            continue
        reader_beats.append(beat["id"])
        slate = beat.get("slate")
        if not slate:
            raise ValueError(f"{beat['id']}: the reader speaks but the beat has no slate for its lower third")
        sources = {normalise_source_id(r.get("source", ""))[0] for r in readers}
        if len(sources) != 1:
            raise ValueError(f"{beat['id']}: reader lines come from {sorted(sources)}; one lower third needs one source")
        (sid,) = sources
        place, date = _split_slate(slate)
        labels = [voice_label]
        if sid in people:
            pp, notes = people[sid]
            name, role = _split_who(pp["who"])
        elif sid in documents:
            name, role, notes = "", "", ""
        else:
            raise ValueError(f"{beat['id']}: reader source {sid!r} is in neither period_perspectives "
                             "nor period_documents")
        if "transcribed" in notes.lower():
            labels.append(TRANSCRIBED_PAGE)
        out.append(LowerThirdSpec(id=f"lt-{beat['id']}", place=place, date=date, speaker_name=name, role=role,
                                  dot_labels=tuple(labels), echo=True))
    made = [lt.id[3:] for lt in out]
    if made != reader_beats:
        raise ValueError(f"reader beats {reader_beats} but lower thirds for {made}")
    return out


# ---- clock (3.9) ----------------------------------------------------------

@dataclass(frozen=True)
class ClockSpec:
    hour: int
    minute: int
    second: int
    date_line: str
    release: str | None = None        # the airtime the sweep ends on, ISO UTC
    release_nominal: bool = False     # a pre-release pass: not yet clock-true


def parse_release(text: str) -> datetime:
    """``--release``: an ISO time with a UTC offset, on a whole second."""
    d = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError(f"--release {text!r} needs a UTC offset (e.g. 2026-11-16T21:00:00Z)")
    d = d.astimezone(timezone.utc)
    if d.microsecond:
        raise ValueError(f"--release {text!r} must fall on a whole second")
    return d


def clock_spec_for_release(release: datetime, *, nominal: bool, sweep_s: int = 6) -> ClockSpec:
    """Spec 3.9: the second hand sweeps the last six seconds to the
    airtime; the date line is the airtime's own date
    (``MON 02 NOV 2026 · UTC``)."""
    start = release - timedelta(seconds=sweep_s)
    date_line = f"{WEEKDAYS[release.weekday()]} {release.day:02d} {MONTHS[release.month - 1]} {release.year} · UTC"
    return ClockSpec(hour=start.hour, minute=start.minute, second=start.second, date_line=date_line,
                     release=release.strftime("%Y-%m-%dT%H:%M:%SZ"), release_nominal=nominal)


def clock_spec(*, hour: int = 20, minute: int = 59, second: int = 54, date_line: str) -> ClockSpec:
    return ClockSpec(hour=hour, minute=minute, second=second, date_line=date_line)


# ---- credits and end board (3.11) ----------------------------------------

@dataclass(frozen=True)
class CreditsSpec:
    lines: tuple[str, ...]


ENGINE_NAMES = {"kokoro": "Kokoro"}


def voice_credit_line(voices: dict) -> str:
    """Spec 3.11's voice disclosure: the founder's line once their voice
    lands (`founder: true`), the stand-in line (the rundown's credits
    plan) until then. An unknown engine raises."""
    narrator, reader = voices["narrator"], voices["reader"]
    if reader.get("engine") not in ENGINE_NAMES:
        raise ValueError(f"no credit line for reader engine {reader.get('engine')!r}")
    reader_part = f"quotations read by {ENGINE_NAMES[reader['engine']]} {reader['voice']}"
    if narrator.get("founder"):
        return f"Narrated in the founder's voice, synthesised with their consent; {reader_part}"
    if narrator.get("engine") not in ENGINE_NAMES:
        raise ValueError(f"no credit line for narrator engine {narrator.get('engine')!r}")
    return f"Narrated by a computer voice, {ENGINE_NAMES[narrator['engine']]} {narrator['voice']}; {reader_part}"


def credits_spec(rundown: dict, rights_ledger: dict, *, max_credits: int = 40) -> CreditsSpec:
    """Spec 3.11: every asset's credit (each item's `credit`, in ledger
    order; a credit several assets share is listed once), then the voice
    disclosure, then the rundown's disclosures. More distinct credits
    than the roll holds raises: nothing is silently cut."""
    credits: list[str] = []
    for item in rights_ledger.get("items", []):
        credit = item.get("credit")
        if not credit:
            raise ValueError(f"rights ledger item {item.get('id')!r} has no credit")
        if credit not in credits:
            credits.append(credit)
    if len(credits) > max_credits:
        raise ValueError(f"{len(credits)} distinct credits exceed the roll's {max_credits}")
    lines = credits + [voice_credit_line(rundown["voices"])]
    lines.extend(_part(rundown, "credits").get("disclosures", []))
    return CreditsSpec(lines=tuple(lines))


def _to_roman(n: int) -> str:
    vals = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
            (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = []
    for v, sym in vals:
        count, n = divmod(n, v)
        out.append(sym * count)
    return "".join(out)


@dataclass(frozen=True)
class EndBoardSpec:
    issue: int
    roman_year: str
    licence: str
    domain: str


def end_board_spec(week: dict, *, licence: str = "CC BY-SA 4.0", domain: str = "omnibus.voidvision.org") -> EndBoardSpec:
    year = int(week["week_start"][:4])
    return EndBoardSpec(issue=week["issue"], roman_year=_to_roman(year), licence=licence, domain=domain)


# ---- title typed-paper macro (3.2) ---------------------------------------

@dataclass(frozen=True)
class TitleMacroSpec:
    lines: tuple[str, ...]
    week_line: str
    rate_cps: float
    columns: int = 69
    print_window_s: float | None = None   # the whole macro: strikes, platen steps, week line, bell and tear


def title_macro_spec(rundown: dict) -> TitleMacroSpec:
    from .layout import check_strike_rate
    part = _part(rundown, "title")
    lines = tuple(part["title_lines"])
    strike = part["strike"]
    chars = sum(len(x) for x in lines)
    if strike.get("characters") is not None and strike["characters"] != chars:
        raise ValueError(f"strike.characters {strike['characters']} != {chars} characters in title_lines")
    return TitleMacroSpec(
        lines=lines,
        week_line=part["week_line"],
        rate_cps=check_strike_rate(strike["rate_cps"]),
        print_window_s=strike.get("print_window_s"),
    )
