# 2026-11-22: T9c: what the engine's plan refused in the issue 35 screenplay, and the smallest fix for each (builder)

With stand-in graphics and takes on the laptop (scratch only, never committed), `render --check --draft --fit-voices` named the screenplay's engine-side faults. Each fix keeps every later timing and every truth lint as it was.

- `tiling` (S-EC-1): the Echo's dissolve (`echo-dissolve`, 1.5 s, bible g) needs the bumper to run under it. G-BUMP-2 is now 3.3 s (1.8 s alone, then the 1.5 s dissolve), so S-EC-1 and everything after it keep their start times. The graphics plan's frames for `g-bump-echo` follow (99).
- `clip-repeat` (S-P4-1): package 4 opens on the same arrival seconds the tease previewed. A tease previews by design, so S-P4-1 names `repeat_of: S-TEASE-4`.
- `score-role` (every sting and Echo cue), and the score's wavs: see the score decision of the same date.
- `telecine-declared` (the arrival video): see the telecine decision of the same date.

With those fixed and stand-ins for the graphics and the takes, the check passes: 57 shots planned in draft. On Actions the stand-ins are replaced by the narration job's real takes and by the graphics job, once ticket 4 draws every subtype this screenplay names.

After the lead became a full package (t9b at 152a4c1), the same check named three more faults, each fixed inside the rights fit:

- `clip-flash` (S-LEAD-10): in at 1532.0 s opened on the last 0.64 s of the previous source shot. It now runs 1531.85 to 1534.45 s, inside the fit (1380 to 1535).
- `clip-flash` (S-P4-APEC): in at 110.0 s was 0.28 s after a source cut at 109.72 s, and the fit starts at 110. It now runs 110.47 to 129.9 s. S-P4-1, the shot before it, grows 0.47 s (to arrival 45.0 to 55.42 s, inside its fit), so no later start moves.
- `telecine-declared`: the SSU video is measured too. It is progressive.

Still open on real takes: `--fit-voices` grows a clip under a delayed line, and with stand-in takes it grew S-P4-APEC 0.32 s past its fit (`fit-span`, blocking, kept). If the real takes do the same, fit_voices must move the time to a shot that is not fit-bound. That is the engine's call, not a looser lint.
