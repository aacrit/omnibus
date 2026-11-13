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


def ritem(lic, adapter="commons", rights=True):
    """A loaded ledger item as load_ledgers leaves it (``_rights_ledger``: from the episode's rights ledger)."""
    return {"id": "r", "licence": lic, "adapter": adapter, "_rights_ledger": rights}


def allowed(lic, play, **kw):
    return R.licence_allowed(lic, play, item=ritem(lic, **kw))


@pytest.mark.parametrize("lic", ["pd-us-federal", "pd-age", "pd-dedication", "cc0-1.0", "eu-reuse-credit",
                                 "cc-by-1.0", "cc-by-2.0", "cc-by-4.0"])
def test_each_allowed_id_reads_as_allowed_on_omnibus(lic):
    assert SHOW.licence_reading(NEWS, ritem(lic))["as"] == "allowed"
    assert allowed(lic, NEWS) == (True, False)


def test_own_property_only_from_the_voidnews_adapter():
    assert allowed("own-property", NEWS, adapter="voidnews") == (True, False)
    assert SHOW.licence_reading(NEWS, ritem("own-property", adapter="commons"))["as"] == "refused"
    assert allowed("own-property", NEWS, adapter="commons") == (False, False)
    assert allowed("own-property", NEWS, adapter=None) == (False, False)


def test_the_map_applies_only_to_rights_ledger_items():
    assert SHOW.licence_reading(NEWS, ritem("pd-us-federal", rights=False)) is None
    assert allowed("pd-us-federal", NEWS, rights=False) == (False, False)
    assert allowed("pd-us-federal", NEWS) == (True, False)
    assert R.licence_allowed("pd-us-federal", NEWS) == (False, False)          # no item: the house allowlist


def _rights_film(tmp_path, refs):
    for rel in {r if isinstance(r, str) else r["path"] for r in refs.values()}:
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"items": [{"id": f"i-{p.parent.name}-{p.stem}", "licence": "pd-us-federal"}]}),
                     encoding="utf-8")
    return R.load_ledgers(tmp_path, dict(NEWS, ledgers=refs))


def test_only_the_episodes_rights_ledger_is_marked(tmp_path):
    a = _rights_film(tmp_path, {"rights": "rights-ledger.json", "other": "copies/rights-ledger.json",
                                "studio": "ledgers/studio.json"})
    assert a["i-" + tmp_path.name + "-rights-ledger"]["_rights_ledger"] is True
    assert a["i-copies-rights-ledger"]["_rights_ledger"] is False       # same name, another file: never the rights
    assert a["i-ledgers-studio"]["_rights_ledger"] is False


def test_the_screenplays_rights_ref_is_the_rights_ledger(tmp_path):
    a = _rights_film(tmp_path, {"rights": "elsewhere/ledger.json"})
    assert a["i-elsewhere-ledger"]["_rights_ledger"] is True
    b = _rights_film(tmp_path / "f2", {"media": "rights-ledger.json"})    # <film>/rights-ledger.json by its path
    assert b["i-f2-rights-ledger"]["_rights_ledger"] is True


@pytest.mark.parametrize("lic", ["cc-by-sa-2.0", "cc-by-sa-4.0"])
def test_share_alike_needs_the_declaration(lic):
    assert SHOW.licence_reading(NEWS, ritem(lic))["as"] == "share_alike"
    assert allowed(lic, NEWS) == (False, True)
    assert allowed(lic, NEWS_SA) == (True, True)


def test_by_sa_1_0_is_refused_for_a_by_sa_4_0_episode():
    assert "cc-by-sa-1.0" not in SHOW.LICENCES and "1.0" not in SHOW.SA_VERSIONS
    assert SHOW.licence_reading(NEWS_SA, ritem("cc-by-sa-1.0"))["as"] == "refused"
    assert allowed("cc-by-sa-1.0", NEWS_SA) == (False, False)


def test_eu_reuse_is_named_as_itself():
    assert SHOW.LICENCES["eu-reuse-credit"]["reads_as"] == "EU reuse with credit (2011/833/EU)"
    assert SHOW.LICENCES["eu-reuse-credit"]["attribution"] is True


