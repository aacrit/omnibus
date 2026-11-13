# Net-new in omnibus (E3).
"""The omnibus lint fixture: one small episode that passes every news lint, and the mutations that each fail one.

``episode()`` returns ``(play, assets, inputs)``: a screenplay (show omnibus, issue 99, 100 s, every segment of the
bible's spine), its ledger items, and the inputs its ``news`` names (a week record, a rundown and an echo pick),
built in code so every sha256 is the real hash of its text. Nothing here is real news: the outlets, the people and
the place are invented (Ruritania), so no lint can pass by accident on real data.

``FAIL`` maps a case name to (mutation, the rules it must fail). Each mutation changes the pass fixture in one
place; the test asserts those rules, and only those, fail.
"""

from __future__ import annotations

import copy
import hashlib


def h(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


AS_OF = "2026-03-08T20:00:00+00:00"
DAYS = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]
TITLES = ["Ruritania Council Meets on Water Rights", "Flood Barrier Contract Signed in Strelsau",
          "Jane Doe Resigns as Ruritania Water Minister", "Strelsau Schools Close for Repairs",
          "Rail Strike Ends After Talks", "Council Count Continues in Strelsau", "Ruritania Names New Water Minister"]
COUNTS = [12, 14, 31, 9, 15, 22, 18]
BUCKETS = [[0, 1, 3, 2, 2, 1, 0], [0, 2, 3, 3, 1, 1, 0], [0, 2, 5, 8, 3, 2, 0], [0, 0, 2, 3, 1, 1, 0],
           [1, 1, 3, 3, 2, 1, 0], [0, 2, 4, 5, 3, 2, 1], [0, 1, 4, 4, 2, 2, 0]]
BOARD = [("left", "The Daily Example", "Doe Quits Over Water Deal"),
         ("center-left", "Strelsau Herald", "Water Minister Jane Doe Steps Down"),
         ("center", "Ruritania Wire", "Ruritania Water Minister Resigns After Contract Dispute"),
         ("center-right", "Morning Ledger", "Minister Leaves Post as Contract Review Begins")]
READER_1 = "I have resigned because the contract was signed without the council's vote."
READER_2 = "The ballots were counted by hand in every ward."


def record() -> dict:
    days = [{"date": d, "available": True, "printed_at": f"{d}T12:00:00+00:00", "printed_count": 30,
             "lead": {"cluster_id": f"c-day{k + 1}", "edition_position": 1, "title": TITLES[k], "category": "politics",
                      "source_count": COUNTS[k], "buckets": BUCKETS[k]}} for k, d in enumerate(DAYS)]
    board = [{"rung": r, "outlet": o, "cluster_id": "c-claim", "record_date": "2026-03-04", "headline": t,
              "url": f"https://example.org/{k}", "published_at": "2026-03-04T10:00:00+00:00", "sha256": h(t),
              "headline_sha256": h(t)} for k, (r, o, t) in enumerate(BOARD)]
    return {
        "issue": 99, "schema": 2, "week_start": DAYS[0], "week_end": DAYS[-1], "as_of": AS_OF, "edition": "world",
        "cover_headline": "The Water Minister", "days": days,
        "lead": {
            "records": [{"date": "2026-03-04", "role": "claim", "cluster_id": "c-claim", "title": TITLES[2],
                         "source_count": 31}],
            "outlets": 20, "articles": 26, "rung_counts": [0, 2, 5, 8, 3, 2, 0],
            "claim": {"clusters": ["c-claim"], "outlets": 20, "articles": 26, "rung_counts": [0, 2, 5, 8, 3, 2, 0],
                      "titled": 7, "titled_by_rung": [0, 1, 2, 3, 1, 0, 0]},
            "board": board, "board_untitled_rungs": ["right"], "board_untitled_outlets": {"right": ["Evening Courier"]},
            "ledger": [{"outlet": o, "rung": r, "headline": t, "cluster_id": "c-claim",
                        "published_at": "2026-03-04T10:00:00+00:00"} for r, o, t in BOARD]
                      + [{"outlet": "Evening Courier", "rung": "right", "headline": "", "cluster_id": "c-claim",
                          "published_at": "2026-03-04T11:00:00+00:00"}],
        },
        "margins": {"stories": [{"cluster_id": "c-m1", "title": "Bridge Inspection Finds Cracks", "source_count": 4,
                                 "printed_on": "2026-03-06", "buckets": [0, 1, 2, 0, 0, 1, 0]}]},
    }


