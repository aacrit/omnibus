# Net-new in omnibus (E9i).
"""The engine reads omnibus's own ledgers: the licence map, E6's graphics ledger, the vision and voicing manifests, a
muted clip and the credit disclosures. Pure, except one tmp film folder for load_ledgers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from studio.engine import narrator as NR
from studio.engine import render as R
from studio.news import graphics_ledger as GL
from studio.news import profile as SHOW
from studio.news import vision_manifest as NVM
from studio.news import voicing_manifest as NVO

NEWS = {"show": "omnibus", "issue": 33}
NEWS_SA = dict(NEWS, share_alike={"decision": "docs/DECISIONS.md 2026-11-11: G1 greenlight approved"})
SHA = "a" * 64
SHA2 = "b" * 64

# --------------------------------------------------------------------------- licence map


@pytest.mark.parametrize("lic", ["pd-us-federal", "pd-age", "pd-dedication", "cc0-1.0", "own-property",
                                 "eu-reuse-credit", "cc-by-2.0", "cc-by-4.0"])
def test_each_allowed_id_reads_as_allowed_on_omnibus(lic):
    assert SHOW.licence_reading(NEWS, lic)["as"] == "allowed"
    assert R.licence_allowed(lic, NEWS) == (True, False)


@pytest.mark.parametrize("lic", ["cc-by-sa-2.0", "cc-by-sa-4.0"])
def test_share_alike_needs_the_declaration(lic):
    assert SHOW.licence_reading(NEWS, lic)["as"] == "share_alike"
    assert R.licence_allowed(lic, NEWS) == (False, True)
    assert R.licence_allowed(lic, NEWS_SA) == (True, True)


def test_every_rights_allowlist_id_is_mapped():
    src = (Path(__file__).resolve().parents[2] / "scripts" / "lib" / "rights" / "licences.mjs").read_text(encoding="utf-8")
    for fixed in ("cc0-1.0", "eu-reuse-credit", "pd-us-federal", "pd-age", "pd-dedication", "own-property"):
        assert fixed in src and fixed in SHOW.LICENCES
    assert '["1.0", "2.0", "2.1", "2.5", "3.0", "4.0"]' in src
    assert all(f"cc-by-{v}" in SHOW.LICENCES and f"cc-by-sa-{v}" in SHOW.LICENCES for v in SHOW.CC_VERSIONS)


@pytest.mark.parametrize("lic,before", [("pd-us-federal", (False, False)), ("own-property", (False, False)),
                                         ("eu-reuse-credit", (False, False)), ("cc-by-sa-4.0", (False, True))])
def test_document_reads_licences_as_before(lic, before):
    assert SHOW.licence_reading({}, lic) is None
    assert R.licence_allowed(lic, {}) == before


def test_document_house_words_unchanged():
    assert R.licence_allowed("Public domain", {}) == (True, False)
    assert R.licence_allowed("CC BY-SA 4.0", {}) == (False, True)
    assert R.licence_allowed("CC BY 4.0", NEWS) == (True, False)       # an unmapped engine word: the house rule
    assert R.licence_allowed("cc-by-nc-4.0", NEWS) == (False, False)  # never mapped, never allowed

# --------------------------------------------------------------------------- E6's graphics ledger


RUNDOWN = {"as_of": "2026-11-08T22:16:50+00:00", "parts": [
    {"id": "title", "as_of": "2026-11-08T22:16:50+00:00"},
    {"id": "the-week", "as_of": "per beat (days[i].printed_at)", "beats": [
        {"id": "week-day-1", "as_of": "2026-11-02T00:59:28+00:00"}, {"id": "week-day-7", "as_of": "2026-11-08T11:51:04+00:00"}]},
    {"id": "the-weight", "as_of": "2026-11-08T22:16:50+00:00", "beats": [{"id": "weight-board"}]},
    {"id": "the-echo", "as_of": "1952-11-05T12:00:00-05:00", "beats": [{"id": "echo-x2", "date": "1951-01-30"}]},
    {"id": "credits", "as_of": "2026-11-08T22:16:50+00:00"}]}
RECORD = {"as_of": "2026-11-08T22:16:50+00:00", "days": [{"printed_at": "2026-11-02T00:59:28+00:00"}]}
INPUTS = {"rundown": RUNDOWN, "record": RECORD, "echo": {}}


def row(**kw):
    r = {"id": "g", "subtype": "testcard", "data_ref": "rundown:week testcard; week:bars",
         "source_template_sha256": SHA, "output_path": "D:\\omnibus-media\\33\\graphics\\g.mov",
         "output_sha256": SHA2, "frames": 54, "class": "DRAWN"}
    r.update(kw)
    return r


@pytest.mark.parametrize("ref,date", [
    ("rundown:week testcard; week:bars", "2026-11-08T11:51:04+00:00"),       # a part dated per beat: its latest beat
    ("rundown:echo testcard; week:bars", "1952-11-05T12:00:00-05:00"),       # the rundown entry wins over week:
    ("rundown:the-echo.beats[echo-x2]; echo-pick", "1951-01-30"),            # a beat's own date
    ("rundown:the-weight.beats[weight-board]; week:lead.board", "2026-11-08T22:16:50+00:00"),   # undated beat: part
    ("rundown:title.title_lines, strike", "2026-11-08T22:16:50+00:00"),
    ("rights-ledger:items[].credit; rundown:voices, credits.disclosures", "2026-11-08T22:16:50+00:00"),
    ("week:days[0].lead.buckets", "2026-11-02T00:59:28+00:00"),
    ("week:lead.claim", "2026-11-08T22:16:50+00:00"),
    ("release", "2026-11-08T22:16:50+00:00"),
])
def test_content_date_rules(ref, date):
    d, basis = GL.content_date(ref, INPUTS)
    assert d == date and ref in basis


@pytest.mark.parametrize("ref", ["echo-pick:counts_on_screen", "week:days[9].lead", "rundown:no-such-part.x", ""])
def test_content_date_is_never_guessed(ref):
    assert GL.content_date(ref, INPUTS) == (None, None)


def test_adapter_fills_the_engine_fields():
    items, probs = GL.adapt([row(), row(id="lt", subtype="lower-third", data_ref="rundown:the-echo.beats[echo-x2]")], INPUTS)
    assert probs == []
    it = items[0]
    assert it["kind"] == "graphic" and it["file"] == "g.mov" and it["sha256"] == SHA2 and it["frames"] == 54
    assert it["fps"] == "30" and it["alpha"] == "straight" and it["shows_bodies"] is False
    assert it["licence"] == "CC BY-SA 4.0" and it["generator"] == GL.E6 and "output_path" not in it
    assert it["content_date"] == "2026-11-08T11:51:04+00:00" and it["content_basis"]
    assert items[1]["subtype"] == "lower_third" and items[1]["content_date"] == "1951-01-30"


def test_a_field_e6_states_wins():
    it = GL.adapt([row(fps="24", alpha=None, content_date="2026-11-01", content_basis="E6 says")], INPUTS)[0][0]
    assert it["fps"] == "24" and it["alpha"] is None and it["content_date"] == "2026-11-01"


@pytest.mark.parametrize("bad,why", [({"class": "ARCHIVE"}, "DRAWN"), ({"frames": 0}, "frames"),
                                     ({"subtype": "hologram"}, "subtype"), ({"output_sha256": "x"}, "sha256"),
                                     ({"output_path": None}, "output_path")])
def test_a_bad_row_is_refused(bad, why):
    items, probs = GL.adapt([row(**bad)], INPUTS)
    assert items == [] and any(why in p for p in probs)


def test_file_name_posix_and_windows():
    assert GL.file_name("/media/33/a.mov") == "a.mov" and GL.file_name("D:\\m\\33\\b.mov") == "b.mov"


def _film(tmp_path, play_extra):
    (tmp_path / "graphics-ledger.json").write_text(json.dumps([row()]), encoding="utf-8")
    (tmp_path / "rundown.json").write_text(json.dumps(RUNDOWN), encoding="utf-8")
    (tmp_path / "week.json").write_text(json.dumps(RECORD), encoding="utf-8")
    return dict({"ledgers": {"graphics": {"path": "graphics-ledger.json", "format": GL.FORMAT}},
                 "news": {"week": "week.json", "rundown": "rundown.json"}}, **play_extra)


def test_load_ledgers_reads_e6_on_omnibus(tmp_path):
    a = R.load_ledgers(tmp_path, _film(tmp_path, NEWS))
    assert a["g"]["kind"] == "graphic" and a["g"]["_path"].endswith("g.mov")


def test_load_ledgers_refuses_the_format_on_document(tmp_path):
    with pytest.raises(R.Refused, match="binds only"):
        R.load_ledgers(tmp_path, _film(tmp_path, {}))

# --------------------------------------------------------------------------- the vision manifest


def item(**kw):
    return dict({"id": "p", "sha256": SHA, "kind": "still"}, **kw)


def man(**entry):
    return {"schema": NVM.SCHEMA, "issue": 33, "made_by": "E10 test",
            "items": {"p": dict({"sha256": SHA, "shows_bodies": False, "people": []}, **entry)}}


def test_vision_overlays_bodies_and_people():
    r = NVM.apply(man(people=[{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.5, "kind": "person"}]), {"p": item()},
                  {"p": "archive_still"})
    assert r["problems"] == [] and r["pending"] == {} and r["used"] == ["p"]
    assert r["assets"]["p"]["shows_bodies"] is False and r["assets"]["p"]["people"][0]["w"] == 0.2


def test_no_manifest_leaves_pictures_pending():
    r = NVM.apply(None, {"p": item(), "c": item(id="c")}, {"p": "archive_still", "c": "archive_video"})
    assert r["pending"] == {"p": ["shows_bodies", "people"], "c": ["shows_bodies"]} and r["problems"] == []


def test_studio_made_and_drawn_need_no_vision():
    r = NVM.apply(None, {"p": item(generator="studio.engine.pages"), "g": item(id="g")}, {"p": "archive_still", "g": "graphic"})
    assert r["pending"] == {}


def test_the_ledger_wins_and_a_contradiction_is_refused():
    r = NVM.apply(man(shows_bodies=True), {"p": item(shows_bodies=False)}, {"p": "archive_still"})
    assert any("one of them is wrong" in p for p in r["problems"])
    keep = NVM.apply(man(people=[]), {"p": item(people="a crowd")}, {"p": "archive_still"})
    assert keep["assets"]["p"]["people"] == "a crowd"


def test_a_stale_entry_is_refused():
    r = NVM.apply(man(sha256=SHA2), {"p": item()}, {"p": "archive_still"})
    assert any("see it again" in p for p in r["problems"]) and "p" in r["pending"]


@pytest.mark.parametrize("bad", [{"schema": "x"}, {"made_by": ""}, {"items": []}])
def test_vision_manifest_shape(bad):
    assert NVM.problems(dict(man(), **bad))


@pytest.mark.parametrize("entry", [{"shows_bodies": "unknown"}, {"people": {}}, {"sha256": "x"},
                                   {"people": [{"x": 0.9, "y": 0, "w": 0.3, "h": 0.1}]},
                                   {"people": [{"x": 0, "y": 0, "w": 0.1, "h": 0.1, "kind": "dog"}]}, {"extra": 1}])
def test_vision_entry_shape(entry):
    assert NVM.problems(man(**entry))

# --------------------------------------------------------------------------- the voicing manifest


VOICE = {"id": "v-narrator", "engine": "kokoro", "voice": "af_aoede", "speed": 0.88}
PLAY = {"cast": {"voices": [VOICE]}, "parts": [{"id": "p", "lines": [
    {"id": "L1", "kind": "narration", "start_s": 10.0, "text": "Tuesday, the third."}]}]}


def vman(**rec):
    return {"schema": NVO.SCHEMA, "identity": NR.identity(VOICE), "voices": {"v-narrator": NR.identity(VOICE)},
            "lines": {"L1": dict({"voice": "v-narrator", "wav": "audio/L1.wav", "sha256": SHA,
                                  "text_sha256": NR.sha256_text("Tuesday, the third."), "dur_s": 1.5,
                                  "words": [{"w": "Tuesday,", "start_s": 0.1, "end_s": 0.6},
                                            {"w": "the", "start_s": 0.7, "end_s": 0.8},
                                            {"w": "third.", "start_s": 0.85, "end_s": 1.4}]}, **rec)}}


def test_the_path_is_a57s():
    assert NVO.PATH == NR.MANIFEST and set(NVO.JUDGED) == set(NR.ENGINES)


def test_missing_manifest_is_the_one_problem():
    p = NVO.problems(None, PLAY)
    assert len(p) == 1 and "no voicing manifest" in p[0]


def test_a_complete_manifest_passes():
    assert NVO.problems(vman(), PLAY, exists=lambda r: True, read_sha=lambda r: SHA, text_sha=NR.sha256_text) == []


@pytest.mark.parametrize("rec,why", [
    ({"sha256": SHA2}, "not the take"), ({"text_sha256": SHA2}, "text changed"), ({"voice": "v-other"}, "voiced by"),
    ({"words": [{"w": "x", "start_s": 1.0, "end_s": 0.5}]}, "in order"), ({"words": []}, "word timings"),
    ({"wav": "C:/abs.wav"}, "relative"), ({"dur_s": 0}, "length")])
def test_voicing_mismatches(rec, why):
    p = NVO.problems(vman(**rec), PLAY, exists=lambda r: True, read_sha=lambda r: SHA, text_sha=NR.sha256_text)
    assert any(why in x for x in p), p


def test_a_line_missing_from_the_manifest():
    m = vman()
    m["lines"] = {}
    assert NVO.problems(m, PLAY) == ["L1: not in the voicing manifest"]


def test_a_test_tone_is_not_judged():
    tone = {"cast": {"voices": [dict(VOICE, engine="test-tone")]}, "parts": PLAY["parts"]}
    assert not NVO.judged(tone) and NVO.problems(None, tone) and NVO.judged(PLAY)


def test_apply_places_words_on_the_film():
    ln = NVO.apply(PLAY, vman())["parts"][0]["lines"][0]
    assert ln["wav"] == "audio/L1.wav" and ln["words"][0] == {"w": "Tuesday,", "t": 10.1}
    own = {"parts": [{"id": "p", "lines": [dict(PLAY["parts"][0]["lines"][0], wav="audio/x.wav", words=[{"w": "a", "t": 1}])]}]}
    kept = NVO.apply(own, vman())["parts"][0]["lines"][0]
    assert kept["wav"] == "audio/x.wav" and kept["words"] == [{"w": "a", "t": 1}]

# --------------------------------------------------------------------------- muted audio and disclosures


def test_a_muted_ledger_item_is_the_clips_sound():
    m = R.ledger_mute({"audio": {"mode": "muted", "reason": "airs under the narration"}})
    assert m == {"mode": "mute", "reason": "airs under the narration", "from": "rights ledger"}
    assert R.ledger_mute({"audio": None}) is None and R.ledger_mute({}) is None


def test_credit_disclosures_for_aired_assets_only():
    dow = "The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement."
    plan = {"shots": [{"asset": "a", "mark": "ARCHIVE"}, {"asset": "b", "mark": "ARCHIVE"}, {"asset": "a", "mark": "ARCHIVE"},
                      {"mark": "CARD"}],
            "graphic_overlays": [],
            "assets": {"a": {"disclosure": dow}, "b": {}, "c": {"disclosure": "never aired"}}}
    assert R.credit_disclosures(plan) == [{"text": dow, "assets": ["a"]}]


def test_the_rights_ledger_disclosure_matches_the_packet():
    root = Path(__file__).resolve().parents[2] / "episodes" / "33"
    ledger = json.loads((root / "rights-ledger.json").read_text(encoding="utf-8"))
    packet = json.loads((root / "disputes.json").read_text(encoding="utf-8"))
    plan = {"shots": [{"asset": i["id"], "mark": "ARCHIVE"} for i in ledger["items"]], "graphic_overlays": [],
            "assets": {i["id"]: i for i in ledger["items"]}}
    assert R.credit_disclosures(plan) == packet["credit_disclosures"]