def test_every_rights_allowlist_id_is_mapped():
    src = (Path(__file__).resolve().parents[2] / "scripts" / "lib" / "rights" / "licences.mjs").read_text(encoding="utf-8")
    for fixed in ("cc0-1.0", "eu-reuse-credit", "pd-us-federal", "pd-age", "pd-dedication", "own-property"):
        assert fixed in src and fixed in SHOW.LICENCES
    assert '["1.0", "2.0", "2.1", "2.5", "3.0", "4.0"]' in src
    assert 'SA_VERSIONS = CC_VERSIONS.filter((v) => v !== "1.0")' in src and "SA_VERSIONS.map((v) => `cc-by-sa-${v}`)" in src
    assert all(f"cc-by-{v}" in SHOW.LICENCES for v in SHOW.CC_VERSIONS)
    assert all(f"cc-by-sa-{v}" in SHOW.LICENCES for v in SHOW.SA_VERSIONS)


@pytest.mark.parametrize("lic,before", [("pd-us-federal", (False, False)), ("own-property", (False, False)),
                                         ("eu-reuse-credit", (False, False)), ("cc-by-sa-4.0", (False, True))])
def test_document_reads_licences_as_before(lic, before):
    assert SHOW.licence_reading({}, ritem(lic, adapter="voidnews")) is None
    assert allowed(lic, {}, adapter="voidnews") == before
    assert R.licence_allowed(lic, {}) == before


def test_document_house_words_unchanged():
    assert R.licence_allowed("Public domain", {}) == (True, False)
    assert R.licence_allowed("CC BY-SA 4.0", {}) == (False, True)
    assert allowed("CC BY 4.0", NEWS, rights=False) == (True, False)   # a studio item: the house words
    assert allowed("CC BY-SA 4.0", NEWS_SA, rights=False) == (True, True)

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
    ("rundown:week testcard", "2026-11-08T11:51:04+00:00"),                  # a part dated per beat: its latest beat
    ("rundown:week testcard; week:bars", "2026-11-08T22:16:50+00:00"),       # the latest readable ref: the week's bars
    ("rundown:echo testcard; week:bars", "1952-11-05T12:00:00-05:00"),       # the echo card's grey bars draw no data
    ("week:bars; rundown:the-echo.beats[echo-x2]", "2026-11-08T22:16:50+00:00"),   # bars beside anything else: data
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


def test_the_echo_cards_bars_are_named_as_no_data():
    _, basis = GL.content_date("rundown:echo testcard; week:bars", INPUTS)
    assert "week:bars draws no data" in basis
    assert GL.non_data_refs(["rundown:week testcard", "week:bars"]) == set()


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
    assert it["content_date"] == "2026-11-08T22:16:50+00:00" and it["content_basis"]   # week:bars, the latest
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


def test_document_reads_a_format_key_as_before(tmp_path):
    a = R.load_ledgers(tmp_path, _film(tmp_path, {}))       # no adapter: the raw rows, as document always read them
    assert a["g"].get("kind") is None and a["g"]["_path"] is None


def test_an_unknown_format_is_refused_on_omnibus(tmp_path):
    play = _film(tmp_path, NEWS)
    play["ledgers"]["graphics"]["format"] = "e7-something"
    with pytest.raises(R.Refused, match="not one the engine reads"):
        R.load_ledgers(tmp_path, play)

# --------------------------------------------------------------------------- the vision manifest


def item(**kw):
    return dict({"id": "p", "sha256": SHA, "kind": "still"}, **kw)


REVIEW = {"by": "verifier: E10 test", "at": "2026-11-13T12:00:00Z", "frames": [0, 25, 50],
          "contact_sheet": {"path": "sheets/p.jpg", "sha256": SHA}, "duration_s": 60}


def man(**entry):
    return {"schema": NVM.SCHEMA, "issue": 33, "made_by": "E10 test",
            "items": {"p": dict({"sha256": SHA, "shows_bodies": False, "people": [], "marks": [],
                                 "reviewed": REVIEW},
                                **entry)}}


def on_disk(sha=SHA):
    return lambda it: sha