def rundown() -> dict:
    return {"schema": "omnibus.rundown/1", "issue": 99, "parts": [
        {"id": "the-weight", "beats": [{"id": "w1", "reader": [{"text": READER_1, "quote_sha256": h(READER_1)}]}]},
        {"id": "the-echo", "no_bridge": {"must_not_appear": ["Ruritania", "Strelsau", "Jane Doe", "Doe"],
                                         "ruling": "fixture: the week's named persons and places"}},
    ]}


def echo_pick() -> dict:
    return {"issue": 99, "counts_on_screen": [{"what": "ward count", "values": {"Ayes": 312, "Noes": 288}}],
            "period_documents": [{"id": "src-1952", "quote_sha256": h(READER_2)}]}


def _graphic_item(gid: str, content_date: str, frames: int = 180) -> dict:
    return {"id": gid, "file": f"{gid}.mov", "kind": "graphic", "fps": "30", "frames": frames, "alpha": "straight",
            "generator": "studio/graphics (E6)", "content_date": content_date,
            "content_basis": "drawn from the week record's fields named in its data_ref", "licence": "CC0"}


def _own_page(headline: str, box: dict) -> dict:
    return {"publication": "fixture", "edition": "2026-03-07", "page": {"width": 1920, "height": 3000},
            "tour_target": {"headline": headline, "box": box},
            "no_tour": [{"why": "a band built from another day", "box": {"x": 0, "y": 300, "w": 1920, "h": 600}}]}


def assets() -> dict:
    return {
        "g-clock": _graphic_item("g-clock", AS_OF),
        "st-open": {"id": "st-open", "date": "2026-03-07", "licence": "public domain", "title": "Count, Strelsau",
                    "own_property": _own_page(TITLES[5], {"x": 200, "y": 1500, "w": 600, "h": 80})},
        # an own page of the same edition toured to a claim record's headline: the box no tour shows before the board
        "st-claim-page": {"id": "st-claim-page", "date": "2026-03-07", "licence": "public domain", "title": "Claim page",
                          "own_property": _own_page(TITLES[2], {"x": 1100, "y": 2400, "w": 600, "h": 80})},
        "dr-title": {"id": "dr-title", "generator": "studio title macro", "content_date": AS_OF,
                     "content_basis": "the seven printed day lines of the record", "licence": "CC0"},
        "g-day1": _graphic_item("g-day1", "2026-03-02T12:00:00+00:00"),
        "g-board": _graphic_item("g-board", "2026-03-04T10:00:00+00:00"),
        "g-lt": _graphic_item("g-lt", "2026-03-04T10:00:00+00:00", frames=120),
        "st-echo": {"id": "st-echo", "date": "1952-10-01", "licence": "public domain", "title": "Ward count, 1952"},
        "st-margin": {"id": "st-margin", "date": "2026-03-06", "licence": "public domain", "title": "Bridge"},
        "st-q": {"id": "st-q", "date": "2026-03-07", "licence": "public domain", "title": "Count, Strelsau"},
    }


def _shot(sid, kind, start, dur, **kw):
    return dict({"id": sid, "kind": kind, "start_s": float(start), "dur_s": float(dur), "transition_in": {"type": "cut"}}, **kw)


