# 2026-11-22: T9c: a v2 page is a primary document typeset verbatim, or it is refused (builder, CoS go-ahead)

`page` joins `V2_RENDERERS`. A page shot names its document as `page: {source_id, title: [...], body: [...], source}`. The body is the record's own words, one paragraph per string, with `[…]` marking a cut. `source_id` names the record they are set from, and `source` is the source line. The shot's `dot_label`, when it is a `RELEASED BY ...` label, is set over the sheet as the party label. A page with no body, source id or source line is refused (`data.page_spec`): nothing is ever typeset from the narrator's words or from a guess.

The look uses the house tokens and faces:

- The sheet is `--o-paper` and `--o-ink` on the walnut field, or on `--o-echo-field` for an Echo page (`register: umber`).
- Head lines are set in Barlow caps, the body in Playfair with tabular figures, and the source line in Inter.
- It reuses the shared `_head`, the stylesheet injection and the bias-token check.

The body steps down from 40 px to 26 px until the sheet holds it, and every paragraph is read back from the page and held to the record's words. A passage that never fits is refused, with the fix named: cut it with a marked cut in the screenplay. The page is held for the shot's length, and the engine's tour moves over it. `count` is still not drawn and still raises.

Supersedes the line of the same day's graphics decision that left pages waiting on a page renderer.