def test_vision_overlays_bodies_and_people():
    r = NVM.apply(man(people=[{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.5, "kind": "person"}]), {"p": item()},
                  {"p": ["archive_still"]}, read_sha=on_disk())
    assert r["problems"] == [] and r["pending"] == {} and r["used"] == ["p"]
    assert r["assets"]["p"]["shows_bodies"] is False and r["assets"]["p"]["people"][0]["w"] == 0.2


def test_no_manifest_leaves_pictures_pending():
    r = NVM.apply(None, {"p": item(), "c": item(id="c")}, {"p": ["archive_still"], "c": ["archive_video"]})
    assert r["pending"] == {"p": ["shows_bodies", "people", "marks"], "c": ["shows_bodies", "marks"]} and r["problems"] == []


def test_needs_come_from_every_kind_an_asset_is_cited_as():
    r = NVM.apply(None, {"p": item(shows_bodies=False)}, {"p": ["archive_video", "archive_still"]})
    assert r["pending"] == {"p": ["marks", "people"]}   # the still's need, though the clip came first


def test_studio_made_and_drawn_need_no_vision():
    r = NVM.apply(None, {"p": item(generator="studio.engine.pages"), "g": item(id="g")},
                  {"p": ["archive_still"], "g": ["graphic"]})
    assert r["pending"] == {}


