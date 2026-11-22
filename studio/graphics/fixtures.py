"""The week-32 regression fixture (E6 acceptance: "a week-32 run
reproduces the G2 mocks... within a pixel-diff threshold").

Week 32 is schema 1 and predates the rundown this generator otherwise
reads (`episodes/32/rundown.json` does not exist: week 32 is the
Blueprint-phase rehearsal, built directly by the studio designer into
the committed mocks). So this fixture's *copy* (the board's headlines,
the count card's context sentence, the end board's licence line) is
transcribed from the already G2-approved mock files themselves
(`design/mocks/broadcast/*.html`) rather than re-derived from
`data/week-32.json` field by field: those mocks are the ground truth
this check exists to reproduce, and re-deriving their editorial prose
here would just be a second, parallel claim about what the record says,
not a stronger one. The *numbers* that do live in `data/week-32.json`
(the day and lead buckets, the lead's board rows are not present in
that schema, so the board page here is this fixture's own, documented
below) are cross-checked against it in
`studio/tests/test_graphics_fixtures.py`.
"""

from __future__ import annotations

from .layout import load_lean_label_text
from .data import (
    BoardRow,
    BoardSpec,
    ClockSpec,
    CountCardSpec,
    CountRow,
    EndBoardSpec,
    LowerThirdSpec,
    TestCardSpec,
)

ISSUE = 32
WEEK_LINE = "WEEK 32 · 26 OCT TO 1 NOV 2026"

# `data/week-32.json`: days[*].lead.buckets summed = [0, 6, 71, 93, 34, 27, 7] (238 placed);
# `lead.buckets` = [0, 0, 5, 14, 1, 0, 1] (21 of 39); `margins.stories[*].buckets` summed =
# [0, 2, 8, 8, 2, 2, 0] (22) - the mocks' own figures (spec.md 3.3).
TESTCARD_WEEK = TestCardSpec(
    subtype="week", word="THE WEEK", week_line=WEEK_LINE,
    bars=(0, 6, 71, 93, 34, 27, 7), placed=238,
    caption="OUTLETS CARRYING EACH DAY'S LEAD · 238 PLACED",
)
TESTCARD_WEIGHT = TestCardSpec(
    subtype="weight", word="THE WEIGHT", week_line=WEEK_LINE,
    bars=(0, 0, 5, 14, 1, 0, 1), placed=21,
    caption="OUTLETS CARRYING THE LEAD · 21 PLACED",
)
TESTCARD_MARGINS = TestCardSpec(
    subtype="margins", word="THE MARGINS", week_line=WEEK_LINE,
    bars=(0, 2, 8, 8, 2, 2, 0), placed=22,
    caption="OUTLETS CARRYING THE THREE STORIES · 22 PLACED",
)
TESTCARD_ECHO = TestCardSpec(subtype="echo", word="THE ECHO", week_line="WEEK 32 · HORIZON 1918 TO 1919",
                              year="1918")

ALL_TESTCARDS = (TESTCARD_WEEK, TESTCARD_WEIGHT, TESTCARD_MARGINS, TESTCARD_ECHO)

# The board's four rows: `data/week-32.json`'s own `lead.board` array
# (schema 1 carries the board pre-computed, unlike schema 2's rows, which
# live in the rundown instead); `studio/tests/test_graphics_fixtures.py`
# cross-checks these against that file directly, sha256 included.
BOARD = BoardSpec(
    head_left="THE WEIGHT",
    head_right="WEEK 32",
    rows=(
        BoardRow(rung="center-left", outlet="NPR",
                 headline="Israel's election too close to call. And, the Ebola outbreak reaches grim milestone",
                 headline_sha256="94532c54b934f09d84af689b292c0470c528cc8f81e60d994cca6d7874195943"),
        BoardRow(rung="center", outlet="Associated Press",
                 headline="Congo’s Ebola outbreak tops 10,000 cases as authorities race to slow the spread in African countries - AP News",
                 headline_sha256="4917dc830be2da8e3907b07644b7b8e55d8fe01f4bb301861b1208ea7f8fb7ed"),
        BoardRow(rung="center-right", outlet="The Telegraph",
                 headline="Risk of Ebola spread in UK is low, experts stress",
                 headline_sha256="fb02ffa4ae2dfad5c1a66cf02307aeeef76b0770d1738be78927615ad84c94cd"),
        BoardRow(rung="far-right", outlet="CGTN (China Global Television Network)",
                 headline="UN officials condemn killing of nurse in DR Congo - CGTN",
                 headline_sha256="2285b83952e0ab831ab8ad86420634d290299dc372f6d3d58e127d708090d634"),
    ),
    untitled={},
    rung_labels=load_lean_label_text(),
)

LOWER_THIRD = LowerThirdSpec(
    id="lt-fixture-32", place="Toledo province, Spain", date="Wed 28 Oct 2026",
    speaker_name="", role="", dot_labels=("Synthesised voice",),
)

