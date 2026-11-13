# Net-new in omnibus (E9i).
"""The vision manifest: what the vision pass (E10) saw in each picture, read by the engine at plan time. Pure: no I/O
(render.py reads the file and passes its JSON in).

``<film>/vision.json`` (episodes/<issue>/vision.json), written by E10, never by hand, schema ``omnibus-vision/1``::

    {
      "schema": "omnibus-vision/1",
      "issue": 33,
      "made_by": "E10 vision pass: <tool and version>, <model keys>",
      "items": {
        "<ledger item id>": {
          "sha256": "<the item's file sha256, exactly the ledger's>",
          "shows_bodies": false,
          "people": [{"x": 0.41, "y": 0.18, "w": 0.12, "h": 0.55, "name": null, "kind": "person"}],
          "marks": ["<an on-screen mark seen in the frames: a logo, a bug, a lower third, a watermark>"],
          "reviewed": {"by": "verifier: <who>", "at": "<ISO date-time>", "frames": [0.0, 12.0, 24.0],
                       "contact_sheet": {"path": "<the sheet of those frames>", "sha256": "<64 hex>"},
                       "duration_s": 33.0}
        }
      }
    }

- ``sha256`` binds the entry to the exact file the ledger names: an entry for another file is stale and refused (a
  re-fetched picture is seen again).
- ``shows_bodies`` (true or false; never absent or "unknown") feeds the imagery rule's no-bodies lint (A21, 1.6).
- ``people`` is every person in the picture, as the engine's ledger ``people`` (tour.people_of): each entry located by
  ``{x, y, w, h}`` (picture fractions, x and y the top-left corner), ``kind`` "person" or "face", ``name`` only where
  the item's own caption names that person. ``[]`` is nobody. A still needs it (the camera frames people, A7, A41, A51);
  a clip states ``shows_bodies`` and may omit ``people``.
- ``marks`` (S4 review, 2026-11-13) is every on-screen mark seen in the picture's frames (a broadcaster's bug, an
  agency's lower third, a watermark), ``[]`` for none. Every archive still and clip needs it; a mark naming a denied
  party (C-SPAN, an agency, a network: scripts/lib/rights/licences.mjs DENIED_NAMES) refuses the picture, and so does a
  call to action (``CTA_MARK``: a QR code, "TEXT ... TO 45470") unless the ledger item's ``marks_checked.mask``
  ``{covers, region}`` records its mask (the shot is then alteration-marked). A ledger item's own ``marks_checked``
  (the rights lint's frame check) counts as stated only when its review stands, as below.
- ``reviewed``: who confirmed the reading. With ``marks`` it is required: ``by`` names the checking role (verifier, cos
  or founder; never the builder or the sourcer, CoS ruling 2026-11-13), ``at``, ``frames`` (the timestamps looked at,
  one in every 30 s of the aired span: the item's ``fit`` in_s..out_s, else the whole file, ``duration_s``) and
  ``contact_sheet`` ``{path, sha256}``.

The ledger wins: a field the rights ledger states is never replaced, and a manifest entry that contradicts it
(``shows_bodies``) is refused, since one of them is wrong. A picture that needs vision data is a ledger item shown as
an archive still or clip and not made by the studio (no ``generator``, ``synthetic`` or ``test_fixture``): a drawn
graphic or typeset page states its own content.

In ``--draft`` (and a check render) a picture with no vision data is a warning and is planned as the engine plans an
unmeasured still (people unknown, A41's default); a final render refuses it (``vision-manifest``).
"""

from __future__ import annotations

import math
import re
from pathlib import Path

SCHEMA = "omnibus-vision/1"
PATH = Path("vision.json")
PICTURE_KINDS = ("archive_still", "archive_video")
PEOPLE_KINDS = ("person", "face")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ENTRY_KEYS = {"sha256", "shows_bodies", "people", "marks", "reviewed"}
# A mark naming a denied party (mirrors scripts/lib/rights/licences.mjs DENIED_NAMES; C-SPAN by the S4 review).
DENIED_MARK = re.compile(
    r"\bC-?SPAN\b|\bAssociated Press\b|\bAP(?: Photo| Images| Video| Archive| Newsroom)?\b|\bAPTN\b|\bReuters\b|\bAFP\b"
    r"|\bGetty\b|\biStock|\bShutterstock\b|\bAlamy\b|\bEPA\b|\bBloomberg\b|\bRuptly\b|\bStoryful\b|\bXinhua\b|\bCCTV\b"
    r"|\bpool\b|\bUN Web TV\b|\bAl Jazeera\b|\bBBC\b|\bCNN\b|\bNBC\b|\bCBS\b|\bABC News\b|\bFox News\b|\bFOX\b"
    r"|\bSky News\b|\bDW\b|\bDeutsche Welle\b|\bFrance ?24\b|\bEuronews\b|\bRT\b|\bCGTN\b|\bMSNBC\b|\bNPR\b|\bPBS\b",
    re.I)