def test_the_ledger_wins_and_a_contradiction_is_refused():
    r = NVM.apply(man(shows_bodies=True), {"p": item(shows_bodies=False)}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert any("one of them is wrong" in p for p in r["problems"])
    keep = NVM.apply(man(people=[]), {"p": item(people="a crowd")}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert keep["assets"]["p"]["people"] == "a crowd"


def test_the_legacy_bodies_flag_counts_as_the_ledgers():
    legacy = item(shows_violence_or_bodies=False)
    r = NVM.apply(man(shows_bodies=True), {"p": legacy}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert any("one of them is wrong" in p for p in r["problems"])
    ok = NVM.apply(man(shows_bodies=False), {"p": legacy}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert ok["problems"] == [] and "shows_bodies" not in ok["assets"]["p"]     # never added beside the legacy flag
    assert ok["pending"] == {}


@pytest.mark.parametrize("entry_sha,ledger_sha,file_sha", [(SHA2, SHA, SHA), (SHA, SHA2, SHA), (SHA, SHA, SHA2),
                                                           (SHA, SHA, None)])
def test_the_file_ledger_and_entry_must_name_the_same_bytes(entry_sha, ledger_sha, file_sha):
    r = NVM.apply(man(sha256=entry_sha), {"p": item(sha256=ledger_sha)}, {"p": ["archive_still"]},
                  read_sha=on_disk(file_sha))
    assert any("see it again" in p for p in r["problems"]) and "p" in r["pending"] and r["used"] == []


def test_without_a_file_reader_no_entry_is_used():
    r = NVM.apply(man(), {"p": item()}, {"p": ["archive_still"]})
    assert r["used"] == [] and any("see it again" in p for p in r["problems"])


def test_render_hashes_the_file_on_disk(tmp_path):
    import hashlib
    f = tmp_path / "p.png"
    f.write_bytes(b"picture")
    want = hashlib.sha256(b"picture").hexdigest()
    assert R.file_sha256({"_path": str(f)}) == want
    f.write_bytes(b"another picture")                    # new size: rehashed, never the cached value
    assert R.file_sha256({"_path": str(f)}) == hashlib.sha256(b"another picture").hexdigest()
    assert R.file_sha256({"_path": str(tmp_path / "missing.png")}) is None


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
    ({"wav": "C:/abs.wav"}, "relative"), ({"wav": "C:abs.wav"}, "relative"), ({"wav": "/abs.wav"}, "relative"),
    ({"wav": "\\\\host\\share\\a.wav"}, "relative"), ({"wav": "audio/../../x.wav"}, "relative"),
    ({"wav": "audio\\..\\..\\x.wav"}, "relative"), ({"dur_s": 0}, "length")])
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


def test_relative_inside_on_every_os():
    assert NVO.relative_inside("audio/L1.wav") and NVO.relative_inside("audio\\L1.wav")
    for bad in ("C:/a.wav", "C:a.wav", "/a.wav", "\\\\h\\s\\a.wav", "../a.wav", "audio/../../a.wav", "a\\..\\..\\b"):
        assert not NVO.relative_inside(bad), bad


def test_apply_without_words_places_the_take_only():
    ln = NVO.apply(PLAY, vman(), words=False)["parts"][0]["lines"][0]
    assert ln["wav"] == "audio/L1.wav" and "words" not in ln
    moved = {"parts": [{"id": "p", "lines": [dict(ln, start_s=20.0)]}]}       # --fit-voices moved the line
    assert NVO.apply(moved, vman())["parts"][0]["lines"][0]["words"][0] == {"w": "Tuesday,", "t": 20.1}


def test_apply_places_words_on_the_film():
    ln = NVO.apply(PLAY, vman())["parts"][0]["lines"][0]
    assert ln["wav"] == "audio/L1.wav" and ln["words"][0] == {"w": "Tuesday,", "t": 10.1}
    own = {"parts": [{"id": "p", "lines": [dict(PLAY["parts"][0]["lines"][0], wav="audio/x.wav", words=[{"w": "a", "t": 1}])]}]}
    kept = NVO.apply(own, vman())["parts"][0]["lines"][0]
    assert kept["wav"] == "audio/x.wav" and kept["words"] == [{"w": "a", "t": 1}]


def test_check_with_fit_voices_plans_the_fitted_lines_and_writes_nothing(tmp_path, monkeypatch):
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "voice.json").write_text(json.dumps(vman()), encoding="utf-8")
    (tmp_path / "audio" / "L1.wav").write_bytes(b"take")
    play = dict(PLAY, show="omnibus", issue=33)
    (tmp_path / "screenplay.json").write_text(json.dumps(play), encoding="utf-8")
    monkeypatch.setattr(R.NR, "sha256_path", lambda p: SHA)
    monkeypatch.setattr(R, "preflight_sources", lambda film, play, journal, draft: [])
    monkeypatch.setattr(R, "fit_voices", lambda p, film, journal: dict(
        p, parts=[dict(pt, lines=[dict(ln, start_s=20.0) for ln in pt["lines"]]) for pt in p["parts"]]))
    planned = []
    monkeypatch.setattr(R, "build_plan", lambda film, **kw: planned.append(kw["play"]) or {"shots": []})
    before = sorted(p.name for p in tmp_path.rglob("*"))
    assert R.check_plan(tmp_path, draft=True, fit=True)["ok"]
    assert planned[-1]["parts"][0]["lines"][0]["words"][0] == {"w": "Tuesday,", "t": 20.1}   # words after the fit
    assert R.check_plan(tmp_path, draft=True)["ok"]
    assert planned[-1]["parts"][0]["lines"][0]["words"][0] == {"w": "Tuesday,", "t": 10.1}   # unfitted by default
    assert sorted(p.name for p in tmp_path.rglob("*")) == before


MEDIA = "D:/omnibus-media/33/voice"


def test_a_media_root_is_where_the_takes_are():
    m = dict(vman(), media=MEDIA)             # E7 writes the takes to the media root, never into the repo
    assert NVO.take(m, "audio/L1.wav") == f"{MEDIA}/L1.wav" and NVO.take(vman(), "audio/L1.wav") == "audio/L1.wav"
    asked = []
    ok = dict(exists=lambda r: asked.append(r) or True, read_sha=lambda r: SHA, text_sha=NR.sha256_text)
    assert NVO.problems(m, PLAY, **ok) == [] and asked == [f"{MEDIA}/L1.wav"]
    placed = NVO.apply(PLAY, m, words=False)
    assert placed["parts"][0]["lines"][0]["wav"] == f"{MEDIA}/L1.wav"
    assert NVO.problems(m, placed, **ok) == []                    # a second pass (place_voices) reads it again
    other = {"parts": [{"id": "p", "lines": [dict(PLAY["parts"][0]["lines"][0], wav="audio/x.wav")]}],
             "cast": PLAY["cast"]}
    assert any("the screenplay plays" in p for p in NVO.problems(m, other, **ok))


@pytest.mark.parametrize("media", [5, "", "  ", ["D:/x"]])
def test_a_media_root_must_be_a_folder_name(media):
    assert any("media" in p for p in NVO.problems(dict(vman(), media=media), PLAY, exists=lambda r: True,
                                                  read_sha=lambda r: SHA, text_sha=NR.sha256_text))


def test_a_news_film_reads_its_takes_from_the_media_root(tmp_path, monkeypatch):
    from studio.engine import journal as J
    film, media = tmp_path / "film", tmp_path / "media" / "voice"
    (film / "audio").mkdir(parents=True)
    media.mkdir(parents=True)
    (film / "audio" / "voice.json").write_text(json.dumps(dict(vman(), media=media.as_posix())), encoding="utf-8")
    (media / "L1.wav").write_bytes(b"take")                       # the film folder holds no WAV at all
    monkeypatch.setattr(R.NR, "sha256_path", lambda p: SHA if Path(p).exists() else None)
    play = dict(PLAY, show="omnibus", issue=33)
    v = R.news_voicing(film, play)
    assert v["problems"] == []
    got = R.place_voices(film, play, J.Journal(film="media"), tmp_path / "out", fit=False)
    ln = got["parts"][0]["lines"][0]
    assert R.voice_wav(film, ln) == media / "L1.wav" and ln["words"][0] == {"w": "Tuesday,", "t": 10.1}

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


def test_a_muted_clip_is_never_heard_through_an_archival_span():
    assets = {"dv": {"audio": {"mode": "muted", "reason": "airs under the narration"}}, "ok": {}}
    lines = [{"id": "T1", "kind": "testimony", "archival_audio": True, "clip": "dv", "in_s": 0, "out_s": 2},
             {"id": "T2", "kind": "testimony", "archival_audio": True, "clip": "ok", "in_s": 0, "out_s": 2},
             {"id": "N1", "kind": "narration", "clip": "dv"}]          # names the clip but plays no span of it
    assert [ln["id"] for ln in R.muted_spans(lines, assets)] == ["T1"]


def test_a_clip_heard_through_a_span_carries_its_disclosure():
    plan = {"shots": [], "graphic_overlays": [], "assets": {"dv": {"disclosure": "DoW line"}},
            "lines": [{"id": "T1", "archival_audio": True, "clip": "dv"}]}
    assert R.credit_disclosures(plan) == [{"text": "DoW line", "assets": ["dv"]}]


def test_the_credits_graphic_must_carry_every_disclosure():
    plan = {"shots": [{"kind": "graphic", "subtype": "credits", "asset": "credits"}],
            "credit_disclosures": [{"text": "DoW line", "assets": ["dv"]}, {"text": "kept", "assets": ["x"]}]}
    rundown = {"parts": [{"id": "credits", "disclosures": ["kept", "something else"]}]}
    assert R.credits_graphic_missing(plan, rundown) == (["credits"], ["DoW line"])
    assert R.credits_graphic_missing(dict(plan, shots=[]), rundown) == (None, [])   # the engine's roll carries them


def test_a_credits_roll_that_reads_the_rights_ledger_carries_its_disclosures():
    # E6's credits_spec (studio/graphics/data.py) typesets every rights-ledger item's own disclosure, and says so in
    # its row's data_ref; the rundown's hand-kept list need not repeat the DoW line
    reads = "rights-ledger:items[].credit, items[].disclosure; rundown:voices, credits.disclosures"
    plan = {"shots": [{"kind": "graphic", "subtype": "credits", "asset": "credits"}],
            "credit_disclosures": [{"text": "DoW line", "assets": ["dv"]}, {"text": "kept", "assets": ["x"]}],
            "assets": {"credits": {"data_ref": reads}, "dv": {"disclosure": "DoW line", "_rights_ledger": True},
                       "pg": {"disclosure": "kept", "_rights_ledger": False}}}
    rundown = {"parts": [{"id": "credits", "disclosures": []}]}
    assert R.credits_graphic_missing(plan, rundown) == (["credits"], ["kept"])   # a non-rights-ledger line is not
    older = dict(plan, assets=dict(plan["assets"], credits={"data_ref": "rundown:voices, credits.disclosures"}))
    assert R.credits_graphic_missing(older, rundown) == (["credits"], ["DoW line", "kept"])   # a roll that never read it


def test_week_33s_credits_roll_carries_the_dow_line():
    from studio.graphics import data as GD
    root = Path(__file__).resolve().parents[2] / "episodes" / "33"
    rundown = json.loads((root / "rundown.json").read_text(encoding="utf-8"))
    ledger = json.loads((root / "rights-ledger.json").read_text(encoding="utf-8"))
    row = next(r for r in json.loads((root / "graphics-ledger.json").read_text(encoding="utf-8")) if r["id"] == "credits")
    lines = GD.credits_spec(rundown, ledger).lines
    packet = json.loads((root / "disputes.json").read_text(encoding="utf-8"))
    assert row["lines"] == len(lines) and "items[].disclosure" in row["data_ref"]
    assert all(d["text"] in lines for d in packet["credit_disclosures"])


@pytest.mark.parametrize("lic", ["cc-by-nc-4.0", "Public domain", "CC BY-SA 4.0", "cc-by-sa-1.0", ""])
def test_a_rights_ledger_id_off_the_map_is_refused(lic):
    assert allowed(lic, NEWS_SA) == (False, False)        # never read by the house regexes on a rights-ledger item


def test_a_testcards_bars_are_dated_by_the_field_they_draw():
    rundown = {"parts": [
        {"id": "the-week", "as_of": "per beat", "testcard": {"field": "sum over days[i].lead.buckets"},
         "beats": [{"id": "d1", "as_of": "2026-11-02T00:59:28+00:00"}]},
        {"id": "the-weight", "as_of": "2026-11-08T22:16:50+00:00", "beats": [{"id": "wc", "testcard": {"field": "lead.claim.rung_counts"}}]}]}
    record = {"as_of": "2026-11-08T22:16:50+00:00", "days": [{"printed_at": "2026-11-02T00:59:28+00:00"},
                                                             {"printed_at": "2026-11-08T11:51:04+00:00"}]}
    inputs = {"rundown": rundown, "record": record}
    d, basis = GL.content_date("rundown:week testcard; week:bars", inputs)
    assert d == "2026-11-08T11:51:04+00:00" and "days[1].printed_at" in basis      # never the record's later close
    assert GL.content_date("rundown:weight testcard; week:bars", inputs)[0] == "2026-11-08T22:16:50+00:00"



def test_a_document_film_with_fit_voices_still_writes_its_fitted_screenplay(tmp_path, monkeypatch):
    from studio.engine import journal as J
    moved = {"parts": [{"id": "p", "lines": [{"id": "L1", "kind": "narration", "start_s": 12.0, "text": "x"}]}]}
    monkeypatch.setattr(R, "fit_voices", lambda play, film, journal: moved)
    out = tmp_path / "out"
    j = J.Journal(film="fit")
    got = R.place_voices(tmp_path, {"parts": []}, j, out, fit=True)
    assert got == moved
    assert json.loads((out / "screenplay.fitted.json").read_text(encoding="utf-8")) == moved
    assert R.place_voices(tmp_path, {"parts": []}, j, tmp_path / "out2", fit=False) == {"parts": []}
    assert not (tmp_path / "out2").exists()


def test_a_news_film_with_fit_voices_writes_it_and_places_words_after(tmp_path, monkeypatch):
    from studio.engine import journal as J
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "voice.json").write_text(json.dumps(vman()), encoding="utf-8")
    (tmp_path / "audio" / "L1.wav").write_bytes(b"take")
    monkeypatch.setattr(R.NR, "sha256_path", lambda p: SHA)
    play = dict(PLAY, show="omnibus", issue=33)

    def fit(p, film, journal):           # --fit-voices moves the line to 20 s
        return dict(p, parts=[dict(pt, lines=[dict(ln, start_s=20.0) for ln in pt["lines"]]) for pt in p["parts"]])
    monkeypatch.setattr(R, "fit_voices", fit)
    got = R.place_voices(tmp_path, play, J.Journal(film="fit"), tmp_path / "out", fit=True)
    assert (tmp_path / "out" / "screenplay.fitted.json").exists()
    assert got["parts"][0]["lines"][0]["words"][0] == {"w": "Tuesday,", "t": 20.1}


