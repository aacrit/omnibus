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
          "reviewed": {"by": "<who confirmed it>", "at": "<ISO date-time>"}
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
- ``reviewed`` is optional: who confirmed the machine's reading.

The ledger wins: a field the rights ledger states is never replaced, and a manifest entry that contradicts it
(``shows_bodies``) is refused, since one of them is wrong. A picture that needs vision data is a ledger item shown as
an archive still or clip and not made by the studio (no ``generator``, ``synthetic`` or ``test_fixture``): a drawn
graphic or typeset page states its own content.

In ``--draft`` (and a check render) a picture with no vision data is a warning and is planned as the engine plans an
unmeasured still (people unknown, A41's default); a final render refuses it (``vision-manifest``).
"""

from __future__ import annotations

import re
from pathlib import Path

SCHEMA = "omnibus-vision/1"
PATH = Path("vision.json")
PICTURE_KINDS = ("archive_still", "archive_video")
PEOPLE_KINDS = ("person", "face")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ENTRY_KEYS = {"sha256", "shows_bodies", "people", "reviewed"}


def studio_made(item: dict) -> bool:
    return bool(item.get("generator") or item.get("synthetic") or item.get("test_fixture"))


def needs(item: dict | None, shot_kind: str) -> bool:
    """Whether a picture the screenplay shows as ``shot_kind`` needs the vision pass's reading."""
    return bool(item) and shot_kind in PICTURE_KINDS and not studio_made(item)


def missing_fields(item: dict, shot_kind: str) -> list[str]:
    """The fields the item still lacks after the manifest: ``shows_bodies`` for any picture, ``people`` for a still."""
    out = []
    if not isinstance(item.get("shows_bodies"), bool) and not isinstance(item.get("shows_violence_or_bodies"), bool):
        out.append("shows_bodies")
    if shot_kind == "archive_still" and "people" not in item:
        out.append("people")
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


def overlay(item: dict, entry: dict) -> tuple[dict, list[str]]:
    """The item with the manifest entry's fields under the ledger's (the ledger wins), and why the entry cannot be used
    for it (stale, or contradicting the ledger). An unusable entry adds nothing."""
    why = []
    if entry.get("sha256") != item.get("sha256"):
        why.append(f"{item.get('id')}: vision.json saw sha256 {str(entry.get('sha256'))[:12]}..., the ledger's file is "
                   f"{str(item.get('sha256'))[:12]}...: see it again")
    if isinstance(item.get("shows_bodies"), bool) and "shows_bodies" in entry and entry["shows_bodies"] != item["shows_bodies"]:
        why.append(f"{item.get('id')}: vision.json says shows_bodies {entry['shows_bodies']}, the ledger "
                   f"{item['shows_bodies']}: one of them is wrong")
    if why:
        return item, why
    out = dict(item)
    if "shows_bodies" in entry and not isinstance(item.get("shows_bodies"), bool):
        out["shows_bodies"] = entry["shows_bodies"]
    if "people" in entry and "people" not in item:
        out["people"] = [dict(p) for p in entry["people"]]
    return out, []


def apply(man, assets: dict, cited: dict[str, str]) -> dict:
    """The manifest over the cited pictures. ``cited`` maps an asset id to the kind of the first shot showing it.
    Returns {assets (a new dict, overlaid), problems (blocking always: unreadable, stale, contradicting), pending
    ({asset id: [missing fields]}: pictures with no reading yet), used ([asset ids read from the manifest])}."""
    out = dict(assets)
    probs = problems(man) if man is not None else []
    entries = (man or {}).get("items") if not probs else {}
    pending, used = {}, []
    for aid, kind in cited.items():
        item = out.get(aid)
        if not needs(item, kind):
            continue
        e = (entries or {}).get(aid)
        if e is not None:
            new, why = overlay(item, e)
            if why:
                probs += why
            else:
                out[aid] = new
                used.append(aid)
        miss = missing_fields(out[aid], kind)
        if miss:
            pending[aid] = miss
    return {"assets": out, "problems": probs, "pending": pending, "used": used}