REVIEWERS = ("verifier", "cos", "founder")
REVIEWER = re.compile(r"^\s*(verifier|cos|founder)\b", re.I)
NOT_REVIEWER = re.compile(r"\b(builder|sourcer|sourcing)\b", re.I)
FRAME_EVERY_S = 30
# A call to action on screen (mirrors licences.mjs CTA_MARK): an engagement mechanic void never airs.
CTA_MARK = re.compile(r"QR code|TEXT .* TO \d{4,6}|scan (the|this)|text .* to \d{4,6}", re.I)


def studio_made(item: dict) -> bool:
    return bool(item.get("generator") or item.get("synthetic") or item.get("test_fixture"))


def needs(item: dict | None, shot_kind: str) -> bool:
    """Whether a picture the screenplay shows as ``shot_kind`` needs the vision pass's reading."""
    return bool(item) and shot_kind in PICTURE_KINDS and not studio_made(item)


def aired_span(item: dict, reviewed: dict | None):
    """The span the frames must cover: the item's fit in_s..out_s, else 0..duration_s; None when neither is known."""
    f = item.get("fit") if isinstance(item.get("fit"), dict) else {}
    a, b = f.get("in_s"), f.get("out_s")
    if _num(a) and _num(b) and b > a:
        return float(a), float(b)
    d = (reviewed or {}).get("duration_s")
    return (0.0, float(d)) if _num(d) and d > 0 else None


def uncovered(frames, span, every=FRAME_EVERY_S) -> list[tuple[float, float]]:
    """The 30 s windows of the span no frame falls in."""
    a, b = span
    n = max(1, math.ceil((b - a) / every - 1e-9))
    w = (b - a) / n
    out = []
    for k in range(n):
        lo, hi = a + k * w, a + (k + 1) * w
        if not any(lo - 1e-6 <= t <= hi + 1e-6 for t in frames):
            out.append((round(lo, 2), round(hi, 2)))
    return out


def review_problems(r, where: str, item: dict | None = None) -> list[str]:
    """Why a marks review cannot stand: the role, the time, the frames (over the aired span when the item is given), the
    contact sheet."""
    if not isinstance(r, dict):
        return [f"{where} is {{by, at, frames, contact_sheet}}"]
    out = []
    by = r.get("by") if isinstance(r.get("by"), str) else ""
    if not REVIEWER.search(by) or NOT_REVIEWER.search(by):
        out.append(f"{where}.by names the checking role ({', '.join(REVIEWERS)}), never the builder or the sourcer")
    if not (isinstance(r.get("at"), str) and r["at"].strip()):
        out.append(f"{where}.at is when the marks were checked")
    fr = r.get("frames")
    if not (isinstance(fr, list) and fr and all(_num(t) and t >= 0 for t in fr)):
        out.append(f"{where}.frames lists the timestamps looked at (seconds into the file, at least one)")
    elif item is not None:
        span = aired_span(item, r)
        if span is None:
            out.append(f"{where}.duration_s states the file's length (the item's fit names no in_s..out_s)")
        else:
            gaps = uncovered(fr, span)
            if gaps:
                out.append(f"{where}.frames holds one frame in every {FRAME_EVERY_S} s of the aired span {span[0]:g}.."
                           f"{span[1]:g} s; none in " + ", ".join(f"{lo:g}..{hi:g} s" for lo, hi in gaps))
    cs = r.get("contact_sheet")
    if not (isinstance(cs, dict) and isinstance(cs.get("path"), str) and cs["path"].strip()
            and isinstance(cs.get("sha256"), str) and SHA256.match(cs["sha256"])):
        out.append(f"{where}.contact_sheet is {{path, sha256}} naming the sheet of those frames")
    return out


def ledger_marks(item: dict):
    """The ledger's own frame check, when its review stands: its marks, else None."""
    mc = item.get("marks_checked")
    if not (isinstance(mc, dict) and isinstance(mc.get("marks"), list)):
        return None
    return mc["marks"] if not review_problems(mc.get("reviewed"), "marks_checked.reviewed", item) else None


