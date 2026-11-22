# 2026-11-22: T9b: narration-ceiling binds the frozen issue 33 only; v2 gets narration-share

Bible v2 section o changes `narration-ceiling` into `narration-share` (advise at 62%) and `sot-share` (advise at 8% or more), measured on the mix. Section j says the old ceiling was written for a film. The engine already dropped its own ceiling (A17, `render.sound_lints`). But `studio/news/lints.py` still blocked every screenplay at 55% of the runtime voiced, counting quotations. No v2 news programme can meet that. Issue 35's draft measured 84%.

The change is minimal. Issue 33, read through the v1 spine, keeps `narration-ceiling` exactly as it was. A v2 screenplay gets `narration-share` instead. It counts the narrator's own lines (vo, signon, signoff), is estimated from the lines' timing and is a warning, never a block. `sot-share` is declared in `DEFERRED` to the mix (ticket 3), because the bible measures it on the sot bus. One test covers both spines, and the pass fixture's expectations exclude the v1-only rule for v2.

Ticket 6 owns the full text-lint table. This settles only the rule that blocked a v2 screenplay against the approved bible.
