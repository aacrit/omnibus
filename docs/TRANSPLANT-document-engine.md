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
| `studio/engine/aswas.py` | lift | A0 show-as-was text and date rules. | same |
| `studio/engine/bracket.py` | lift | Fill-detail and crop bracketing. | same |
| `studio/engine/cadence.py` | lift | A44 master frame rate (24 or 30000/1001) per film. | same |
| `studio/engine/captions.py` | lift | Subtitle fill and burn-in. | same |
| `studio/engine/clips.py` | lift | A44 clip conform (frame drop/repeat), source frame tolerances. | same |
| `studio/engine/counts.py` | lift | Card numeral checks. | same |
| `studio/engine/description.py` | lift | A56 description block; reads `web/src/cc-licences.json` (see below). | same |
| `studio/engine/disclosure.py` | lift | A56 per-film disclosure text. | same |
| `studio/engine/georef.py` | lift | Map georeferencing helpers. | same |
| `studio/engine/journal.py` | lift | `Journal`, `sha256_file`: the run's own audit log. | same |
| `studio/engine/kokoro_worker.py` | lift | Runs under a separate Kokoro venv (`studio/requirements-tts.txt`, left behind, a later ticket); the module itself imports cleanly and is kept so the module name is stable when that ticket lands. | same |
| `studio/engine/layers.py` | lift | `--layers` compositing. | same |
| `studio/engine/levels.py` | lift | Loudness measurement and gain. | same |
| `studio/engine/maps.py` | lift | Natural Earth maps (named by `reports/briefs/omnibus-engine-plan.md` as the E6 graphics source). | same |
| `studio/engine/motion.py` | lift | Every graphic draw (cards, lockup, marks). | same |
| `studio/engine/moves.py` | lift | Camera move primitives. | same |
| `studio/engine/narrator.py` | lift | Kokoro voice/lock lookups; reads `studio/kokoro.lock.json`. | same |
| `studio/engine/overlays.py` | lift | Lower thirds and overlay text. | same |
| `studio/engine/pages.py` | lift | Screenplay page helpers. | same |
| `studio/engine/policy.py` | lift | Per-film settings, imagery rule, shortfall statements. | same |
| `studio/engine/publish.py` | **leave behind** | Web encode and poster packet; no web publish surface exists yet for omnibus episodes (the charter's own Episode/Sources pages are net-new, not this). Its tests (`test_publish.py`, and the one case in `test_films.py` that calls it) leave with it. | none |
| `studio/engine/render.py` | lift | The render engine itself: `TARGET_LUFS = -18.0` at line 117 (unchanged; census item). | same |
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

## Gate

`npm run gate` runs `studio-test` (`pytest studio/tests -q -p no:cacheprovider`) right after the JS `test` step,
mirroring document's own gate order; see `scripts/gate.mjs` and `.github/workflows/gate.yml`. No test is skipped:
the four files above were trimmed before the transplant commit, per the transplant skill's rule 5, rather than
carried in and marked `skip`.

**Known, undispositioned gap: ~87 of the suite's ~2,560 cases fail on a missing design token, not an engine
bug.** `studio/engine/maps.py`'s `palette()` (`maps.py:136-158`) and its `ROLES` table (`maps.py:134-146`) read
named custom properties from `design/tokens.css` that go beyond the seven base Ink & Momentum tokens:
`--color-letterbox`, `--color-border`, `--color-cream-faint`, `--mark-text`, `--mark-generated`,
`--color-generated-text`, `--scrim-strong`. These are document's own extension for its archival-footage mark
system (A42); omnibus's `design/tokens.css` does not define them (it was never asked to), so `resolve()` refuses
with `token --color-letterbox is not in tokens.css` (`maps.py:116`) before a single map or count card can draw.
That one refusal cascades through `test_maps.py`, `test_a56_map_credit.py`, `test_counts.py` and part of
`test_e15.py`'s brand-kit checks (the last few of those also compare against `design/brand-kit/*.svg`, a file
set that is document's own and was not transplanted). This is not fixed in this PR: choosing omnibus's own
values for these roles is a design decision (`ink-and-momentum`'s "earned-accent" re-expression), not a
mechanical transplant step, and none of `studio/engine/*` changed to produce this finding. It belongs to a
Studio/Graphics ticket (the plan's E6) that gives omnibus its own extended token set or gives `maps.py`/`motion.py`
a fallback. The gate's evidence block in this ticket's PR states the exact pass/fail counts.

## Dead claims refused

None found: the lifted modules describe only behaviour they have (no "future enhancement" comments were carried
over unexamined). The `--draft` CLI flag's own claims (silence for missing voice WAVs, a relaxed limiter) are
exercised, not assumed, in `episodes/skeleton/census.md`.
