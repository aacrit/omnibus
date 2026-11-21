# E11a slice: run later (not run by this ticket)

This slice (`episodes/33-slice/screenplay.json`) plan/lint-checks clean in `--draft`
(`python -m studio.news.lints episodes/33-slice`: 38 checks, 0 blocking; `render.build_plan(...,
draft=True)`: OK). It has **not** been rendered. Its media (`episodes/33-slice/ledger.json`'s
items) are synthetic test stand-ins held at `D:/omnibus-media/33-slice/media`, never committed and
never for air (see the ledger's own `note`).

## To render the draft (loom/omnibus handoff rehearsal only)

```
python -m studio.engine.render episodes/33-slice --draft --layers --stems --out D:/omnibus-media/33-slice/render
```

## To hand the render to loom (first build, dry run)

```
python -m loom.firstbuild --dry-run --profile omnibus episodes/33-slice/screenplay.json D:/omnibus-media/33-slice/render
```

Then the real build per loom's own README (`loom/profiles/omnibus/profile.yaml`, merged to loom's
`main` at `012f9c3`): drop `--dry-run` once the dry run's plan looks right.

## Before any of this runs for real

- Regenerate the synthetic media first (it is not committed): see
  `episodes/33-slice/ledger.json`'s items for the five stand-in ids (`g-board`, `g-lt`,
  `g-testcard`, `dr-title`, `st-weight-tour`, `st-echo`) and their `file` paths under
  `D:/omnibus-media/33-slice/media/`.
- `npm install` at the repo root first (the engine's card/lower-third layout reads font files from
  `node_modules/@fontsource/...`).