# --------------------------------------------------------------------------- on-screen marks (S4 review, 2026-11-13)


def test_marks_are_required_of_every_archive_picture_and_overlaid():
    r = NVM.apply(None, {"c": item(id="c", shows_bodies=False)}, {"c": ["archive_video"]})
    assert r["pending"] == {"c": ["marks"]}
    led = NVM.apply(None, {"c": item(id="c", shows_bodies=False, marks_checked={"marks": [], "reviewed": REVIEW})},
                    {"c": ["archive_video"]})
    assert led["pending"] == {}                          # the ledger's frame check counts as stated
    bare = NVM.apply(None, {"c": item(id="c", shows_bodies=False, marks_checked={"marks": []})}, {"c": ["archive_video"]})
    assert bare["pending"] == {"c": ["marks"]}           # ... only with a review that stands
    ok = NVM.apply(man(marks=["The White House logo, lower left"]), {"p": item()}, {"p": ["archive_still"]},
                   read_sha=on_disk())
    assert ok["problems"] == [] and ok["assets"]["p"]["marks"] == ["The White House logo, lower left"]


def test_a_mark_naming_a_denied_party_or_c_span_refuses_the_picture():
    for mk in ("C-SPAN bug, top right", "CNN lower third", "Reuters watermark"):
        r = NVM.apply(man(marks=[mk]), {"p": item()}, {"p": ["archive_still"]}, read_sha=on_disk())
        assert any("denied party" in p for p in r["problems"]) and r["used"] == [], mk
    r = NVM.apply(None, {"c": item(id="c", shows_bodies=False, marks_checked={"marks": ["C-SPAN"]})},
                  {"c": ["archive_video"]})
    assert any("denied party" in p for p in r["problems"])   # the ledger's own frame check, refused here too


