# 2026-11-21: T2: shape-from-rundown, the ticket 1 cross-check

Ticket 1 let a lead or package part state its `shape`, and left the cross-check to ticket 2. `studio/news/rundown_shape.py` adds it as the rule `shape-from-rundown` (blocking, in `RULES`), checked against `omnibus.rundown/2`.

How a part is matched and checked:

- The `lead` part plays the rundown's `lead` slot.
- The k-th `package` part, in screenplay order, plays `package_{k+1}`.
- The part's shape must equal its story's shape. An absent shape reads as `full`, the way the schema's card rule reads it.
- A shaped part with no story in its slot blocks.
- A v2 screenplay with lead or package parts whose rundown is missing or is not `omnibus.rundown/2` blocks. There is nothing to check its shapes against, and a silent pass would let any shape air.

What it leaves to the rule that already blocks, so that one fault is reported once:

- A part whose `shape` is not `full` or `document`: `part-shape` blocks it.
- A screenplay with two lead parts: `segment-spine` blocks it, and no part's slot can be known.
- The frozen issue 33 (v1 spine, rundown/1, no shapes) is not checked.

The v2 lint fixture (`studio/tests/fixture_news/episode_v2.py`) carries a pass case and four fail cases: a full part for a document story, a document part for a full story, a package part with no rundown story, and a v2 screenplay over a rundown/1. Its "quote card in a full package" case now changes the rundown story too, so only `card-kind` speaks; its "five packages" advisory case adds the rundown stories for packages 5 and 6.
