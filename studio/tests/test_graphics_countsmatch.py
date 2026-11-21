"""E6: counts-match - the numbers read back from a layer's own markup
must equal the data, including the ticket's own worked example (cw-1:
Iran 39, Israel 4, inflation 1 of 46)."""

from __future__ import annotations

import pytest

from studio.graphics import countsmatch


def test_normalise_numeral_strips_thousands_separator():
    assert countsmatch.normalise_numeral("10,000") == "10000"
    assert countsmatch.normalise_numeral("  39 ") == "39"


def test_matching_counts_pass():
    expected = {"iran": 39, "israel": 4, "inflation": 1}
    shown = {"iran": "39", "israel": "4", "inflation": "1"}
    assert countsmatch.check_counts(expected, shown) == []


def test_matching_counts_pass_with_thousands_separator():
    expected = {"placed": 10000}
    shown = {"placed": "10,000"}
    assert countsmatch.check_counts(expected, shown) == []


def test_mismatch_is_reported():
    expected = {"iran": 39}
    shown = {"iran": "38"}
    problems = countsmatch.check_counts(expected, shown)
    assert len(problems) == 1
    assert "39" in problems[0] and "38" in problems[0]


def test_missing_field_is_reported():
    problems = countsmatch.check_counts({"israel": 4}, {})
    assert "israel" in problems[0]


def test_assert_counts_match_raises_on_any_mismatch():
    with pytest.raises(countsmatch.CountsMismatch) as exc:
        countsmatch.assert_counts_match({"inflation": 1}, {"inflation": "2"})
    assert "inflation" in str(exc.value)


def test_assert_counts_match_passes_silently():
    countsmatch.assert_counts_match({"a": 1, "b": 2}, {"a": "1", "b": "2"})