COUNT_CARD = CountCardSpec(
    id="cw-fixture-32", eyebrow="THE WEIGHT", week_label="WEEK 32",
    rows=(CountRow(hero="10,000", context="Ebola cases in the outbreak in Africa, most of them in DR Congo.",
                   qualifier="Passed"),),
    date_line="AS OF 26 OCT 2026",
)

CLOCK = ClockSpec(hour=20, minute=59, second=54, date_line="MON 02 NOV 2026 · UTC")

END_BOARD = EndBoardSpec(issue=32, roman_year="MMXXVI", licence="CC BY-SA 4.0", domain="omnibus.voidvision.org")


# ===========================================================================
# v2 (show bible v2, ticket 4): a graphics-only episode fixture.
#
# Issue 35 (bible q) is real; this is not - it carries no news, no sources,
# no voices. It exists because ticket 4 ships before ticket 2's rundown/2
# normaliser (and so before episodes/35/screenplay.json), and the acceptance
# asks for a 2-minute episode-draft.yml dispatch all the same: "if none
# exists yet, render the fixture." Issue 900 is picked precisely because it
# cannot collide with a real week (issues run in the 30s this decade).
#
# It is the single source: `episodes/900/screenplay.json`, the file
# episode-draft.yml's `route` job actually checks for and `render.py`'s CLI
# actually reads, is this dict dumped verbatim
# (`studio/tests/test_graphics_render_episode.py` asserts the two match, so
# they can never drift apart). It exercises every subtype this ticket
# draws: a bumper with no year (briefs) and with one (the Echo), a locator
# with one place and with two, an sot_super with a third line and without,
# and two brief strips.
# ===========================================================================

EPISODE_V2_FIXTURE = {
    "title": "void omnibus: ticket 4 graphics fixture",
    "show": "omnibus",
    "issue": 900,
    "_note": "studio/graphics/render.py, ticket 4 (show bible v2): exercises bumper, locator, sot_super and "
             "brief_strip end to end on Actions. Not a real issue: episode 900 reports no news.",
    "parts": [
        {
            "id": "p-tease", "segment": "tease",
            "shots": [
                {"id": "G-LOC-1", "kind": "graphic", "subtype": "locator", "mark": "DRAWN", "dur_s": 4.0,
                 "locator": {"places": [{"name": "Shenzhen", "lat": 22.54, "lon": 114.06}], "scale_km": 500,
                             "push_s": [1.0, 2.5]},
                 "shows": {"lines": ["Shenzhen"]}},
            ],
            "text": [
                {"id": "G-BSTRIP-1", "kind": "graphic", "subtype": "brief_strip", "start_s": 0.0, "end_s": 4.0,
                 "shows": {"lines": ["SHENZHEN · THU 19 NOV"]}},
            ],
        },
        {
            "id": "p-briefs", "segment": "briefs",
            "shots": [
                {"id": "G-BUMPER-BRIEFS", "kind": "graphic", "subtype": "bumper", "mark": "DRAWN", "dur_s": 1.8,
                 "shows": {"lines": ["AROUND THE WORLD", "ISSUE 900   16 TO 21 NOV 2026"]}},
                {"id": "G-LOC-2", "kind": "graphic", "subtype": "locator", "mark": "DRAWN", "dur_s": 4.0,
                 "locator": {"places": [{"name": "Kerch Strait", "lat": 45.36, "lon": 36.47},
                                         {"name": "Kyiv", "lat": 50.45, "lon": 30.52}], "scale_km": 200,
                             "push_s": [1.0, 2.5]},
                 "shows": {"lines": ["Kerch Strait", "Kyiv"]}},
            ],
            "text": [
                {"id": "G-BSTRIP-2", "kind": "graphic", "subtype": "brief_strip", "start_s": 4.0, "end_s": 12.0,
                 "shows": {"lines": ["KERCH STRAIT · TUE 17 NOV"]}},
            ],
        },
        {
            "id": "p-lead", "segment": "lead",
            "shots": [],
            "text": [
                {"id": "G-SOT-1", "kind": "graphic", "subtype": "sot_super", "start_s": 20.0, "end_s": 34.0,
                 "shows": {"lines": ["Vladimir Putin", "President of Russia",
                                     "TRANSLATION · KREMLIN TRANSCRIPT"]}},
                {"id": "G-SOT-2", "kind": "graphic", "subtype": "sot_super", "start_s": 40.0, "end_s": 52.0,
                 "shows": {"lines": ["Donald Trump", "President of the United States"]}},
            ],
        },
        {
            "id": "p-echo", "segment": "echo",
            "shots": [
                {"id": "G-BUMPER-ECHO", "kind": "graphic", "subtype": "bumper", "mark": "DRAWN", "dur_s": 1.8,
                 "shows": {"lines": ["THE ECHO", "ISSUE 900   16 TO 21 NOV 2026", "1962"]}},
            ],
            "text": [],
        },
    ],
}
