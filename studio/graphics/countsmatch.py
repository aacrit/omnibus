"""counts-match: before a layer is screenshotted, read the numbers back
out of the page's own markup (text content the shoot script pulled from
the DOM) and assert they equal the data that was typeset in. Pure: this
module never touches a browser, only the already-extracted strings.
"""

from __future__ import annotations

import re

_NUMERIC = re.compile(r"[^0-9.\-]")


def normalise_numeral(text: str) -> str:
    """Strip thousands separators and surrounding whitespace so "10,000"
    and "10000" compare equal; a bare numeral stays a string so "039"
    is never silently treated as 39."""
    return _NUMERIC.sub("", text.replace(",", "")).strip()


class CountsMismatch(Exception):
    def __init__(self, mismatches: list[str]):
        self.mismatches = mismatches
        super().__init__("; ".join(mismatches))


def check_counts(expected: dict[str, object], shown: dict[str, str]) -> list[str]:
    """``expected`` maps a field name to the number (or digit-bearing
    string) the data holds; ``shown`` maps the same field name to the
    text read from the DOM. Returns a list of mismatch descriptions
    (empty means every count matched)."""
    problems = []
    for field, want in expected.items():
        if field not in shown:
            problems.append(f"{field}: no value read from the page")
            continue
        got_raw = shown[field]
        want_norm = normalise_numeral(str(want))
        got_norm = normalise_numeral(got_raw)
        if want_norm != got_norm:
            problems.append(f"{field}: data says {want!r}, page shows {got_raw!r}")
    return problems


def assert_counts_match(expected: dict[str, object], shown: dict[str, str]) -> None:
    problems = check_counts(expected, shown)
    if problems:
        raise CountsMismatch(problems)
