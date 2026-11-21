# Slice of issue 33: engine to loom to Resolve (E11a plan, E11b run)

A 42 s draft of issue 33 for the loom handoff rehearsal, never for air. Its media are synthetic
stand-ins (`ledger.json`, at `D:/omnibus-media/33-slice/media`; the two voice lines' test tones at
`D:/omnibus-media/33-slice/audio`), except the Echo's lower third, which is episode 33's own
`lt-echo-x2` through `../33/ledgers/graphics-e4b.json`. None of it is committed.

## Before it runs

- `npm ci` at the repo root (the engine reads its fonts from `node_modules/@fontsource/...`).
- The stand-ins must be on disk at the paths above.
- Take the heavy slot for the render (HEAVY.lock); loom's first build takes it itself.

## Render (engine, from the repo root)

```
python -m studio.engine.render episodes/33-slice --draft --layers --stems --fit-voices --out D:/omnibus-media/33-slice/render
```

`--layers` runs the dot's probes on the overlay alone over black, on every frame. A graphic that
paints the label zone (bottom right, y 1004 to 1043 at 1080p) while the label is off fails them:
E11a's full-frame opaque `g-lt.mov` stand-in did, at 15.0 s. A real E6 lower third stays above it.

## Hand to loom (from the loom checkout, its venv)

```
python -u -m loom.firstbuild --dry-run --profile omnibus --render D:/omnibus-media/33-slice/render --screenplay <omnibus>/episodes/33-slice/screenplay.json --out D:/loom-work/omnibus/33-slice-dry
python -u -m loom.firstbuild --profile omnibus --render D:/omnibus-media/33-slice/render --screenplay <omnibus>/episodes/33-slice/screenplay.json --out D:/loom-work/omnibus/33-slice
```

The real build waits for HEAVY.lock to be free for 20 minutes (the house cool-down), takes it,
builds the timeline in Resolve 21.2, exports the .drp and `build-report.json` to `--out`, quits
Resolve and releases the lock. Keep system audio muted while Resolve is open.

## The full episode

The same three commands with `episodes/33`, `--out D:/omnibus-media/33/render` and loom's
`--out D:/loom-work/omnibus/33`. Episode 33 also needs, merged first: E9i (PR #19, the engine reads
the rights ledger's licence ids such as `pd-us-federal`; without it `build_plan` refuses
`licence-allowlist`) and E7's voicing (PR #20: takes under `D:/omnibus-media/33/voice`, copied to
`episodes/33/audio/<line id>.wav`, where the engine reads a line with no `wav`).