def play() -> dict:
    rec = record()
    from studio.news import lints as NL      # the expected lines come from the one formatter the lint uses
    title_lines = NL.expected_title_lines(rec)
    week_line = NL.expected_week_line(rec)
    board_rows = [{"rung": r["rung"], "outlet": r["outlet"], "headline": r["headline"],
                   "headline_sha256": r["headline_sha256"]} for r in rec["lead"]["board"]]
    return {
        "title": "Week 99", "slug": "week-99", "show": "omnibus", "issue": 99, "as_of": AS_OF,
        "runtime_target_s": 100, "settings": {"master_fps": 30},
        "news": {"week": "week.json", "rundown": "rundown.json", "echo_pick": "echo-pick.json"},
        "cast": {"speakers": [{"id": "sp-doe", "name": "Jane Doe", "role": "water minister"},
                              {"id": "sp-clerk", "name": "Ward clerk", "role": "clerk, 1952"}],
                 "voices": [{"id": "v-narrator", "engine": "kokoro", "voice": "af_aoede", "speed": 0.88,
                             "credit": "Narrated by a computer voice, Kokoro af_aoede", "dot_label": "synthesised voice"},
                            {"id": "v-reader", "engine": "kokoro", "voice": "am_michael", "speed": 0.86,
                             "credit": "Quotations read by a computer voice, Kokoro am_michael",
                             "dot_label": "computer voice"}]},
        "moments": [{"id": "M-quiet", "start_s": 61.0, "end_s": 70.0, "silence": "intended",
                     "reason": "The bed closes before the clerk's words: no music under a quotation."}],
        "parts": [
            {"id": "p-clock", "kind": "chapter", "segment": "clock", "title": "Clock",
             "shots": [_shot("G-CLOCK", "graphic", 0, 6, subtype="clock", asset="g-clock", mark="DRAWN", data_ref="as_of",
                             shows={"lines": ["MONDAY 21:00 UTC"]})]},
            {"id": "p-open", "kind": "chapter", "segment": "cold_open", "as_of": AS_OF,
             "shots": [_shot("S-OPEN", "archive_still", 6, 8, asset="st-open", mark="ARCHIVE", fill_ok=True,
                             camera=[{"t": 0, "x": 0.26, "y": 0.513, "z": 3.0}, {"t": 8, "x": 0.27, "y": 0.515, "z": 3.0}])],
             "lines": [{"id": "L-open", "kind": "narration", "start_s": 7.0, "dur_s": 4.0, "read_by": "v-narrator",
                        "text": "Saturday 7 March, Strelsau. The count went on past midnight."}]},
            {"id": "p-title", "kind": "chapter", "segment": "title", "as_of": AS_OF,
             "shots": [_shot("T-MACRO", "drawn", 14, 6, asset="dr-title", mark="DRAWN",
                             shows={"title_lines": title_lines, "week_line": week_line})]},
            {"id": "p-mon", "kind": "chapter", "segment": "week", "as_of": "2026-03-02T12:00:00+00:00",
             "shots": [_shot("G-DAY1", "graphic", 20, 10, subtype="day", asset="g-day1", mark="DRAWN",
                             data_ref="days[0]",
                             shows={"lines": ["MON 02 MAR 2026", "OUTLETS CARRYING THE DAY'S LEAD · 9 PLACED"],
                                    "figures": [{"value": BUCKETS[0], "field": "days[0].lead.buckets"},
                                                {"value": 9, "field": "sum of days[0].lead.buckets"},
                                                {"value": sum(map(sum, BUCKETS)), "field": "total of days[i].lead.buckets"}]})],
             "lines": [{"id": "L-mon", "kind": "narration", "start_s": 21.0, "dur_s": 4.0, "read_by": "v-narrator",
                        "text": "Monday 2 March. The council met on water rights."}]},
            {"id": "p-weight", "kind": "chapter", "segment": "weight", "as_of": AS_OF,
             "shots": [_shot("G-BOARD", "graphic", 30, 20, subtype="board", asset="g-board", mark="DRAWN",
                             data_ref="lead.board", shows={"rows": board_rows})],
             "text": [{"id": "G-LT", "kind": "graphic", "subtype": "lower_third", "asset": "g-lt",
                       "start_s": 40.0, "end_s": 44.0}],
             "lines": [{"id": "L-weight", "kind": "narration", "start_s": 31.0, "dur_s": 3.0, "read_by": "v-narrator",
                        "text": "Wednesday 4 March. Twenty outlets carried it."},
                       {"id": "R1", "kind": "testimony", "speaker": "sp-doe", "start_s": 40.0, "dur_s": 5.0,
                        "date": "2026-03-04", "read_by": "v-reader", "text": READER_1, "quote_sha256": h(READER_1)}]},
            {"id": "p-echo", "kind": "chapter", "segment": "echo", "as_of": "1952-11-05T12:00:00-05:00",
             "shots": [_shot("S-ECHO", "archive_still", 50, 20, asset="st-echo", mark="ARCHIVE")],
             "lines": [{"id": "L-echo", "kind": "narration", "start_s": 51.0, "dur_s": 4.0, "read_by": "v-narrator",
                        "text": "October 1952. The Democratic and Republican tickets went to the wards."},
                       {"id": "R2", "kind": "testimony", "speaker": "sp-clerk", "start_s": 62.0, "dur_s": 5.0,
                        "date": "1952-11-04", "read_by": "v-reader", "text": READER_2, "quote_sha256": h(READER_2)}],
             "cues": [{"id": "M1", "kind": "music", "source": "bed-1", "start_s": 51.0, "end_s": 60.5}]},
            {"id": "p-margins", "kind": "chapter", "segment": "margins", "as_of": AS_OF,
             "shots": [_shot("S-MARGIN", "archive_still", 70, 5, asset="st-margin", mark="ARCHIVE"),
                       _shot("C-COUNT", "card", 75, 3, mark="CARD", text=["4 outlets"],
                             figures=[{"value": 4, "field": "margins.stories[0].source_count"}])],
             "lines": [{"id": "L-margin", "kind": "narration", "start_s": 71.0, "dur_s": 3.0, "read_by": "v-narrator",
                        "text": "Friday 6 March. An inspection found cracks in a bridge."}]},
            {"id": "p-question", "kind": "chapter", "segment": "question", "as_of": AS_OF,
             "shots": [_shot("S-Q", "archive_still", 78, 11, asset="st-q", mark="RECONSTRUCTED", alterations=["text composited"]),
                       _shot("B1", "black", 89, 1, mark="CARD",
                             black_reason="The frame goes dark for one breath before the credits roll.")],
             "lines": [{"id": "L-q", "kind": "narration", "start_s": 80.0, "dur_s": 3.0, "read_by": "v-narrator",
                        "text": "What did the council vote decide?"}]},
            {"id": "p-credits", "kind": "credits", "segment": "credits", "title": "Credits",
             "shots": [_shot("S-CRED", "card", 90, 10, mark="CARD")]},
        ],
    }


