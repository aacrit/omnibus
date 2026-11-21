# Net-new in omnibus (show bible v2, ticket 1).
"""The v2 lint fixture: one small episode in show bible v2's rundown that passes every news lint, and the mutations
that each fail one (studio/news/schema.py's v2 spine, section o).

``episode()`` returns ``(play, assets, inputs)``: a screenplay (show omnibus, issue 99, 150 s, every v2 segment:
clock, tease, title, lead, three packages, the briefs, The Echo, the sign-off, the credits), its ledger items, and
the inputs its ``news`` names (a week record, a rundown in the omnibus.rundown/2 shape and an echo pick), built in
code so every sha256 is the real hash of its text. Nothing here is real news: the people and the places are
invented (Ruritania), so no lint can pass by accident on real data.

``FAIL`` maps a case name to (mutation, the rules it must fail). Each mutation changes the pass fixture in one
place; the test asserts those rules, and only those, fail. ``WARN`` does the same for the advisory rules.
"""

from __future__ import annotations

import copy
import hashlib


def h(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


ISSUE = 99
AS_OF = "2026-03-08T18:07:00Z"                       # the cutoff: the pinned archive commit's time
COMMIT = "0123456789abcdef0123456789abcdef01234567"
READER_1 = "The contract was signed without the council's vote."
READER_2 = "The ballots were counted by hand in every ward."
DESK_CREDIT = "Research desk: void news"


def record() -> dict:
    """The week record the counts and the dates are read from (the desk's facts, never shown as the desk's)."""
    return {"issue": ISSUE, "schema": 2, "week_start": "2026-03-02", "week_end": "2026-03-08", "as_of": AS_OF,
            "facts": {"wards": 12, "wards_date": "2026-03-07"}}


def rundown() -> dict:
    """An omnibus.rundown/2 (bible o), as small as the lints read: its readings' extracts are hashed here."""
    return {"schema": "omnibus.rundown/2",
            "edition": {"issue": ISSUE, "cutoff_utc": AS_OF, "archive_commit": COMMIT, "weekly_edition_seen": False},
            "stories": [
                {"slug": "THE COUNCIL VOTES ON WATER", "place": "STRELSAU", "cluster_ids": ["c-1"], "weight": 0.91,
                 "rank": 1, "slot": "lead", "shape": "full", "parties": ["the council", "the water ministry"],
                 "entities": [], "primary_sources": [], "footage_cleared_s": 40.0, "mechanisms": [], "coi": False},
                {"slug": "THE CONTRACT IS PUBLISHED", "place": "STRELSAU", "cluster_ids": ["c-2"], "weight": 0.72,
                 "rank": 2, "slot": "package_2", "shape": "document", "parties": ["the water ministry"],
                 "entities": [], "footage_cleared_s": 0.0, "mechanisms": [], "coi": False,
                 "primary_sources": [{"id": "doc-contract", "date": "2026-03-04", "quote_sha256": h(READER_1)}]},
                {"slug": "THE WARDS ARE COUNTED", "place": "STRELSAU", "cluster_ids": ["c-3"], "weight": 0.55,
                 "rank": 3, "slot": "package_3", "shape": "full", "parties": [], "entities": [],
                 "primary_sources": [], "footage_cleared_s": 30.0, "mechanisms": [], "coi": False},
                {"slug": "THE RAIL STRIKE ENDS", "place": "ZENDA", "cluster_ids": ["c-4"], "weight": 0.41,
                 "rank": 4, "slot": "package_4", "shape": "full", "parties": [], "entities": [],
                 "primary_sources": [], "footage_cleared_s": 30.0, "mechanisms": [], "coi": False},
                {"slug": "A BRIDGE IS INSPECTED", "place": "ZENDA", "cluster_ids": ["c-5"], "weight": 0.30,
                 "rank": 5, "slot": "brief_1", "shape": "brief", "parties": [], "entities": [],
                 "primary_sources": [], "footage_cleared_s": 10.0, "mechanisms": [], "coi": False}],
            "tease": ["THE COUNCIL VOTES ON WATER"],
            "echo": {"id": "ward-count-1952", "bank_commit": COMMIT, "picked_at": "2026-03-08T19:00:00Z",
                     "top3": [{"id": "ward-count-1952", "score": 0.8}], "reason": "a count by hand settles a vote",
                     "bed": "bed-1"},
            "briefs_order": ["A BRIDGE IS INSPECTED"]}


def echo_pick() -> dict:
    return {"issue": ISSUE, "period_documents": [{"id": "src-1952", "date": "1952-11-04", "quote_sha256": h(READER_2)}],
            "no_bridge": {"must_not_appear_in_echo_lines": ["Ruritania", "Strelsau", "Zenda", "Jane Doe", "Doe"]}}


def _graphic_item(gid: str, content_date: str, frames: int = 180, alpha: str | None = "straight") -> dict:
    it = {"id": gid, "file": f"{gid}.mov", "kind": "graphic", "fps": "30", "frames": frames,
          "generator": "studio/graphics (E6)", "content_date": content_date,
          "content_basis": "drawn from the screenplay's own words and the record fields its data_ref names",
          "licence": "CC0"}
    if alpha:
        it["alpha"] = alpha
    return it


def _clip(aid: str, date: str, title: str) -> dict:
    return {"id": aid, "kind": "footage", "date": date, "published_at": f"{date}T20:00:00Z", "licence": "public domain",
            "title": title}


def assets() -> dict:
    return {
        "g-clock": _graphic_item("g-clock", AS_OF),
        "g-strip-tease": _graphic_item("g-strip-tease", "2026-03-05", frames=240),
        "g-strip-brief": _graphic_item("g-strip-brief", "2026-03-06", frames=240),
        "g-super": _graphic_item("g-super", "2026-03-05", frames=120),
        "g-page": _graphic_item("g-page", "2026-03-04", alpha=None),
        "g-locator": _graphic_item("g-locator", AS_OF, alpha=None),
        "g-bump-briefs": _graphic_item("g-bump-briefs", AS_OF, frames=54, alpha=None),
        "g-bump-echo": _graphic_item("g-bump-echo", "1952-01-01", frames=54, alpha=None),
        "g-credits": _graphic_item("g-credits", AS_OF, frames=600, alpha=None),
        "dr-title": {"id": "dr-title", "generator": "studio title macro", "content_date": AS_OF,
                     "content_basis": "the rundown's slugs in rank order", "licence": "CC0"},
        "v-council": _clip("v-council", "2026-03-05", "Council chamber, Strelsau"),
        "v-doe": _clip("v-doe", "2026-03-05", "Jane Doe's remarks, Strelsau"),
        "v-wards": _clip("v-wards", "2026-03-07", "Ward count, Strelsau"),
        "v-rail": _clip("v-rail", "2026-03-06", "Zenda station"),
        "st-bridge": {"id": "st-bridge", "date": "2026-03-06", "licence": "public domain", "title": "Bridge, Zenda"},
        "st-echo": {"id": "st-echo", "date": "1952-10-01", "licence": "public domain", "title": "Ward count, 1952"},
    }


def _shot(sid, kind, start, dur, **kw):
    return dict({"id": sid, "kind": kind, "start_s": float(start), "dur_s": float(dur), "transition_in": {"type": "cut"}}, **kw)


def _vo(lid, start, dur, text):
    return {"id": lid, "kind": "vo", "start_s": float(start), "dur_s": float(dur), "read_by": "v-narrator", "text": text}


NAT = {"role": "nat", "translation": "none"}


def play() -> dict:
    return {
        "title": "Issue 99", "slug": "issue-99", "show": "omnibus", "issue": ISSUE, "as_of": AS_OF,
        "runtime_target_s": 150, "settings": {"master_fps": 30},
        "news": {"week": "week.json", "rundown": "rundown.json", "echo_pick": "echo-pick.json",
                 "edition": {"issue": ISSUE, "cutoff_utc": AS_OF, "archive_commit": COMMIT},
                 "clusters": [{"id": "c-1", "rank": 1, "weight": 0.91, "slot": "lead"},
                              {"id": "c-2", "rank": 2, "weight": 0.72, "slot": "package_2"},
                              {"id": "c-3", "rank": 3, "weight": 0.55, "slot": "package_3"},
                              {"id": "c-4", "rank": 4, "weight": 0.41, "slot": "package_4"},
                              {"id": "c-5", "rank": 5, "weight": 0.30, "slot": "brief_1"}],
                 "desk_credit": DESK_CREDIT, "coi": False},
        "cast": {"speakers": [{"id": "sp-doe", "name": "Jane Doe", "role": "water minister"},
                              {"id": "sp-clerk", "name": "Ward clerk", "role": "clerk, 1952"}],
                 "voices": [{"id": "v-narrator", "engine": "kokoro", "voice": "af_aoede", "speed": 0.88,
                             "credit": "Narrated by a synthesised voice, Kokoro af_aoede", "dot_label": "synthesised voice"},
                            {"id": "v-reader", "engine": "kokoro", "voice": "am_michael", "speed": 0.86,
                             "credit": "Documents read by a computer voice, Kokoro am_michael",
                             "dot_label": "computer voice"}]},
        "moments": [{"id": "M-quiet", "start_s": 128.0, "end_s": 134.0, "silence": "intended",
                     "reason": "The bed closes before the clerk's words: no music under a quotation."}],
        "parts": [
            {"id": "p-clock", "kind": "chapter", "segment": "clock",
             "shots": [_shot("G-CLOCK", "graphic", 0, 6, subtype="clock", asset="g-clock", mark="DRAWN", data_ref="as_of",
                             shows={"lines": ["MONDAY 21:00 UTC"]})]},
            {"id": "p-tease", "kind": "chapter", "segment": "tease",
             "shots": [_shot("S-TEASE", "archive_video", 6, 8, asset="v-council", mark="ARCHIVE", sound=dict(NAT))],
             "text": [{"id": "T-STRIP", "kind": "graphic", "subtype": "brief_strip", "asset": "g-strip-tease",
                       "start_s": 6.0, "end_s": 14.0, "shows": {"lines": ["STRELSAU · THU 5 MAR"]}}],
             "lines": [_vo("L-tease", 8.5, 4.0, "In Strelsau, the council voted on water rights.")]},
            {"id": "p-title", "kind": "chapter", "segment": "title",
             "shots": [_shot("T-MACRO", "drawn", 14, 14, asset="dr-title", mark="DRAWN"),
                       _shot("T-LOCKUP", "card", 28, 4, mark="CARD", card="lockup", text=[])],
             "lines": [{"id": "L-signon", "kind": "signon", "start_s": 28.5, "dur_s": 3.0, "read_by": "v-narrator",
                        "text": "This is void omnibus. The week of the second of March, on the record."}]},
            {"id": "p-lead", "kind": "chapter", "segment": "lead", "shape": "full",
             "shots": [_shot("S-LEAD-1", "archive_video", 32, 10, asset="v-council", mark="ARCHIVE", sound=dict(NAT)),
                       _shot("S-LEAD-2", "archive_video", 42, 12, asset="v-doe", mark="ARCHIVE",
                             sound={"role": "sot", "lang": "en", "translation": "none", "transcript_ref": "tr-doe"})],
             "text": [{"id": "G-SUPER", "kind": "graphic", "subtype": "sot_super", "asset": "g-super",
                       "start_s": 42.0, "end_s": 46.0,
                       "shows": {"lines": ["JANE DOE", "WATER MINISTER", "RELEASED BY THE WATER MINISTRY"]}}],
             "lines": [_vo("L-lead", 33.0, 6.0, "On Thursday, in Strelsau, the council voted on water rights."),
                       {"id": "L-SOT", "kind": "sot", "speaker": "sp-doe", "shot_ref": "S-LEAD-2", "start_s": 42.5,
                        "dur_s": 10.0, "in_s": 12.0, "out_s": 22.0, "transcript_ref": "tr-doe",
                        "text": "The contract will be published in full."}]},
            {"id": "p-pkg-2", "kind": "chapter", "segment": "package", "shape": "document",
             "shots": [_shot("G-PAGE", "graphic", 54, 10, subtype="page", asset="g-page", mark="DRAWN"),
                       _shot("C-QUOTE", "card", 64, 6, mark="CARD", card="quote", quote=True,
                             source_date="2026-03-04", text=[READER_1, "The contract, 4 March"])],
             "lines": [_vo("L-p2", 54.5, 3.0, "On Wednesday, the ministry published the contract."),
                       {"id": "R1", "kind": "read", "start_s": 58.0, "dur_s": 4.0, "date": "2026-03-04",
                        "read_by": "v-reader", "text": READER_1, "quote_sha256": h(READER_1)}]},
            {"id": "p-pkg-3", "kind": "chapter", "segment": "package",
             "shots": [_shot("S-WARDS", "archive_video", 70, 8, asset="v-wards", mark="ARCHIVE", sound=dict(NAT)),
                       _shot("C-COUNT", "card", 78, 4, mark="CARD", card="count", text=["12 wards"],
                             figures=[{"value": 12, "field": "facts.wards"}])],
             "lines": [_vo("L-p3", 71.0, 4.0, "On Saturday, the wards were counted by hand.")]},
            {"id": "p-pkg-4", "kind": "chapter", "segment": "package",
             "shots": [_shot("S-RAIL", "archive_video", 82, 8, asset="v-rail", mark="ARCHIVE",
                             sound={"role": "muted", "translation": "none",
                                    "mute_reason": "The source carries a music bed under its own sound."}),
                       _shot("G-LOC", "graphic", 90, 5, subtype="locator", asset="g-locator", mark="DRAWN",
                             shows={"lines": ["ZENDA"]})],
             "lines": [_vo("L-p4", 83.0, 4.0, "On Friday, in Zenda, the rail strike ended.")]},
            {"id": "p-briefs", "kind": "chapter", "segment": "briefs",
             "shots": [_shot("G-BUMP-1", "graphic", 95, 2, subtype="bumper", asset="g-bump-briefs", mark="DRAWN",
                             shows={"lines": ["AROUND THE WORLD"]}),
                       _shot("S-BRIDGE", "archive_still", 97, 10, asset="st-bridge", mark="RECONSTRUCTED",
                             alterations=["text composited"])],
             "text": [{"id": "T-STRIP-2", "kind": "graphic", "subtype": "brief_strip", "asset": "g-strip-brief",
                       "start_s": 97.0, "end_s": 107.0, "shows": {"lines": ["ZENDA · FRI 6 MAR"]}}],
             "lines": [_vo("L-br1", 97.5, 4.0, "In Zenda, an inspection found cracks in a bridge.")]},
            {"id": "p-echo", "kind": "chapter", "segment": "echo", "as_of": "1952-11-05T12:00:00-05:00",
             "shots": [_shot("G-BUMP-2", "graphic", 107, 2, subtype="bumper", asset="g-bump-echo", mark="DRAWN",
                             shows={"lines": ["THE ECHO"]}),
                       _shot("S-ECHO", "archive_still", 109, 31, asset="st-echo", mark="ARCHIVE")],
             "lines": [_vo("L-echo", 110.0, 4.0, "October 1952. The Democratic and Republican tickets went to the wards."),
                       {"id": "R2", "kind": "read", "speaker": "sp-clerk", "start_s": 129.0, "dur_s": 4.0,
                        "date": "1952-11-04", "read_by": "v-reader", "text": READER_2, "quote_sha256": h(READER_2)}],
             "cues": [{"id": "M1", "kind": "music", "source": "bed-1", "start_s": 110.0, "end_s": 127.5}]},
            {"id": "p-signoff", "kind": "chapter", "segment": "signoff",
             "shots": [_shot("S-IDENT", "card", 140, 8, mark="CARD", card="lockup", text=[])],
             "lines": [{"id": "L-signoff", "kind": "signoff", "start_s": 140.5, "dur_s": 6.0, "read_by": "v-narrator",
                        "text": "That was the week of the second to the eighth of March. For the record, every source "
                                "is at omnibus dot voidvision dot org."}]},
            {"id": "p-credits", "kind": "credits", "segment": "credits",
             "shots": [_shot("G-CREDITS", "graphic", 148, 20, subtype="credits", asset="g-credits", mark="DRAWN")]},
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


def text(p, tid):
    return next(t for x in p["parts"] for t in x.get("text") or [] if t["id"] == tid)


def line(p, lid):
    return next(ln for x in p["parts"] for ln in x.get("lines") or [] if ln["id"] == lid)


def _many(*fs):
    def f(p, a, i):
        for g in fs:
            g(p, a, i)
    return f


def _pop_part(pid):
    def f(p, a, i):
        p["parts"] = [x for x in p["parts"] if x["id"] != pid]
    return f


def _sound(sid, **kw):
    def f(p, a, i):
        shot(p, sid)["sound"].update(kw)
    return f


def _no_key(get, key):
    def f(p, a, i):
        get(p).pop(key)
    return f


FAIL = {
    # -- the spine (bible o: SEGMENTS) -------------------------------------------------------------------------------
    "a v1 segment in a v2 screenplay": (lambda p, a, i: part(p, "p-pkg-3").update(segment="margins"),
                                        {"part-segment"}),
    "the cold open is gone": (lambda p, a, i: part(p, "p-tease").update(segment="cold_open"),
                              {"part-segment", "segment-spine", "graphic-schema"}),   # its brief strip is then untrusted
    "no tease": (_pop_part("p-tease"), {"segment-spine"}),
    "no sign-off": (_pop_part("p-signoff"), {"segment-spine"}),
    "two leads": (lambda p, a, i: part(p, "p-pkg-3").update(segment="lead"), {"segment-spine"}),
    "a second lead is linted as an untrusted part": (lambda p, a, i: part(p, "p-pkg-2").update(segment="lead"),
                                                     {"segment-spine", "part-shape", "card-kind"}),
    "the briefs before the packages": (
        lambda p, a, i: p["parts"].insert(4, p["parts"].pop(next(k for k, x in enumerate(p["parts"]) if x["id"] == "p-briefs"))),
        {"segment-spine", "graphic-schema"}),
    "the Echo without its own horizon": (lambda p, a, i: part(p, "p-echo").pop("as_of"), {"part-as-of-declared"}),
    "a news part's horizon that does not read": (lambda p, a, i: part(p, "p-pkg-3").update(as_of="Saturday"),
                                                 {"part-as-of-declared"}),
    "a shape on the briefs": (lambda p, a, i: part(p, "p-briefs").update(shape="document"), {"part-shape"}),
    "a shape that is not one": (lambda p, a, i: part(p, "p-pkg-3").update(shape="feature"), {"part-shape"}),
    # -- episode fields ---------------------------------------------------------------------------------------------
    "no edition": (lambda p, a, i: p["news"].pop("edition"), {"news-fields"}),
    "as_of is not the cutoff": (lambda p, a, i: p["news"]["edition"].update(cutoff_utc="2026-03-08T20:00:00Z"),
                                {"news-fields"}),
    "a cutoff with an offset, not UTC": (lambda p, a, i: p["news"]["edition"].update(cutoff_utc="2026-03-08T18:07:00+00:00"),
                                         {"news-fields"}),
    "a short archive commit": (lambda p, a, i: p["news"]["edition"].update(archive_commit="0123456"), {"news-fields"}),
    "the edition names another issue": (lambda p, a, i: p["news"]["edition"].update(issue=98), {"news-fields"}),
    "no clusters": (lambda p, a, i: p["news"].update(clusters=[]), {"news-fields"}),
    "a cluster twice": (lambda p, a, i: p["news"]["clusters"].append(dict(p["news"]["clusters"][0])), {"news-fields"}),
    "a cluster slot that is not one": (lambda p, a, i: p["news"]["clusters"][0].update(slot="the weight"),
                                       {"news-fields"}),
    "a cluster rank of zero": (lambda p, a, i: p["news"]["clusters"][0].update(rank=0), {"news-fields"}),
    "a cluster weight in words": (lambda p, a, i: p["news"]["clusters"][0].update(weight="high"), {"news-fields"}),
    "the desk credited in other words": (lambda p, a, i: p["news"].update(desk_credit="Ranked by void news"),
                                         {"news-fields"}),
    "coi unstated": (lambda p, a, i: p["news"].pop("coi"), {"news-fields"}),
    # -- lines (vo, sot, read, signon, signoff) -------------------------------------------------------------------------
    "a v1 narration line": (lambda p, a, i: line(p, "L-p3").update(kind="narration"), {"line-schema"}),
    "a line with no text": (lambda p, a, i: line(p, "L-p3").update(text=" "), {"line-schema"}),
    "a sign-on outside the title": (lambda p, a, i: line(p, "L-p3").update(kind="signon"), {"line-schema"}),
    "a sign-off line in the Echo": (lambda p, a, i: line(p, "L-echo").update(kind="signoff"), {"line-schema"}),
    "the sign-off spoken as vo": (lambda p, a, i: line(p, "L-signoff").update(kind="vo"), {"line-schema"}),
    "a second line in the sign-off": (lambda p, a, i: part(p, "p-signoff")["lines"].append(
        {"id": "L-so2", "kind": "vo", "start_s": 146.6, "dur_s": 1.0, "read_by": "v-narrator", "text": "Good night."}),
        {"line-schema"}),
    "an sot line with no speaker": (_no_key(lambda p: line(p, "L-SOT"), "speaker"), {"line-schema"}),
    "an sot line read by the reader": (lambda p, a, i: line(p, "L-SOT").update(read_by="v-reader"), {"line-schema"}),
    "an sot line on a nat clip": (lambda p, a, i: line(p, "L-SOT").update(shot_ref="S-LEAD-1"), {"line-schema"}),
    "an sot line on another part's shot": (lambda p, a, i: line(p, "L-SOT").update(shot_ref="S-WARDS"), {"line-schema"}),
    "an sot line with no transcript": (_many(_no_key(lambda p: line(p, "L-SOT"), "transcript_ref"),
                                             _no_key(lambda p: shot(p, "S-LEAD-2")["sound"], "transcript_ref")),
                                       {"line-schema"}),
    "an sot bite out before in": (lambda p, a, i: line(p, "L-SOT").update(out_s=10.0), {"line-schema"}),
    "a read line without its hash": (_no_key(lambda p: line(p, "R1"), "quote_sha256"),
                                     {"reader-quote-sha", "quote-verbatim"}),
    "a read line without its voice": (_no_key(lambda p: line(p, "R1"), "read_by"),
                                      {"reader-read-by", "voice-disclosed"}),
    "a read line not verbatim": (lambda p, a, i: line(p, "R1").update(text=READER_1.replace("signed", "made")),
                                 {"quote-verbatim"}),
    # -- sound.role (bible j) ---------------------------------------------------------------------------------------------
    "a clip with no sound": (_no_key(lambda p: shot(p, "S-WARDS"), "sound"), {"sound-role"}),
    "a sound role that is not one": (_sound("S-WARDS", role="clips"), {"sound-role"}),
    "no translation stated": (_no_key(lambda p: shot(p, "S-WARDS")["sound"], "translation"), {"sound-role"}),
    "muted without a reason": (_sound("S-RAIL", mute_reason="music"), {"sound-role"}),
    "muted but played in the engine": (_sound("S-RAIL", mode="own"), {"sound-role"}),
    "nat played muted in the engine": (_sound("S-WARDS", mode="mute"), {"sound-role"}),
    "nat on a clip the ledger airs muted": (
        lambda p, a, i: a["v-wards"].update(audio={"mode": "muted", "reason": "an agency voice over the picture"}),
        {"sound-role"}),
    "an sot bite with no language": (_no_key(lambda p: shot(p, "S-LEAD-2")["sound"], "lang"), {"sound-role"}),
    "an English bite translated": (_sound("S-LEAD-2", translation="ours"), {"sound-role"}),
    "a foreign bite untranslated": (_sound("S-LEAD-2", lang="ru"), {"sound-role"}),
    "a transcript on a nat clip": (_sound("S-WARDS", transcript_ref="tr-wards"), {"sound-role"}),
    # -- card.kind (bible i) ----------------------------------------------------------------------------------------------
    "a headline card": (lambda p, a, i: shot(p, "C-COUNT").update(card="headline"), {"card-kind"}),
    "a statement card": (lambda p, a, i: shot(p, "C-COUNT").update(card="statement"), {"card-kind"}),
    "a count card that declares nothing": (lambda p, a, i: shot(p, "C-COUNT").update(figures=[], text=["wards"]),
                                           {"card-kind"}),
    "a quote card not drawn as a quote": (lambda p, a, i: shot(p, "C-QUOTE").pop("quote"), {"card-kind"}),
    "a quote card in a full package": (lambda p, a, i: part(p, "p-pkg-2").update(shape="full"), {"card-kind"}),
    "a blank count card": (lambda p, a, i: shot(p, "C-COUNT").update(text=[" "]), {"card-kind"}),   # black-share misses it
    "a quote card with no words": (lambda p, a, i: shot(p, "C-QUOTE").update(text=[]), {"card-kind"}),
    "the ident card in a package": (lambda p, a, i: shot(p, "C-COUNT").update(card="lockup", figures=[], text=[]),
                                    {"card-kind"}),
    # -- graphic.subtype (bible i) ----------------------------------------------------------------------------------------
    "a killed subtype: the board": (lambda p, a, i: shot(p, "G-LOC").update(subtype="board"), {"graphic-schema"}),
    "a killed subtype: the day bars": (lambda p, a, i: shot(p, "G-LOC").update(subtype="day"), {"graphic-schema"}),
    "a killed subtype: the test card": (lambda p, a, i: shot(p, "G-BUMP-1").update(subtype="testcard"),
                                        {"graphic-schema"}),
    "the v1 map, not the locator": (lambda p, a, i: shot(p, "G-LOC").update(subtype="map"), {"graphic-schema"}),
    "a bumper in a package": (lambda p, a, i: shot(p, "G-LOC").update(subtype="bumper", shows={"lines": ["THE ECHO"]}),
                              {"graphic-schema"}),
    "a bumper with another segment's word": (lambda p, a, i: shot(p, "G-BUMP-1").update(shows={"lines": ["THE ECHO"]}),
                                             {"graphic-schema"}),
    "a bumper after the brief it heads": (lambda p, a, i: part(p, "p-briefs")["shots"].reverse(), {"graphic-schema"}),
    "an SOT super with one line": (lambda p, a, i: text(p, "G-SUPER")["shows"].update(lines=["JANE DOE"]),
                                   {"graphic-schema"}),
    "an SOT super's third line not a label": (
        lambda p, a, i: text(p, "G-SUPER")["shows"]["lines"].__setitem__(2, "RESIGNED IN DISGRACE"), {"graphic-schema"}),
    "an SOT super full frame": (lambda p, a, i: shot(p, "G-LOC").update(subtype="sot_super"), {"graphic-schema"}),
    "a brief strip in a package": (lambda p, a, i: part(p, "p-pkg-3").setdefault("text", []).append(
        {"id": "T-STRIP-3", "kind": "graphic", "subtype": "brief_strip", "asset": "g-strip-brief", "start_s": 70.0,
         "end_s": 76.0, "shows": {"lines": ["STRELSAU · SAT 7 MAR"]}}), {"graphic-schema"}),
    "a brief strip of two lines": (lambda p, a, i: text(p, "T-STRIP")["shows"].update(lines=["STRELSAU", "THU 5 MAR"]),
                                   {"graphic-schema"}),
    "headlines on a graphic": (lambda p, a, i: shot(p, "G-LOC").update(shows={"headlines": []}), {"graphic-schema"}),
    "a count overlay with no figures": (lambda p, a, i: text(p, "G-SUPER").update(subtype="count", data_ref="facts"),
                                        {"graphic-schema"}),
    "text composited marked ARCHIVE": (lambda p, a, i: shot(p, "S-BRIDGE").update(mark="ARCHIVE"),
                                       {"alteration-marked"}),
    # -- the die list stays dead; fair use is refused ----------------------------------------------------------------------
    "a fair-use clip in the lead": (lambda p, a, i: a["v-council"].update(licence="fair-use-excerpt"),
                                    {"fair-use-refused"}),
    "a clip whose basis is fair use": (
        lambda p, a, i: a["v-rail"].update(basis="fair use (17 U.S.C. 107): a short excerpt"), {"fair-use-refused"}),
    # -- the keep lints, on v2 lines --------------------------------------------------------------------------------------
    "a heat verb in a vo line": (lambda p, a, i: line(p, "L-p3").update(text="On Saturday, residents slammed the count."),
                                 {"never-tell"}),
    "hindsight in a vo line": (lambda p, a, i: line(p, "L-p4").update(text="On Friday, the strike turned out to end."),
                               {"hindsight-language"}),
    "the Echo names this week's person": (lambda p, a, i: line(p, "L-echo").update(text="October 1952. Jane Doe voted."),
                                          {"no-bridge"}),
    "music under the lead": (lambda p, a, i: part(p, "p-lead").setdefault("cues", []).append(
        {"id": "M2", "kind": "music", "source": "bed-2", "start_s": 33.0, "end_s": 40.0}), {"no-music-under-news"}),
    "music under the briefs": (lambda p, a, i: part(p, "p-briefs").setdefault("cues", []).append(
        {"id": "M3", "kind": "music", "source": "bed-2", "start_s": 98.0, "end_s": 104.0}), {"no-music-under-news"}),
    "music under a read line": (lambda p, a, i: part(p, "p-echo")["cues"][0].update(end_s=131.0),
                                {"no-music-under-quote"}),
    "a count card the record lacks": (lambda p, a, i: shot(p, "C-COUNT").update(text=["13 wards"]), {"counts-match"}),
    "a narrator credit that hides the voice": (lambda p, a, i: p["cast"]["voices"][0].update(credit="Narrated by Aoede"),
                                               {"voice-disclosed"}),
    "a clip after the cutoff": (lambda p, a, i: a["v-rail"].update(date="2026-03-09"), {"as-of"}),
    "a sign-off line naming a later year": (lambda p, a, i: line(p, "L-signoff").update(
        text="That was the week of 2031. For the record, every source is at omnibus dot voidvision dot org."), {"as-of"}),
}

WARN = {
    "two packages": (_pop_part("p-pkg-4"), {"package-count"}),
    "five packages": (lambda p, a, i: [p["parts"].insert(7, dict(copy.deepcopy(part(p, "p-pkg-4")), id=f"p-pkg-{k}"))
                                       for k in (5, 6)], {"package-count"}),
}


def failing(name: str, table=None):
    """The pass fixture with one case applied: (play, assets, inputs, rules it must fail)."""
    p, a, i = episode()
    p, a, i = copy.deepcopy(p), copy.deepcopy(a), copy.deepcopy(i)
    fn, rules = (table or FAIL)[name]
    fn(p, a, i)
    return p, a, i, rules