def marks_stated(item: dict):
    """The item's on-screen marks: the manifest's ``marks`` overlaid, else the ledger's ``marks_checked.marks`` (only
    when its review stands: a role other than the builder, frames over the aired span, a contact sheet)."""
    if isinstance(item.get("marks"), list):
        return item["marks"]
    return ledger_marks(item)


def unmasked_ctas(marks, item: dict) -> list[str]:
    """The call-to-action marks the ledger item's ``marks_checked.mask`` does not cover."""
    mc = item.get("marks_checked") if isinstance(item.get("marks_checked"), dict) else {}
    mask = mc.get("mask") if isinstance(mc.get("mask"), dict) else {}
    covers = [c for c in mask.get("covers") or [] if isinstance(c, str)]
    reg = mask.get("region") if isinstance(mask.get("region"), dict) else {}
    located = all(_num(reg.get(k)) for k in ("x", "y", "w", "h")) and reg["w"] > 0 and reg["h"] > 0
    return [m for m in marks or [] if isinstance(m, str) and CTA_MARK.search(m) and not (located and m in covers)]


def refused_marks(marks, item: dict) -> list[str]:
    """Why these marks refuse the picture: a denied party, or an unmasked call to action."""
    return denied_marks(marks) + [f"a call to action, unmasked: {m}" for m in unmasked_ctas(marks, item)]


def denied_marks(marks) -> list[str]:
    """The marks that name a denied party."""
    return [m for m in marks or [] if isinstance(m, str) and DENIED_MARK.search(m)]


def missing_fields(item: dict, shot_kind: str) -> list[str]:
    """The fields the item still lacks after the manifest: ``shows_bodies`` and ``marks`` for any picture, ``people``
    for a still."""
    out = []
    if bodies_stated(item) is None:
        out.append("shows_bodies")
    if shot_kind == "archive_still" and "people" not in item:
        out.append("people")
    if marks_stated(item) is None:
        out.append("marks")
    return out


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def person_problems(p, where: str) -> list[str]:
    if not isinstance(p, dict):
        return [f"{where} is an object {{x, y, w, h, kind}}"]
    out = []
    xs = [p.get(k) for k in ("x", "y", "w", "h")]
    if not all(_num(v) for v in xs):
        out.append(f"{where} is located by numeric x, y, w and h (picture fractions)")
    else:
        x, y, w, h = (float(v) for v in xs)
        if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1 and x + w <= 1 + 1e-6 and y + h <= 1 + 1e-6):
            out.append(f"{where} lies inside the picture (fractions 0 to 1, w and h above 0)")
    if p.get("kind", "person") not in PEOPLE_KINDS:
        out.append(f"{where}.kind is one of {list(PEOPLE_KINDS)}")
    if p.get("name") is not None and not (isinstance(p["name"], str) and p["name"].strip()):
        out.append(f"{where}.name is a name or null")
    return out


def entry_problems(aid: str, e) -> list[str]:
    if not isinstance(e, dict):
        return [f"items.{aid} is an object"]
    out = []
    extra = sorted(set(e) - ENTRY_KEYS)
    if extra:
        out.append(f"items.{aid} has unknown keys {extra} (known: {sorted(ENTRY_KEYS)})")
    if not (isinstance(e.get("sha256"), str) and SHA256.match(e["sha256"])):
        out.append(f"items.{aid}.sha256 is the file's sha256 (64 hex)")
    if "shows_bodies" in e and not isinstance(e["shows_bodies"], bool):
        out.append(f"items.{aid}.shows_bodies is true or false (never unknown)")
    if "marks" in e:
        if not (isinstance(e["marks"], list) and all(isinstance(m, str) and m.strip() for m in e["marks"])):
            out.append(f"items.{aid}.marks lists the on-screen marks seen ([] is none)")
        out += review_problems(e.get("reviewed"), f"items.{aid}.reviewed")
    if "people" in e:
        if not isinstance(e["people"], list):
            out.append(f"items.{aid}.people is a list ([] is nobody)")
        else:
            for k, p in enumerate(e["people"]):
                out += person_problems(p, f"items.{aid}.people[{k}]")
    return out


def problems(man) -> list[str]:
    """Why the manifest cannot be read, one line each ([] when it can)."""
    if not isinstance(man, dict):
        return ["vision.json is an object"]
    out = []
    if man.get("schema") != SCHEMA:
        out.append(f"vision.json schema is {SCHEMA!r}, not {man.get('schema')!r}")
    if not (isinstance(man.get("made_by"), str) and man["made_by"].strip()):
        out.append("vision.json names what made it (made_by)")
    items = man.get("items")
    if not isinstance(items, dict):
        out.append("vision.json items is an object keyed by ledger item id")
    else:
        for aid, e in items.items():
            out += entry_problems(aid, e)
    return out


