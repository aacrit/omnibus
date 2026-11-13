# Transplant: void document's render engine (E2)

Source: `aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193` (read with `git archive`/`git show`; the local
`C:/Users/aacri/claudeprojects/document` checkout was fetched first and never modified). Target: void omnibus,
`studio/`. The engine is transplanted **unchanged**: no tweak to any lifted module in this PR (that includes
`description.py` and `TARGET_LUFS`, both named as future tweaks in `reports/briefs/omnibus-engine-plan.md`; they
stay at document's own values here, and the gap each leaves for an omnibus show is in
`episodes/skeleton/census.md`). Every lifted `.py` file carries a provenance header,
`# Transplanted from document@b62c4fa:<path> (lift)`; the two files tweaked for a left-behind dependency say so
instead. JSON and other non-commentable files carry their provenance only in this table.

## studio/engine/* (31 modules, unchanged)

| Source path | Disposition | Why | Target path |
|---|---|---|---|
| `studio/engine/__init__.py` | lift | Empty; makes `studio.engine` a package. | same |
| `studio/engine/aswas.py` | **tweak (E3)** | A0 show-as-was text and date rules. A `graphic` shot's ledger item is dated like the series titles' master (one kind added to one tuple). | same |
| `studio/engine/bracket.py` | lift | Fill-detail and crop bracketing. | same |
| `studio/engine/cadence.py` | **tweak (E3)** | A44 master frame rate per film. `parse_rate`, `native_master`, `majority`, `resolve` take `masters` (default document's 24 and 30000/1001, wording unchanged); `BROADCAST` 30/1 added, allowed only by a show profile that lists it (omnibus). | same |
| `studio/engine/captions.py` | lift | Subtitle fill and burn-in. | same |
| `studio/engine/clips.py` | lift | A44 clip conform (frame drop/repeat), source frame tolerances. | same |
| `studio/engine/counts.py` | lift | Card numeral checks. | same |
| `studio/engine/description.py` | **tweak (E3)** | A56 description block; reads `web/src/cc-licences.json` (see below). The sources and corrections links and the CARD legend's brand come from sources.json's `show` record when present (omnibus: `/e/<issue>/sources`, `/e/<issue>/correct`); `void omnibus` counts as the studio's own name. Without a show record, byte-identical output. | same |
| `studio/engine/disclosure.py` | lift | A56 per-film disclosure text. | same |
| `studio/engine/georef.py` | lift | Map georeferencing helpers. | same |
| `studio/engine/journal.py` | lift | `Journal`, `sha256_file`: the run's own audit log. | same |
| `studio/engine/kokoro_worker.py` | lift | Runs under a separate Kokoro venv (`studio/requirements-tts.txt`, left behind, a later ticket); the module itself imports cleanly and is kept so the module name is stable when that ticket lands. | same |
| `studio/engine/layers.py` | lift | `--layers` compositing. | same |
| `studio/engine/levels.py` | lift | Loudness measurement and gain. | same |
| `studio/engine/maps.py` | **tweak** | Natural Earth maps (named by `reports/briefs/omnibus-engine-plan.md` as the E6 graphics source). `TOKENS` now reads `studio/house/document/tokens.css` via `studio/engine/house.HOUSE_ROOT` instead of `design/tokens.css` directly (one line; see below). Everything else unchanged. | same |
| `studio/engine/motion.py` | **tweak (E3)** | Every graphic draw (cards, lockup, marks). The title card's wordmark and the lockup's words are parameters (`WORDMARK`, `LOCKUP_BRAND` defaults are document's). | same |
| `studio/engine/moves.py` | lift | Camera move primitives. | same |
| `studio/engine/narrator.py` | lift | Kokoro voice/lock lookups; reads `studio/kokoro.lock.json`. | same |
| `studio/engine/overlays.py` | lift | Lower thirds and overlay text. | same |
| `studio/engine/pages.py` | lift | Screenplay page helpers. | same |
| `studio/engine/policy.py` | **tweak (E3)** | Per-film settings, imagery rule, shortfall statements. `settings.master_fps` is parsed against the show's masters. | same |
| `studio/engine/publish.py` | **leave behind** | Web encode and poster packet; no web publish surface exists yet for omnibus episodes (the charter's own Episode/Sources pages are net-new, not this). Its tests (`test_publish.py`, and the one case in `test_films.py` that calls it) leave with it. | none |
| `studio/engine/render.py` | **tweak (E3)** | The render engine itself. See the E3 section below. | same |
| `studio/engine/rulebook.py` | lift | A45/A52 subject and caption rules for stills. | same |
| `studio/engine/score.py` | lift | A29 score standard, cue kinds and roles. | same |
| `studio/engine/sheets.py` | lift | Contact-sheet helpers for the camera. | same |
| `studio/engine/titles.py` | lift | A40 series title slot (`HOUSE_SLOT_FRAMES = 683` at line 235, census item). | same |
| `studio/engine/tour.py` | lift | A41 still-tour camera paths. | same |
| `studio/engine/tourlint.py` | lift | Tour-path lints. | same |
| `studio/engine/viewxf.py` | lift | View transform helpers. | same |
| `studio/engine/vision.py` | lift | Vision-model measurements; reads `studio/vision-models.json`, needs model weights outside git (E10, not this ticket). | same |
| `studio/engine/voicing.py` | lift | Reader EQ; reads `studio/reader-eq.json`. | same |

`studio/engine/sketch.py` is not in this list: it lives at `studio/sketch.py` (one level up), not inside
`studio/engine/`, and is left behind below with the same reasoning as `publish.py` (no web packet to sketch for
yet).

## studio/tests/* (lifted, two exceptions)

| Source path | Disposition | Why | Target path |
|---|---|---|---|
| `studio/tests/conftest.py` | lift | Session fixtures (`film`, `film_safe`, `rendered`, `plan`); its own per-worktree temp-root pruning (ENGINE-LOG 2026-10-11) comes unchanged. | same |
| `studio/tests/fixture/*` (screenplay, ledgers, `make_media.py`, `maps/`) | lift | The smallest fixture film: 25 s target, synthetic media made at test time, nothing archival, nothing committed (R-08). Reused for E2's draft-render acceptance. | same |
| `studio/tests/test_*.py` (54 files) | lift | Every test except the two below. | same |
| `studio/tests/test_publish.py` | **leave behind** | Entirely about `studio/engine/publish.py`, left behind above. | none |
| `studio/tests/test_films.py` | **tweak** | One case, `test_e3_the_poster_reads_the_films_rule`, calls `publish.poster_record`/`poster_rule`; removed along with the now-unused `from studio.engine import publish as P` import. Every other case (A21 imagery rule, A25 settings/shortfalls, A26 archival-soundtrack spans) is unchanged. | same |
| `studio/tests/test_placeholder_media.py` | **tweak** | One case, `test_publish_refuses_a_placeholder_poster`, imports `publish` locally; removed. Every other placeholder-media case (GRAMMAR 11.1) is unchanged. | same |
| `studio/tests/test_narrator.py` | **tweak** | One case, `test_the_requirements_are_pinned_with_hashes`, reads `studio/requirements-tts.txt`, left behind; removed. Every other narrator case is unchanged. | same |
| `studio/tests/test_e15.py` | **tweak** | Four "kit" cases read `studio/house/document/brand-kit/*` via `HOUSE_ROOT` instead of `design/brand-kit/*` (above). Every other case is unchanged. | same |
| `studio/tests/test_render.py` | **tweak** | `test_brand_kit_reexports_the_engine_motion` reads `studio/house/document/brand-kit/motion.py` via `HOUSE_ROOT`. Every other case is unchanged. | same |
| `studio/tests/test_a40_title_sequence.py` | **tweak** | `test_a40_the_lockup_ink_is_the_house_ink_token` reads `studio/house/document/tokens.css` via `HOUSE_ROOT`. Every other case is unchanged. | same |
| `studio/tests/test_a41_tour.py` | **tweak** | One case, `test_the_js_tour_helper_agrees_with_the_engine`, cross-checks `tour.py` against `studio/tour.mjs`, left behind; removed. Every other case is unchanged. | same |
| `studio/tests/test_cine11_levels.py` | **tweak** | `test_the_copy_claims_exactly_what_the_map_does` no longer reads `web/src/film-data.ts` (document's own Sources page copy, no omnibus equivalent); the `LV.WHAT` claims check and the real black-floor math it shares the function with are unchanged. | same |
| `pytest.ini` (repo root) | lift | Found by running the suite: `test_temp_roots.py` reads it (`tmp_path_retention_policy`), and `conftest.py`'s own temp-root pruning assumes it. Not under `studio/`, so not named in the ticket. | `pytest.ini` |

## Support files the engine reads at import or run time

| Source path | Disposition | Why | Target path |
|---|---|---|---|
| `studio/__init__.py` | lift | Makes `studio` a package (needed for `studio.engine.*` imports to resolve). | same |
| `studio/show-as-was.json` | lift | `aswas.py`'s lexicon (`LEXICON_PATH`). | same |
| `studio/kokoro.lock.json` | lift | `narrator.py`'s model-file lock; read, not exercised without the Kokoro venv. | same |
| `studio/narrator-profile.json` | lift | `render.py`'s optional narrator-drift anchor. | same |
| `studio/reader-eq.json` | lift | `voicing.py`'s reader EQ table. | same |
| `studio/vision-models.json` | lift | `vision.py`'s model manifest; read, not exercised without model weights. | same |
| `web/src/cc-licences.json` | lift | Not named in the ticket; found by running the suite. `description.py` reads it at **import time** (`CC_TABLE`, module scope), so `studio.engine.render` cannot import without it. Omnibus had no file at this path; lifted unchanged. | `web/src/cc-licences.json` |
| `tests/fixtures/a0-cases.json` | lift | Same reason: `test_a0_show_as_was.py` reads it at import time, from the repo-root `tests/fixtures/`, not `studio/tests/fixture/`. | `tests/fixtures/a0-cases.json` |
| `studio/requirements-tts.txt` | leave behind | Kokoro-only venv, pinned with PyPI hashes; no narration ticket (E7) yet. A later ticket carries it over when it lands. | none |
| `studio/sketch.py` | leave behind | Paired with `publish.py`: sketches the web packet that module produces. | none |
| `studio/tour.mjs` | leave behind | The JS twin of `tour.py` for a web viewer that doesn't exist yet; `tour.py`'s own comments cite it only as a cross-check, never import it. | none |
| `studio/requirements-studio.txt` | net-new | Document's gate pins these same versions inline in `.github/workflows/gate.yml`; omnibus keeps them in a file so `npm run gate` and CI install from one place. | `studio/requirements-studio.txt` |
| `package.json` devDependencies `@fontsource/fraunces`, `@fontsource/jetbrains-mono` (5.3.0, `@fontsource/inter` was already present) | net-new (dependency, not a lifted module) | Found by running the suite, not named in the ticket: `motion.py` (lines 68-81) loads the engine's card and title typefaces by a hard-coded path into `node_modules/@fontsource/{fraunces,inter,jetbrains-mono}`, document's own three faces, regardless of what a product's own site uses. Without them every card-drawing test and the skeleton's own render failed with `OSError: cannot open resource`. omnibus's site already uses Playfair Display/IBM Plex Mono/Barlow Condensed (`design/tokens.css`); these three are additional, used only by the Python engine, never by `web/`. See `episodes/skeleton/census.md`. | `package.json` |
| `design/tokens.css` | lift, namespaced | Found on CI (PR omnibus#10): `maps.py`'s palette reads named custom properties beyond the base Ink & Momentum set (`--color-letterbox`, `--mark-text`, `--mark-generated`, `--color-generated-text`, `--scrim-strong`, `--color-border`, `--color-cream-faint`). Carried unchanged under `studio/house/document/`, read through one constant (`studio/engine/house.HOUSE_ROOT`), never merged into omnibus's own `design/tokens.css` (docs/DECISIONS.md, 2026-11-12). | `studio/house/document/tokens.css` |
| `design/brand-kit/{motion.py,watermark.svg,logomark.svg,watermark-youtube.svg,wordmark.svg}` | lift, namespaced (`motion.py` also tweaked: `parents[2]` to `parents[4]`, the new depth) | Same reason, found the same way: three tests (`test_e15.py`, `test_render.py`) load these files directly to check the engine's watermark/logomark/lockup against the authored brand-kit assets. `design/brand-kit/BRAND-KIT.md` and `preview.html` are not opened by any code or test (only cited in comments) and are not carried over. | `studio/house/document/brand-kit/*` |
| `studio/engine/house.py` | net-new | One constant, `HOUSE_ROOT`, so every lifted module or test that needs a document design file reads it from the same place. | `studio/engine/house.py` |
| `studio/tests/test_house_tokens_match_palette.py` | net-new | Guards against drift: `motion.py`'s hard-coded `PALETTE` tuples (bone, safelight, cold, ink, the derived `--mark-text`) are checked against `studio/house/document/tokens.css` via `maps.resolve()` (reviewer finding, PR omnibus#10). In the fast gate subset. | `studio/tests/test_house_tokens_match_palette.py` |

## Gate

`npm run gate`'s `studio-test` step runs a **fast subset** of the lifted suite (aswas, clips, pages,
disclosure, counts, maps, and a net-new palette-vs-tokens guard: 601 cases, measured 187s on CI for the 597 before the guard), chosen because it needs no real render or audio
measurement; render core, layers/stems, narrator and the titles/score audio checks are slow (`test_render.py`
alone: ~4 min locally) and run only in `.github/workflows/studio-full.yml` (every PR, but only executes when
`studio/**` changed; always on push to `main` and nightly). See `docs/DECISIONS.md` (2026-11-12) for the exact
split and the measurements behind it. No test is skipped: the seven files above were trimmed before the
transplant commit, per the transplant skill's rule 5, rather than carried in and marked `skip`.

**Resolved in this PR (was a gap in PR omnibus#10):** `studio/engine/maps.py`'s `palette()` and three tests
read document's own `design/tokens.css` and `design/brand-kit/*`, which were not in omnibus's repo. Fixed by
lifting those files unchanged into `studio/house/document/` (above), read through one constant
(`studio/engine/house.HOUSE_ROOT`); omnibus's own `design/tokens.css` is never touched. The full suite now
passes; see this ticket's PR evidence for the exact count.

## Dead claims refused

None found: the lifted modules describe only behaviour they have (no "future enhancement" comments were carried
over unexamined). The `--draft` CLI flag's own claims (silence for missing voice WAVs, a relaxed limiter) are
exercised, not assumed, in `episodes/skeleton/census.md`.

## E3: the news extensions (omnibus)

Net-new code lives in `studio/news/`: `profile.py` (show profiles: document, omnibus), `graphic.py` (the `graphic`
kind, generalised from `titles.py`'s A40 master: a pre-rendered DRAWN clip at its own rate, optional straight alpha,
as a full-frame shot or a part `text[]` element over a picture), `schema.py` (part `segment` and `as_of`, graphic
shape, `quote_sha256` on reader lines, `text composited` marked RECONSTRUCTED, `silence: intended` with a reason),
`lints.py` with `lexicon.json` (show bible j's blocking lints; `clock-true`, `sources-last`, `no-youtube` declared
`not_implemented` until the release step). Tests: `studio/tests/test_news_lints.py` (fast gate) and
`studio/tests/test_news_render.py` (studio-full), fixtures in `studio/tests/fixture_news/`.

Tweaks to lifted modules, each the smallest that lets an omnibus screenplay be linted and rendered while a document
film plans and renders exactly as before (every default is document's):

| Module | Tweak |
|---|---|
| `render.py` | `build_plan` reads the screenplay's `show` (refused if unknown) and `apply_show` sets `TARGET_LUFS`/`TARGET_TP` (omnibus -16 / -1.5, document -18 / -1.5) and the derived `VOICE_TP` for that plan's mix; the master rate uses the show's masters; `KIND_CLASSES` adds `graphic` (DRAWN) and `ALTERATIONS` adds `text composited`; graphics are cited, licensed, dated and preflighted like clips (`graphic-length` warns past a 2 s hold); `Pictures.shot` plays a graphic over film black and `draw_overlays` composites graphic overlays first; title and lockup cards draw the show's wordmark (`card-drawn` checks it); the credits' studio line is the show's; sources.json carries the `show` record, each graphic's subtype/data_ref, and `graphics_over`; an omnibus plan journals `studio/news/lints.checks` with each line's measured length. |
| `cadence.py`, `policy.py` | The show's masters (30/1 for omnibus). |
| `motion.py` | Wordmark and lockup words as parameters. |
| `description.py` | Links and CARD legend from sources.json's `show` record. |
| `aswas.py` | `graphic` items dated by content. |

Not changed: `maps.py` and `counts.py` still write `void document studio, drawn from ...` into the ledger credit of a
map or count card they draw; omnibus's graphics come from E6's pipeline, not these, so their credit is E6's to set.
The description's release check still reads document's `films.json` registry (absent here), so a release that
leaves credits to the sources page is refused until omnibus's sources page is registered (release step, later).
