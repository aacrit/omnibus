# Net-new in omnibus (show bible v2, ticket 2).
"""``shape-from-rundown``: a lead or package part's ``shape`` is the shape the rundown gave its story.

The rundown (``omnibus.rundown/2``, written by ``scripts/normalise-rundown.mjs``) sets each story's shape by the
footage cap (bible l): ``full`` with at least 30 s of cleared moving picture, else ``document``. The screenplay
may not change it: a part that plays a full package for a story the cap made a document package airs pictures
the ledger never cleared, and the reverse hides cleared footage the rank is owed.

A part names its story by its place in the spine: the ``lead`` part is the rundown's ``lead`` slot, and the k-th
``package`` part, in screenplay order, is ``package_{k+1}``. A part with no ``shape`` reads as ``full``, as the
schema's card rule reads it (studio/news/schema.py). A v1 rundown (issue 33, frozen) has no shapes and is not
checked. Pure: the rundown comes from the inputs ``lints.load_inputs`` reads.
"""

from __future__ import annotations

RULE = "shape-from-rundown"
RUNDOWN_V2 = "omnibus.rundown/2"
GRAMMAR = "show bible l"
SHAPED = ("lead", "package")


def _check(ok, *, unit, evidence) -> dict:
    return {"rule": RULE, "ok": bool(ok), "unit": unit, "severity": "block", "evidence": evidence, "grammar": GRAMMAR}


def slots(play: dict) -> list[tuple[dict, str]]:
    """Each lead or package part with the rundown slot it plays, in screenplay order."""
    out, k = [], 0
    for p in play.get("parts") or []:
        seg = p.get("segment") if isinstance(p, dict) else None
        if seg == "lead":
            out.append((p, "lead"))
        elif seg == "package":
            k += 1
            out.append((p, f"package_{k + 1}"))
    return out


def shape_checks(play: dict, inputs: dict) -> list[dict]:
    rundown = (inputs or {}).get("rundown")
    if not isinstance(rundown, dict) or rundown.get("schema") != RUNDOWN_V2:
        return []
    by_slot = {s.get("slot"): s for s in rundown.get("stories") or [] if isinstance(s, dict)}
    out = []
    for part, slot in slots(play):
        story = by_slot.get(slot)
        shape = part.get("shape", "full")
        unit = f"part {part.get('id')}"
        if story is None:
            out.append(_check(False, unit=unit, evidence={
                "slot": slot, "shape": shape,
                "why": f"the rundown has no story in slot {slot}",
                "fix": "the screenplay runs one lead and one package part per package slot the rundown fills, in rank order"}))
            continue
        ok = story.get("shape") == shape
        ev = {"slot": slot, "story": story.get("key"), "shape": shape, "rundown_shape": story.get("shape"),
              "footage_cleared_s": story.get("footage_cleared_s")}
        if not ok:
            ev["fix"] = (f"the part's shape is the rundown's ({story.get('shape')}): the footage cap sets it from "
                         f"the rights ledger (scripts/normalise-rundown.mjs); change the ledger, not the part")
        out.append(_check(ok, unit=unit, evidence=ev))
    if not out:
        out.append(_check(True, unit="news.rundown", evidence={"checked": 0}))
    return out
