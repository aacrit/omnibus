# 2026-11-22: T9c: issue 35's clock, slates, credits, end board and title drawn by the v1 typesetters (builder, CoS go-ahead)

`render_episode` now draws the v1 subtypes that a v2 screenplay still names. Each one uses week 33's own typesetting, measures and motion. Only the inputs are v2:

- **Clock.** Dial and second hand composited into one layer. It sweeps to the Monday 21:00 UTC after the edition's cutoff, recorded as nominal (clock-true stays the release's lint), unless `--release` is given.
- **Lower third.** The `slate` and `echo-slate` variants: the shot's one `PLACE · DATE` line with no speaker. The dot shows the shot's `dot_label`, or `DRAWN`. A speaker lower third still raises.
- **Credits.** The shot's own `roll`, plus every rights-ledger `disclosure` the roll lacks.
- **End board.** The screenplay's issue and year.
- **Title.** `title_spec(screenplay, rundown/2) -> (shot, TitleMacroSpec)` is the one seam ticket 7's recompositor replaces. Every story line must be its rundown story's rank, place and slug, or it refuses to draw. The macro is the v1 typed paper at 74.3 cps over the shot's length. The screenplay plays it as week 33 did, a muted clip of the drawn macro (`kind: archive_video`), because a drawn still cannot carry the teleprinter.

`page` and `count` are not drawn and raise `NotImplementedError` before any browser opens. Issue 35 names nine pages. Five could be set from their read lines verbatim. The two communique pages (S-EC-2, S-EC-3) have no verbatim text in the repo, only narration over them, and the signatures page has only names. Typesetting the narrator's words as the document would be false. So the pages wait for their source text (a writer or sourcing ticket) and a page renderer.

A graphic is ledgered by its shot's `asset`, the plan item the screenplay cites. One that two shots share is drawn once. It carries the plan's `content_date` and `content_basis` for A0. `render_week33` is untouched, and a test pins its source sha256. On Actions, the render job points its own checkout at the drawn ledger (`python -m studio.news.graphics_ledger use-drawn`, `e6-graphics`). A check slice draws every graphic too, because the render plans and lints the whole film (a slice-only ledger left later shots uncited, run 44982815573). `render --until` and `verify compare --slice` stay for local previews. `episodes/35/graphics-ledger.json` is seeded `[]`. The first run's ledger replaces it, the T4 pattern.
