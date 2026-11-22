# Net-new in omnibus (show bible v2, ticket 2).
"""``shape-from-rundown``: a lead or package part's ``shape`` is the shape the rundown gave its story.

The rundown (``omnibus.rundown/2``, written by ``scripts/normalise-rundown.mjs``) sets each story's shape by the
footage cap (bible l): ``full`` with at least 30 s of cleared moving picture, else ``document``. The screenplay
may not change it: a part that plays a full package for a story the cap made a document package airs pictures
the ledger never cleared, and the reverse hides cleared footage the rank is owed.

A part names its story by its place in the spine: the ``lead`` part is the rundown's ``lead`` slot, and the k-th
``package`` part, in screenplay order, is ``package_{k+1}``. A part with no ``shape`` reads as ``full``, as the
schema's card rule reads it (studio/news/schema.py). A v2 screenplay with lead or package parts and no rundown/2
blocks. Two cases are left to the rule that owns them: a shape that is not one (``part-shape``) and a second lead
(``segment-spine``). The frozen issue 33 (v1 spine, rundown/1) is not checked. Pure: the rundown comes from the
inputs ``lints.load_inputs`` reads.
"""

from __future__ import annotations

from studio.news import schema as SC

RULE = "shape-from-rundown"
RUNDOWN_V2 = "omnibus.rundown/2"
GRAMMAR = "show bible l"
SHAPED = ("lead", "package")


def _check(ok, *, unit, evidence) -> dict:
    return {"rule": RULE, "ok": bool(ok), "unit": unit, "severity": "block", "evidence": evidence, "grammar": GRAMMAR}


def slots(play: dict) -> list[tuple[dict, str]]:
    """Each lead or package part with the rundown slot it plays, in screenplay order (one lead: shape_checks refuses
    to guess slots when there are two, which segment-spine blocks)."""
    out, k, lead = [], 0, False
    for p in play.get("parts") or []:
        seg = p.get("segment") if isinstance(p, dict) else None
        if seg == "lead" and not lead:
            lead = True
            out.append((p, "lead"))
        elif seg == "package":
            k += 1
            out.append((p, f"package_{k + 1}"))
    return out


def shape_checks(play: dict, inputs: dict) -> list[dict]:
    if SC.spine(play) is SC.V1:
        return []                                  # issue 33, frozen: its rundown/1 has no shapes
    if sum(1 for p in play.get("parts") or [] if isinstance(p, dict) and p.get("segment") == "lead") > 1:
        return []                                  # two leads: no part's slot is known, and segment-spine blocks it
    parts = slots(play)
    rundown = (inputs or {}).get("rundown")
    if not isinstance(rundown, dict) or rundown.get("schema") != RUNDOWN_V2:
        # A v2 screenplay's shapes come only from a rundown/2: without one there is nothing to check them against,
        # so a shaped part blocks (never a silent pass).
        if not parts:
            return []
        return [_check(False, unit="news.rundown", evidence={
            "schema": rundown.get("schema") if isinstance(rundown, dict) else None,
            "why": f"the screenplay has lead or package parts but its rundown is not {RUNDOWN_V2}",
            "fix": "news.rundown names the episode's rundown.json, written by scripts/normalise-rundown.mjs"})]
    by_slot = {s.get("slot"): s for s in rundown.get("stories") or [] if isinstance(s, dict)}
    out = []
    for part, slot in parts:
        shape = part.get("shape", "full")
        if shape not in SC.PART_SHAPES:
            continue                               # not a shape at all: part-shape blocks it, by its own rule
        story = by_slot.get(slot)
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
