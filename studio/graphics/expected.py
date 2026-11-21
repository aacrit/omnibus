"""What counts-match expects on screen, read from the committed week
record (`data/week-<n>.json`) and echo-pick, never from the rundown's or
the typesetter's own copies of the numbers: a number that drifted between
the record and the rundown must fail here, not be agreed with itself.
Pure: given the loaded JSON dicts, no I/O.
"""

from __future__ import annotations

import re

_STEP = re.compile(r"([A-Za-z_]+)|\[(\d+)\]")


def resolve(record: dict, path: str):
    """``resolve(week, "days[0].lead.buckets")``: a dotted path with list
    indices into the record. Raises KeyError/IndexError on a missing
    field rather than guessing."""
    node = record
    for part in path.split("."):
        for name, index in _STEP.findall(part):
            node = node[name] if name else node[int(index)]
    return node


def _sum_columns(rows: list[list[int]]) -> list[int]:
    return [sum(col) for col in zip(*rows)]


def testcard_bars(week: dict, subtype: str) -> list[int]:
    """The Week = each day's lead summed; The Weight = the claim's rung
    counts; The Margins = the three stories summed (spec 3.3)."""
    if subtype == "week":
        return _sum_columns([d["lead"]["buckets"] for d in week["days"]])
    if subtype == "weight":
        return list(week["lead"]["claim"]["rung_counts"])
    if subtype == "margins":
        return _sum_columns([s["buckets"] for s in week["margins"]["stories"]])
    raise ValueError(f"no measured bars for test card {subtype!r}")


def testcard_caption_counts(week: dict, subtype: str) -> dict[str, int]:
    """The numerals the caption prints: N PLACED always, N UNPLACED for
    The Weight (`lead.claim.unplaced`)."""
    out = {"placed": sum(testcard_bars(week, subtype))}
    if subtype == "weight":
        out["unplaced"] = week["lead"]["claim"]["unplaced"]
    return out


def day_bar_placed(week: dict, bars_field: str) -> int:
    return sum(resolve(week, bars_field))


def title_source_counts(week: dict) -> list[int]:
    """The SRC column of the title's seven lines: each day's lead
    `source_count`, Monday first."""
    return [d["lead"]["source_count"] for d in week["days"]]


def board_rows(week: dict) -> list[tuple[str, str]]:
    """(rung, outlet) for every titled board row, in the record's order."""
    return [(r["rung"], r["outlet"]) for r in week["lead"]["board"]]


def count_card_numbers(week: dict, echo_pick: dict, card_id: str) -> list[str]:
    """Every numeral a count card prints, in reading order (hero, then any
    numeral in its context line, row by row), from the record."""
    claim = week["lead"]["claim"]
    if card_id == "cw-1":
        out = []
        for t in claim["terms"]:
            out += [str(t["titled"]), str(claim["titled"])]
        return out
    if card_id == "cw-2":
        return [str(claim["outlets"])]
    if card_id == "cw-3":
        return [str(claim["titled"]), str(claim["articles"])]
    if card_id == "cw-4":
        (pick,) = [c for c in echo_pick["counts_on_screen"] if c.get("source") == "src-nh-manual-1953"]
        return [str(v) for v in pick["values"].values()]
    raise ValueError(f"no expected numbers for count card {card_id!r}")


_NUM = re.compile(r"\d[\d,]*")


def numerals_in(text: str) -> list[str]:
    """Every numeral in a run of text, thousands separators removed."""
    return [m.group(0).replace(",", "") for m in _NUM.finditer(text)]