def bodies_stated(item: dict):
    """The ledger's own bodies flag: ``shows_bodies``, else the older ``shows_violence_or_bodies`` (policy.bodies_value
    reads them in that order), or None when it states neither."""
    v = item.get("shows_bodies", item.get("shows_violence_or_bodies"))
    return v if isinstance(v, bool) else None


def overlay(item: dict, entry: dict, file_sha: str | None = None) -> tuple[dict, list[str]]:
    """The item with the manifest entry's fields under the ledger's (the ledger wins), and why the entry cannot be used
    for it (stale, or contradicting the ledger). ``file_sha`` is the sha256 of the file on disk: the entry is used only
    when the file, the ledger and the entry all name the same bytes. An unusable entry adds nothing."""
    why = []
    shas = {"file": file_sha, "ledger": item.get("sha256"), "vision.json": entry.get("sha256")}
    if file_sha is None or len(set(shas.values())) != 1:
        why.append(f"{item.get('id')}: the file, the ledger and vision.json do not name the same bytes ("
                   + ", ".join(f"{k} {str(v)[:12] if v else 'unread'}" for k, v in shas.items()) + "): see it again")
    led = bodies_stated(item)
    if led is not None and "shows_bodies" in entry and entry["shows_bodies"] != led:
        why.append(f"{item.get('id')}: vision.json says shows_bodies {entry['shows_bodies']}, the ledger "
                   f"{led}: one of them is wrong")
    if "marks" in entry:     # the frames must cover this item's aired span
        why += [f"{item.get('id')}: {p}" for p in review_problems(entry.get("reviewed"), "vision.json reviewed", item)
                if ".frames holds" in p or ".duration_s" in p]
    mc = item.get("marks_checked") if isinstance(item.get("marks_checked"), dict) else {}
    bad = list(dict.fromkeys(refused_marks(entry.get("marks"), item) + refused_marks(mc.get("marks"), item)))
    if bad:
        why.append(f"{item.get('id')}: its on-screen marks name a denied party or a call to action "
                   f"({'; '.join(bad)}): the picture is never used")
    if why:
        return item, why
    out = dict(item)
    if "shows_bodies" in entry and led is None:     # never beside the ledger's own (or legacy) flag
        out["shows_bodies"] = entry["shows_bodies"]
    if "people" in entry and "people" not in item:
        out["people"] = [dict(p) for p in entry["people"]]
    if "marks" in entry and "marks" not in item:
        out["marks"] = list(entry["marks"])
    return out, []


def apply(man, assets: dict, cited: dict[str, list[str] | str], read_sha=None) -> dict:
    """The manifest over the cited pictures. ``cited`` maps an asset id to every kind of shot that shows it (a still's
    needs and a clip's both apply). ``read_sha(item)`` is the sha256 of the item's file on disk (None when unread);
    without it no entry is used. Returns {assets (a new dict, overlaid), problems (blocking always: unreadable, stale,
    contradicting), pending ({asset id: [missing fields]}: pictures with no reading yet), used ([asset ids read from
    the manifest])}."""
    out = dict(assets)
    probs = problems(man) if man is not None else []
    entries = (man or {}).get("items") if not probs else {}
    pending, used = {}, []
    for aid, kinds in cited.items():
        kinds = [kinds] if isinstance(kinds, str) else list(kinds)
        item = out.get(aid)
        kinds = [k for k in kinds if needs(item, k)]
        if not kinds:
            continue
        e = (entries or {}).get(aid)
        mc = item.get("marks_checked") if isinstance(item.get("marks_checked"), dict) else {}
        bad = refused_marks(mc.get("marks"), item)
        if e is None and bad:
            probs.append(f"{aid}: its on-screen marks name a denied party or a call to action ({'; '.join(bad)}):"
                         " the picture is never used")
        if e is not None:
            new, why = overlay(item, e, read_sha(item) if read_sha is not None else None)
            if why:
                probs += why
            else:
                out[aid] = new
                used.append(aid)
        miss = list(dict.fromkeys(f for k in kinds for f in missing_fields(out[aid], k)))
        if miss:
            pending[aid] = miss
    return {"assets": out, "problems": probs, "pending": pending, "used": used}
