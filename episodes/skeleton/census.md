# Census: does the transplanted engine refuse a news shape? (E2a)

`screenplay.json` in this folder is a 60 s omnibus-shaped skeleton built only from kinds the transplanted engine
(`studio/engine/*`, docs/TRANSPLANT-document-engine.md) already knows: a cold open still, a card standing in for
a test card, a card for a board, a lower-third-like card, a still tour, and a closing question, across five
chapter parts (The Week / The Weight / The Echo / The Margins / The Question) plus a title part and a credits
part. The method: run the engine's own lints (`studio.engine.render.build_plan`) and the real `--draft` CLI
against it, read the exact refusal, then cite the line it lives on. Media for the run lives on
`D:/omnibus-media/skeleton/` and is never committed; `screenplay.json`, the two ledgers and this file are the
only tracked output.

No code in `studio/engine/*` changed to produce this census (per the ticket). Where a fix is listed, it is a
change for a later ticket (E3+), not this one.

## Top finding: the title card's wordmark is hard-coded to "void document"

`episodes/skeleton/screenplay.json`'s own title card (`S1`, part `p-title`) declares `text: ["void omnibus",
"skeleton"]`. The real `--draft` CLI run against it refuses before drawing a single frame:

```
render: refused: lint failed: card-drawn (S1): {'card': 'title', 'missing': [{'index': 1, 'intended': 'skeleton',
'drawn': 'void document'}], 'fix': 'every element of text[] must be drawn; this card kind draws only what its
form allows (GRAMMAR 9)'}
```

Why: `studio/engine/motion.py`'s `draw_wordmark()` (lines 2109-2113) draws the two literal strings `"void"` and
`"document"` under the title, and `title_card_layout()` (lines 2116-2130) always appends a second line
`{"role": "wordmark", "text": "void document"}`, regardless of what the screenplay's title-card shot declares.
The lint that catches the mismatch is `card-drawn` (`render.py:938-950`, `card_text_check` at `render.py:872`),
which checks every element of a card's `text[]` was actually drawn. The series lockup card carries the same
lock-in a line further on: `motion.py:2170` hard-codes `words = [("void", f_v), ("document", f_d), ("\u00b7",
f_d), ("As It Was", f_i)]` for the tagline under the lockup.

**What omnibus needs:** the `title`/lockup card drawing in `motion.py` takes the wordmark and tagline as
parameters (or reads them from the screenplay/a show profile) instead of the two literal strings. Until that
lands, an omnibus episode's title part cannot use the `title` card kind with its own name; it would have to
either literally show "void document" (wrong brand) or use a plain `card` shot instead (which this skeleton's
other cards already do, successfully, for the test-card and board stand-ins).

**Confirmed to be the only blocker for this shape:** patching just that one shot's declared text to
`["void omnibus: skeleton", "void document"]` (a probe only; not committed, since it would print the wrong
brand) lets `--draft` render the whole 60 s skeleton end to end: `render: 1440 frames, 60.00 s of film in
12.13 s -> out-probe/master.mp4`, with `sources.json`, `description.txt` and `description.attribution.json` all
written, `"draft": true` recorded. No other house rule in this list refused the shape once the wordmark lint was
satisfied.

## Every house rule checked

| Rule | Where it lives | Refuses omnibus's skeleton? | What omnibus needs |
|---|---|---|---|
| **A44 (frame rate)** | `cadence.py:33-47` (`parse_rate`, `RateError`); `render.py:105` (`FPS = 24`) | **Yes.** `settings.master_fps: 30` (the plain "30 fps" the plan called for) is refused outright: `RateError: master_fps must be 24 or 30000/1001, not '30'`. Only `24` or `30000/1001` (alias `"29.97"`) parse. | Either master at `24` (what this skeleton does) or `30000/1001`; "30 fps" as such does not exist in the engine and would need a code change to `cadence.py` to add. |
| **Card wordmark / lockup tagline** | `motion.py:2109-2130`, `:2170`; lint `card-drawn`, `render.py:938-950` | **Yes** (see above), for the `title`-kind card specifically. A plain `card` shot (used for the test-card and board stand-ins in this skeleton) has no such lock-in and rendered cleanly. | A per-film or per-show wordmark/tagline parameter in `motion.py`, or a net-new omnibus title treatment in `studio/news/` that never calls `title_card_layout`/`draw_wordmark`. |
| **Fonts (`node_modules/@fontsource/*`)** | `motion.py:68-81` (`_FONTSOURCE`, hard-coded relative paths) | **Was refusing** until fixed in this PR: every card draw raised `OSError: cannot open resource` because omnibus's own `package.json` lists Playfair Display/IBM Plex Mono/Barlow Condensed (its site faces), not Fraunces/Inter/JetBrains Mono (the engine's hard-coded faces). Added `@fontsource/fraunces` and `@fontsource/jetbrains-mono` as devDependencies (`@fontsource/inter` was already present) so the unchanged engine code finds its files; see `docs/TRANSPLANT-document-engine.md`. | Nothing further for this ticket; a later ticket could make the engine's type faces configurable so the card typesetting could use omnibus's own voices instead of document's, but that is a `motion.py` change, out of scope here. |
| **A41/A7 (still tour, cold open)** | `tour.py` (A41 camera paths); `render.py:112-116` (`OPEN_S`, `A7_*` pixel checks) | **No.** The cold open (`S3`, `FX-STILL-B`, `HOLD`, declared `fill_exception`) and the still tour (`S6`, `FX-STILL-A`, `DRIFT`, `fill_ok: true`) both passed plan-time and drew in the probe render; the A7 whole-picture-first check and A41's tour-inside-the-fill rule are about *how* a still is shown, and this skeleton's two stills (sized the same as the engine's own fixture) satisfy them. | Nothing; real stills at these sizes would need the same `fill_ok`/`fill_exception` honesty the fixture already models. |
| **A6/A44 (clip conform)** | `render.py:2430` (`A6: how a clip reaches the film's master rate`) | **No.** `FX-TESTSRC` (30000/1001, 4 s) under a 24 fps master conformed and drew without refusal in the probe render. | Nothing for a clip this short; a longer or telecined source would exercise more of `clips.py`, not tested here. |
| **A29 (score standard, cue kind/role)** | `score.py:87-103` (`ROLES`, `MUSIC_ROLES`, `CUE_KINDS = ("music", "ambience")`); lints `cue-kind`/`score-role`, `render.py:3558-3562` | **No**, for this skeleton's one `ambience` cue (`C1`, no `role` stated, which defaults to the always-valid "underscore"). `ambience` is one of exactly two valid cue kinds, so this particular cue cannot trip `cue-kind`; `C1`'s source file is missing on purpose (it is a warning, not a block, the same as the engine's own fixture's `C1`). **Would refuse** for an invalid `kind` (anything but `music`/`ambience`) or a `role` outside `score.py`'s closed lists. | Nothing for this skeleton; an omnibus show profile adding its own cue roles (bed/sting/etc. beyond the house list) would need `score.py`'s `ROLES`/`MUSIC_ROLES` extended, a later-ticket change. |
| **A40 (series title slot)** | `titles.py:36` (`KIND = "title_sequence"`); `:234-236` (`HOUSE_SLOT_FPS = 24`, `HOUSE_SLOT_FRAMES = 683`, 28.4583 s); `test_title_slot_length.py` docstring | **Not triggered** (this skeleton has no `title_sequence` item: the ticket's six elements are a title *card*, not the series-titles graphic, so none was added). **Would refuse by arithmetic, not by a raised exception**: the one house default slot length is 28.4583 s at 24 fps, almost half of this episode's entire 60 s runtime, authored for a long-form film's cold open. | A short, omnibus-scaled title_sequence (its own authored frame count, since A44's slot length is "data-driven... never a new fixed constant", `titles.py:228-232`) is net-new work for a later ticket, not a tweak to `HOUSE_SLOT_FRAMES`. |
| **Loudness (TARGET_LUFS)** | `render.py:117`: `TARGET_LUFS, TARGET_TP = -18.0, -1.5` | **Not exercised to the sample** in a `--draft` run (a draft accepts dynamic/unmeasured loudness, `render.py:8371` and nearby). The plan the planner wrote (`reports/briefs/omnibus-engine-plan.md`) states omnibus needs -16 LUFS from a show profile; that is a `render.py` constant change, explicitly out of scope for this unchanged-transplant ticket. | A show-profile loudness target (`-16` for omnibus) is the E3+ tweak named in the architecture plan; `render.py:117` stays `-18.0` here. |
| **Voiceless/readings floors (GRAMMAR 6.1, A17/A18)** | `render.py:186-192` (`VOICELESS_FLOOR`, `READINGS_FLOOR`); `:204` (`EVENT_FILM_MIN_S = 600.0`) | **Not binding.** These floors apply only when "both the film and its runtime target are under 10 min" are *not* the case; a 60 s film with a 60 s target is under 10 min on both counts, so (like the engine's own 25 s test fixture) the floors are journaled as warnings only, never blocking. | Nothing; this is the same exemption document's own short fixture relies on. |
| **Parts count** | checked `rulebook.py`, `render.py`, `policy.py` for a minimum/maximum part count | **No rule found.** Nothing in the transplanted engine enforces a number of chapter parts; `reports/briefs/omnibus-engine-plan.md`'s "parts 4 to 6" reads as an editorial expectation (GRAMMAR.md, not lifted here), not a lint. This skeleton's 5 chapters plus a title and a credits part (7 total) built and rendered without any part-count complaint. | Nothing for the engine; if a part-count rule is wanted, it would be net-new, not a tweak. |
| **Engine-private keys (`_` prefix)** | `render.py:2914-2927` | **No.** None of this skeleton's own fields collide; noted because it is the same lint family as the others above and was exercised incidentally. | Nothing. |

## One more, found by the lifted suite rather than this skeleton (now fixed)

`studio/engine/maps.py`'s palette reads several design tokens beyond the seven base Ink & Momentum ones
(`--color-letterbox`, `--mark-text`, `--mark-generated`, `--color-generated-text`, `--scrim-strong`,
`--color-border`, `--color-cream-faint`): document's own extension for its archival-footage mark system, not
exercised by this skeleton (it never calls `maps.render_map`) but the reason the lifted suite's own tests first
failed on CI (PR omnibus#10). Fixed by carrying document's `design/tokens.css` and `design/brand-kit/*`
unchanged into `studio/house/document/`, read through one constant; omnibus's own `design/tokens.css` is
untouched (`docs/TRANSPLANT-document-engine.md`, `docs/DECISIONS.md` 2026-11-12). Listed here because it is the
same shape of finding as the wordmark above: a hard-coded dependency on document's own design values, not a
content-shape refusal.

## How this was run

1. `episodes/skeleton/screenplay.json` plus its two ledgers (`stills-ledger.json`, `footage-ledger.json`) are
   tracked here. The two still images (`FX-STILL-A`, `FX-STILL-B`, the engine's own fixture sizes) and the one
   clip (`FX-TESTSRC`) were generated with `studio/tests/fixture/make_media.py`'s own functions into
   `D:/omnibus-media/skeleton/work/` (never git).
2. `studio.engine.render.build_plan(...)` (no frames drawn) was run first, with `settings.master_fps` set to
   `30` (A44 refusal above), then to `24` (the committed value): plan-time lints pass once the wordmark text is
   satisfied.
3. The real CLI, `python -m studio.engine.render D:/omnibus-media/skeleton/work --out <out> --draft --workers
   2`, was run against the committed screenplay (refuses immediately, no frames, no HEAVY.lock needed) and
   against a probe copy with only the title card's text changed (renders in full under
   `loom.core.lock.HeavyLock`, released on exit).
4. `npm run gate`'s new `studio-test` step (`pytest studio/tests -q`) is the lifted suite's own acceptance; its
   result is reported separately in this ticket's evidence block.
