# 2026-11-21: T2: shape-from-rundown, the ticket 1 cross-check

Ticket 1 let a lead or package part state its `shape`, and left the cross-check to ticket 2. `studio/news/rundown_shape.py` adds it as the rule `shape-from-rundown` (blocking), checked against `omnibus.rundown/2`.

How a part is matched and checked:

- The `lead` part plays the rundown's `lead` slot.
- The k-th `package` part, in screenplay order, plays `package_{k+1}`.
- The part's shape must equal its story's shape. An absent shape reads as `full`, the way the schema's card rule reads it.
- A shaped part with no story in its slot blocks.
- A v1 rundown (issue 33, frozen) is not checked.

The rule runs in `checks()` in `studio/news/lints.py`. It joins `RULES`, with a pass case and a fail case in the v2 lint fixture, once ticket 1's fixture is on main.
