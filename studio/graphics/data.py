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

from dataclasses import dataclass, field


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


def board_spec(rundown: dict, week: dict, *, issue: int) -> BoardSpec:
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
    return BoardSpec(head_left="THE WEIGHT", head_right=f"WEEK {issue}", rows=rows, untitled=untitled)


# ---- count cards (3.7) ---------------------------------------------------

@dataclass(frozen=True)
class CountRow:
    hero: str
    context: str
    qualifier: str | None = None


@dataclass(frozen=True)
class CountCardSpec:
    id: str
    eyebrow: str
    week_label: str
    rows: tuple[CountRow, ...]
    date_line: str | None = None


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
    part = _part(rundown, "the-weight")
    cards = []
    for beat in part.get("beats", []):
        if beat.get("id") != "weight-known":
            continue
        for i, cc in enumerate(beat.get("count_cards", []), start=2):
            context = cc["context"] if "of" not in cc else f"{cc['context']} (of {cc['of']})"
            rows = (CountRow(hero=str(cc["hero"]), context=context),)
            cards.append(CountCardSpec(id=f"cw-{i}", eyebrow="THE WEIGHT", week_label=f"WEEK {issue}",
                                        rows=rows, date_line=date_line))
    return cards


def echo_comparison_card(rundown: dict, *, issue: int, date_line: str) -> CountCardSpec | None:
    """The echo-x5 count card named in `counts_on_screen`: two numerals
    compared (Kefauver's and Truman's New Hampshire vote)."""
    for item in rundown.get("counts_on_screen", []):
        if item.get("where") == "echo-x5 count card" and isinstance(item.get("value"), dict):
            rows = tuple(CountRow(hero=f"{v:,}", context=name) for name, v in item["value"].items())
            return CountCardSpec(id="cw-4", eyebrow="THE ECHO", week_label=f"WEEK {issue}", rows=rows,
                                  date_line=date_line)
    return None


def all_count_cards(rundown: dict, week: dict, *, issue: int, date_line: str) -> list[CountCardSpec]:
    out = [claim_term_card(week, issue=issue, date_line=date_line)]
    out.extend(weight_known_count_cards(rundown, issue=issue, date_line=date_line))
    echo_card = echo_comparison_card(rundown, issue=issue, date_line=date_line)
    if echo_card:
        out.append(echo_card)
    return out


# ---- lower thirds (3.5) ---------------------------------------------------

@dataclass(frozen=True)
class LowerThirdSpec:
    id: str
    place: str
    date: str
    speaker_name: str
    role: str
    dot_label: str = "RECONSTRUCTED"


def _split_slate(slate: str) -> tuple[str, str]:
    place, _, date = slate.partition(" · ")
    return place.strip(), date.strip()


def _split_who(who: str) -> tuple[str, str]:
    name, _, role = who.partition(",")
    return name.strip(), role.strip()


def lower_thirds(rundown: dict, echo_pick: dict) -> list[LowerThirdSpec]:
    by_source = {}
    for pp in echo_pick.get("period_perspectives", []):
        src = pp.get("source")
        if src:
            by_source[src] = pp
    part = _part(rundown, "the-echo")
    out: list[LowerThirdSpec] = []
    for beat in part.get("beats", []):
        slate = beat.get("slate")
        readers = beat.get("reader")
        if not slate or not readers:
            continue
        source = readers[0].get("source")
        pp = by_source.get(source)
        if not pp:
            continue
        place, date = _split_slate(slate)
        name, role = _split_who(pp["who"])
        out.append(LowerThirdSpec(id=f"lt-{beat['id']}", place=place, date=date, speaker_name=name, role=role))
    return out


# ---- clock (3.9) ----------------------------------------------------------

@dataclass(frozen=True)
class ClockSpec:
    hour: int
    minute: int
    second: int
    date_line: str


def clock_spec(*, hour: int = 20, minute: int = 59, second: int = 54, date_line: str) -> ClockSpec:
    return ClockSpec(hour=hour, minute=minute, second=second, date_line=date_line)


# ---- credits and end board (3.11) ----------------------------------------

@dataclass(frozen=True)
class CreditsSpec:
    lines: tuple[str, ...]


def credits_spec(rundown: dict, rights_ledger: dict | None, *, max_credits: int = 40) -> CreditsSpec:
    lines: list[str] = []
    if rights_ledger:
        for item in rights_ledger.get("items", [])[:max_credits]:
            title = item.get("title")
            if title:
                lines.append(title)
    part = _part(rundown, "credits")
    lines.extend(part.get("disclosures", []))
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


def title_macro_spec(rundown: dict) -> TitleMacroSpec:
    part = _part(rundown, "title")
    return TitleMacroSpec(
        lines=tuple(part["title_lines"]),
        week_line=part["week_line"],
        rate_cps=part["strike"]["rate_cps"],
    )