def episode():
    return play(), assets(), {"record": record(), "rundown": rundown(), "echo": echo_pick()}


# --------------------------------------------------------------------------
# The fail fixtures: each a mutation of the pass fixture, and the rules it must fail
# --------------------------------------------------------------------------


def part(p, pid):
    return next(x for x in p["parts"] if x["id"] == pid)


def shot(p, sid):
    return next(s for x in p["parts"] for s in x.get("shots") or [] if s["id"] == sid)


def line(p, lid):
    return next(ln for x in p["parts"] for ln in x.get("lines") or [] if ln["id"] == lid)


def _set_text(lid, text):
    def f(p, a, i):
        line(p, lid)["text"] = text
    return f


def _add_narration(pid, lid, start, dur, text):
    def f(p, a, i):
        part(p, pid).setdefault("lines", []).append({"id": lid, "kind": "narration", "start_s": start, "dur_s": dur,
                                                     "read_by": "v-narrator", "text": text})
    return f


def _many(*fs):
    def f(p, a, i):
        for g in fs:
            g(p, a, i)
    return f


FAIL = {
    "show without an issue": (lambda p, a, i: p.pop("issue"), {"show-profile"}),
    "unknown segment": (lambda p, a, i: part(p, "p-margins").update(segment="margin"), {"part-segment"}),
    "part horizon not a date": (lambda p, a, i: part(p, "p-mon").update(as_of="Monday"), {"part-as-of-declared"}),
    "graphic subtype unknown": (lambda p, a, i: shot(p, "G-DAY1").update(subtype="days"), {"graphic-schema"}),
    "board graphic without data_ref": (lambda p, a, i: shot(p, "G-BOARD").pop("data_ref"),
                                       {"graphic-schema", "board-rule"}),
    "graphic with premultiplied alpha": (lambda p, a, i: a["g-day1"].update(alpha="premultiplied"), {"graphic-schema"}),
    "lower third graphic without alpha": (lambda p, a, i: a["g-lt"].pop("alpha"), {"graphic-schema"}),
    "text composited marked ARCHIVE": (lambda p, a, i: shot(p, "S-OPEN").update(alterations=["text composited"]),
                                       {"alteration-marked"}),
    "reader line without its hash": (lambda p, a, i: line(p, "R1").pop("quote_sha256"),
                                     {"reader-quote-sha", "quote-verbatim"}),
    "silence without a reason": (lambda p, a, i: p["moments"][0].update(reason="quiet"), {"silence-reason"}),
    "graphic drawn after its part's horizon": (
        lambda p, a, i: a["g-day1"].update(content_date="2026-03-03T09:00:00+00:00"), {"as-of"}),
    "a part's horizon after the episode's": (
        lambda p, a, i: part(p, "p-margins").update(as_of="2026-03-09T00:00:00+00:00"), {"as-of"}),
    "Monday's graphic reads Tuesday's print": (lambda p, a, i: shot(p, "G-DAY1").update(data_ref="days[1]"),
                                              {"as-of"}),
    "the Echo names a later year": (_set_text("L-echo", "October 1952. The armistice came in 1953."), {"as-of"}),
    "a reading dated after the Echo's horizon": (lambda p, a, i: line(p, "R2").update(date="1952-12-01"), {"as-of"}),
    "a heat verb": (_set_text("L-mon", "Monday 2 March. Residents slammed the council."), {"never-tell"}),
    "critics, controversial": (_set_text("L-margin", "Critics called the inspection controversial."), {"never-tell"}),
    "a method sentence": (_set_text("L-mon", "Monday 2 March. This programme weighs the council."), {"never-tell"}),
    "a moral": (_set_text("L-q", "The lesson is clear: what did the council vote decide?"), {"never-tell"}),
    "news hindsight": (_set_text("L-margin", "Friday 6 March. The cracks turned out to be old."),
                       {"hindsight-language"}),
    "narration paraphrases a board headline": (
        _set_text("L-weight", "Ruritania's water minister resigns after a contract dispute."), {"never-tell"}),
    "an outlet characterised": (_set_text("L-weight", "Wednesday 4 March. The liberal Strelsau Herald printed it."),
                                {"no-outlet-characterisation"}),
    "media characterised": (_set_text("L-margin", "Friday 6 March. State media ran the bridge story."),
                            {"no-outlet-characterisation"}),
    "a rung in words beside an outlet": (
        _set_text("L-weight", "Wednesday 4 March. On the left, The Daily Example printed it."),
        {"no-outlet-characterisation"}),
    "the Echo names this week's person": (_set_text("L-echo", "October 1952. Jane Doe was not yet born."), {"no-bridge"}),
    "the Echo names this week's place in a quote": (
        lambda p, a, i: (line(p, "R2").update(text=READER_2 + " Strelsau voted."),
                         line(p, "R2").update(quote_sha256=h(READER_2 + " Strelsau voted."))),
        {"no-bridge", "quote-verbatim"}),
    "a bridging phrase in the week": (_set_text("L-mon", "Monday 2 March. Just as before, the council met."),
                                      {"no-bridge"}),
    "board drops a titled rung": (lambda p, a, i: shot(p, "G-BOARD")["shows"]["rows"].pop(), {"board-rule"}),
    "board row not verbatim": (lambda p, a, i: shot(p, "G-BOARD")["shows"]["rows"][0].update(
        headline="Doe Quits Over Water Deal!"), {"board-rule", "quote-verbatim"}),
    "board row for an untitled rung": (lambda p, a, i: shot(p, "G-BOARD")["shows"]["rows"].append(
        {"rung": "right", "outlet": "Evening Courier", "headline": "", "headline_sha256": h("")}),
        {"board-rule"}),
    "board row from a context record": (lambda p, a, i: i["record"]["lead"]["board"][0].update(cluster_id="c-context"),
                                        {"board-rule"}),
    "board with two rows on one rung": (lambda p, a, i: shot(p, "G-BOARD")["shows"]["rows"][1].update(rung="left"),
                                        {"board-rule"}),
    "a figure that is not its field": (lambda p, a, i: shot(p, "G-DAY1")["shows"]["figures"][1].update(value=10),
                                       {"counts-match"}),
    "a figure whose field does not exist": (
        lambda p, a, i: shot(p, "G-DAY1")["shows"]["figures"][1].update(field="days[0].lead.placed"), {"counts-match"}),
    "a numeral on a card the record lacks": (lambda p, a, i: shot(p, "C-COUNT").update(text=["4321 outlets"]),
                                             {"counts-match"}),
    "a reader line not verbatim": (lambda p, a, i: line(p, "R1").update(text=READER_1.replace("signed", "made")),
                                   {"quote-verbatim"}),
    "a reader hash no extract records": (
        lambda p, a, i: (line(p, "R1").update(text="I resigned."), line(p, "R1").update(quote_sha256=h("I resigned."))),
        {"quote-verbatim"}),
    "a title line with the wrong count": (
        lambda p, a, i: shot(p, "T-MACRO")["shows"]["title_lines"].__setitem__(
            0, shot(p, "T-MACRO")["shows"]["title_lines"][0].replace("   12 SRC", "   13 SRC")),
        {"title-lines-verbatim"}),
    "a title line rewritten": (
        lambda p, a, i: shot(p, "T-MACRO")["shows"]["title_lines"].__setitem__(1, "TUE 03 MAR   14 SRC  FLOOD DEAL SIGNED"),
        {"title-lines-verbatim"}),
    "a week line from another edition": (lambda p, a, i: shot(p, "T-MACRO")["shows"].update(
        week_line="WEEK 98  CLOSED SUN 01 MAR 20:00 UTC"), {"title-lines-verbatim"}),
    "music under the week": (lambda p, a, i: part(p, "p-mon").setdefault("cues", []).append(
        {"id": "M2", "kind": "music", "source": "bed-2", "start_s": 22.0, "end_s": 28.0}), {"no-music-under-news"}),
    "music under the cold open": (lambda p, a, i: p.setdefault("music", []).append(
        {"id": "M3", "kind": "music", "source": "theme", "start_s": 0.0, "end_s": 9.0}), {"no-music-under-news"}),
    "music under a quotation": (lambda p, a, i: part(p, "p-echo")["cues"][0].update(end_s=64.0),
                                {"no-music-under-quote"}),
    "over the narration ceiling": (_many(
        _add_narration("p-weight", "L-w2", 45.5, 4.0, "The council sat."),
        _add_narration("p-weight", "L-w3", 34.5, 5.0, "The council sat again."),
        _add_narration("p-echo", "L-e2", 55.5, 6.0, "The wards opened at seven."),
        _add_narration("p-mon", "L-m2", 25.5, 4.0, "The council sat once more."),
        _add_narration("p-margins", "L-m3", 74.5, 3.0, "The bridge stayed open."),
        _add_narration("p-open", "L-o2", 11.5, 2.0, "The count went on."),
        _add_narration("p-title", "L-t2", 14.0, 5.5, "The week, by day."),
        _add_narration("p-question", "L-q0", 78.0, 1.5, "Sunday 8 March."),
        lambda p, a, i: line(p, "L-open").update(dur_s=4.0),
    ), {"narration-ceiling"}),
    "a reader voice without its dot label": (lambda p, a, i: p["cast"]["voices"][1].pop("dot_label"),
                                             {"voice-disclosed"}),
    "a narrator credit that hides the computer voice": (
        lambda p, a, i: p["cast"]["voices"][0].update(credit="Narrated by Aoede"), {"voice-disclosed"}),
    "the ending is not a question": (_set_text("L-q", "The council vote decided the contract."), {"ending-question"}),
    "too little silence after the question": (lambda p, a, i: line(p, "L-q").update(start_s=85.0),
                                              {"ending-question"}),
    "a black shot without a reason": (lambda p, a, i: shot(p, "B1").pop("black_reason"), {"black-share"}),
    "too much black": (lambda p, a, i: shot(p, "B1").update(dur_s=4.0), {"black-share"}),
    # -- review round 1 (PR #16) -------------------------------------------------------------------------------
    # 1: a part's horizon is clamped to the episode's; a whole day on the episode's own day is not an instant
    "a whole-day part horizon on the episode's day": (lambda p, a, i: part(p, "p-margins").update(as_of="2026-03-08"),
                                                       {"as-of"}),
    "an item after the episode's horizon under a whole-day part": (_many(
        lambda p, a, i: part(p, "p-margins").update(as_of="2026-03-08"),
        lambda p, a, i: a["st-margin"].update(date="2026-03-08T23:30:00+00:00")), {"as-of"}),
    # 2: a graphic over a picture is dated like a shot's
    "an overlay graphic drawn after its part's horizon": (
        lambda p, a, i: a["g-lt"].update(content_date="2027-01-01T00:00:00+00:00"), {"as-of"}),
    "an overlay graphic with no content_date": (lambda p, a, i: a["g-lt"].pop("content_date"), {"as-of"}),
    # 4: the graphics that draw figures declare them
    "a day graphic that declares nothing": (lambda p, a, i: shot(p, "G-DAY1").pop("shows"), {"graphic-schema"}),
    "a count overlay that declares no figures": (lambda p, a, i: part(p, "p-weight")["text"][0].update(
        subtype="count", data_ref="days[0]"), {"graphic-schema"}),
    "a board that declares no rows": (lambda p, a, i: shot(p, "G-BOARD").update(shows={}),
                                      {"graphic-schema", "board-rule"}),
    # 5: the title part carries the day lines and the week line
    "the title declares no title lines": (lambda p, a, i: shot(p, "T-MACRO").pop("shows"), {"title-lines-verbatim"}),
    "the title without its week line": (lambda p, a, i: shot(p, "T-MACRO")["shows"].pop("week_line"),
                                        {"title-lines-verbatim"}),
    # 6: the spine, and exemptions read from the checked order
    "the clock is not first": (lambda p, a, i: p["parts"].insert(1, p["parts"].pop(0)),
                               {"segment-spine", "part-as-of-declared"}),
    "a news part labelled the credits": (_many(
        lambda p, a, i: part(p, "p-margins").update(segment="credits"),
        _set_text("L-margin", "Friday 6 March. Residents slammed the bridge, as we now know, in 2031."),
        lambda p, a, i: a["st-margin"].update(date="2031-01-01"),
        lambda p, a, i: part(p, "p-margins").setdefault("cues", []).append(
            {"id": "M9", "kind": "music", "source": "bed-9", "start_s": 70.0, "end_s": 75.0})),
        {"segment-spine", "never-tell", "hindsight-language", "as-of", "no-music-under-news"}),
    "a news part labelled the clock": (_many(
        lambda p, a, i: part(p, "p-margins").update(segment="clock"),
        lambda p, a, i: a["st-margin"].update(date="2031-01-01"),
        lambda p, a, i: part(p, "p-margins").setdefault("cues", []).append(
            {"id": "M9", "kind": "music", "source": "bed-9", "start_s": 70.0, "end_s": 75.0})),
        {"segment-spine", "as-of", "no-music-under-news"}),
    "a news part labelled the question": (_many(
        lambda p, a, i: part(p, "p-mon").update(segment="question"),
        lambda p, a, i: part(p, "p-mon").setdefault("cues", []).append(
            {"id": "M9", "kind": "music", "source": "bed-9", "start_s": 21.0, "end_s": 29.0})),
        {"segment-spine", "no-music-under-news"}),
    "a news part of kind credits": (_many(
        lambda p, a, i: part(p, "p-mon").update(kind="credits"),
        _set_text("L-mon", "Monday 2 March. Residents slammed the council, as we now know.")),
        {"never-tell", "hindsight-language"}),
    "a news card that calls itself the credits": (
        lambda p, a, i: shot(p, "C-COUNT").update(card="credits", text=["Critics called the bridge controversial."]),
        {"never-tell"}),
    # 7: a reader line names its voice
    "a reader line with no read_by": (lambda p, a, i: line(p, "R1").pop("read_by"),
                                      {"reader-read-by", "voice-disclosed"}),
    # 8: black drawn as a card is black
    "a black card without a reason": (
        lambda p, a, i: (shot(p, "B1").update(kind="card", card="black"), shot(p, "B1").pop("black_reason")),
        {"black-share"}),
    "ten seconds of black card": (lambda p, a, i: shot(p, "B1").update(
        kind="card", card="black", dur_s=10.0, reason="The frame goes dark for the count to settle in."),
        {"black-share"}),
    "a blank statement card": (lambda p, a, i: shot(p, "C-COUNT").update(text=[]), {"black-share"}),
    # 10, 11: a date-time with no zone, and a record date that does not read
    "a naive date-time read as UTC": (_many(
        lambda p, a, i: part(p, "p-mon").update(as_of="2026-03-02T12:00:00+00:00"),
        lambda p, a, i: a["g-day1"].update(content_date="2026-03-02T11:30:00")), {"as-of"}),
    "a record date that does not read": (
        lambda p, a, i: i["record"]["days"][0].update(printed_at="2026-03-02T25:00:00Z"), {"as-of"}),
    "a record date under another key, after the horizon": (
        lambda p, a, i: (i["record"]["days"][0].pop("printed_at"),
                         i["record"]["days"][0].update(fetched_at="2026-03-09T00:00:00Z")), {"as-of"}),
    # non-blocking findings, made blocking
    "a numeral on a card no figure declares": (lambda p, a, i: shot(p, "C-COUNT").update(text=["7 outlets"]),
                                               {"counts-match"}),
    "a year as a count": (lambda p, a, i: shot(p, "C-COUNT").update(text=["2026 outlets"]), {"counts-match"}),
    "a count spelled out": (lambda p, a, i: shot(p, "C-COUNT").update(text=["seven thousand outlets"]),
                            {"counts-match"}),
    "a card figure that is not its field": (lambda p, a, i: shot(p, "C-COUNT")["figures"][0].update(value=5),
                                            {"counts-match"}),
    "a reader line with no date": (lambda p, a, i: line(p, "R2").pop("date"), {"as-of"}),
    "a reader line dated by its extract, after the horizon": (_many(
        lambda p, a, i: line(p, "R2").pop("date"),
        lambda p, a, i: i["echo"]["period_documents"][0].update(date="1953-01-01")), {"as-of"}),
    "a card reproduces a board headline without its hash": (
        lambda p, a, i: shot(p, "C-COUNT").update(text=["Doe Quits Over Water Deal, Admits Fraud"], figures=[]),
        {"quote-verbatim"}),
    "the Echo names this week's person in capitals": (_set_text("L-echo", "October 1952. JANE DOE was not yet born."),
                                                      {"no-bridge"}),
    "the Echo names a full name across a no-break space": (_many(
        lambda p, a, i: i["rundown"]["parts"][1]["no_bridge"].update(must_not_appear=["Ruritania", "Strelsau", "Jane Doe"]),
        _set_text("L-echo", "October 1952. Jane Doe was not yet born.")), {"no-bridge"}),
    "the Echo names a full name across a line break": (_many(
        lambda p, a, i: i["rundown"]["parts"][1]["no_bridge"].update(must_not_appear=["Ruritania", "Strelsau", "Jane Doe"]),
        lambda p, a, i: shot(p, "S-ECHO").update(text=["Jane\nDoe"])), {"no-bridge"}),
    "the Echo names a decomposed accent": (_many(
        lambda p, a, i: i["rundown"]["parts"][1]["no_bridge"]["must_not_appear"].append("Zoë"),
        _set_text("L-echo", "October 1952. Zoë voted.")), {"no-bridge"}),
    "the Echo names this week's demonym": (_set_text("L-echo", "October 1952. The Ruritanian wards opened."),
                                           {"no-bridge"}),
    "the Echo names a period spelling of this week's place": (_many(
        lambda p, a, i: i["rundown"]["parts"][1]["no_bridge"]["must_not_appear"].append("Kyiv"),
        _set_text("L-echo", "October 1952. Kiev's wards opened.")), {"no-bridge"}),
    "an empty no_bridge list": (
        lambda p, a, i: i["rundown"]["parts"][1]["no_bridge"].update(must_not_appear=[]), {"no-bridge"}),
    "an outlet characterised in lower case": (
        _set_text("L-weight", "Wednesday 4 March. the liberal strelsau herald printed it."),
        {"no-outlet-characterisation"}),
    "music under a news part with no shots of its own": (lambda p, a, i: (
        part(p, "p-mon").update(shots=[]), part(p, "p-mon").setdefault("cues", []).append(
            {"id": "M9", "kind": "music", "source": "bed-9", "start_s": 20.0, "end_s": 30.0})),
        {"no-music-under-news"}),
    "a record the title cannot read": (lambda p, a, i: i["record"]["days"][0].pop("date"), {"title-lines-verbatim"}),
    # -- review of PR #18 ------------------------------------------------------------------------------------------
    "a total that is not the record's": (lambda p, a, i: shot(p, "G-DAY1")["shows"]["figures"][2].update(value=1),
                                         {"counts-match"}),
    "a tour window outside the picture": (lambda p, a, i: shot(p, "S-OPEN")["camera"][0].update(x=0.05),
                                          {"tour-window-inside"}),
    "a tour resting on a no-tour band": (lambda p, a, i: shot(p, "S-OPEN")["camera"][1].update(y=0.2),
                                         {"tour-window-inside"}),
    "a claim headline in frame before the board": (
        lambda p, a, i: shot(p, "S-OPEN")["camera"][1].update(x=0.729, y=0.813), {"tour-no-claim-before-board"}),
    "a record the board cannot read": (lambda p, a, i: i["record"]["lead"]["board"].append("not a row"),
                                       {"board-rule"}),
    # -- S4: founder ruling A (2026-11-13) ---------------------------------------------------------------------------
    "a Margins picture published after its horizon": (
        lambda p, a, i: a["st-margin"].update(published_at="2026-03-09T08:00:00+00:00"), {"picture_published_by_edition"}),
}


def failing(name: str):
    """The pass fixture with one fail case applied: (play, assets, inputs, rules it must fail)."""
    p, a, i = episode()
    p, a, i = copy.deepcopy(p), copy.deepcopy(a), copy.deepcopy(i)
    fn, rules = FAIL[name]
    fn(p, a, i)
    return p, a, i, rules