@pytest.mark.parametrize("entry", [{"marks": "none"}, {"marks": [""]}, {"reviewed": {"by": "x", "at": "t"}},
                                   {"reviewed": {"by": "x", "at": "t", "frames_checked": 0}}, {"reviewed": None},
                                   {"reviewed": dict(REVIEW, by="Forge builder (Claude Opus 5.5)")},
                                   {"reviewed": dict(REVIEW, by="sourcer")},
                                   {"reviewed": dict(REVIEW, frames=None, frames_checked=8)},
                                   {"reviewed": dict(REVIEW, contact_sheet=None)}])
def test_marks_need_a_review_with_frames_checked(entry):
    assert NVM.problems(man(**entry))


def test_marks_frames_cover_the_aired_span():
    clip = item(fit={"in_s": 0, "out_s": 33})
    r = NVM.apply(man(reviewed=dict(REVIEW, frames=[5])), {"p": clip}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert any("none in 16.5..33 s" in p for p in r["problems"]) and r["used"] == []
    ok = NVM.apply(man(reviewed=dict(REVIEW, frames=[1.3, 12, 24.1])), {"p": clip}, {"p": ["archive_still"]},
                   read_sha=on_disk())
    assert ok["problems"] == []
    whole = NVM.apply(man(reviewed=dict(REVIEW, duration_s=None)), {"p": item()}, {"p": ["archive_still"]},
                      read_sha=on_disk())
    assert any("duration_s" in p for p in whole["problems"])


def test_a_call_to_action_refuses_the_picture_unless_masked():
    cta = 'The White House lower third: TEXT "POTUS" TO 45470, a QR code'
    r = NVM.apply(man(marks=[cta]), {"p": item()}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert any("call to action" in p for p in r["problems"]) and r["used"] == []
    masked = item(marks_checked={"marks": [cta], "reviewed": REVIEW,
                                 "mask": {"covers": [cta], "region": {"x": 0, "y": 0.8, "w": 1, "h": 0.2}}})
    ok = NVM.apply(man(marks=[cta]), {"p": masked}, {"p": ["archive_still"]}, read_sha=on_disk())
    assert ok["problems"] == []
