# 2026-11-14: C8 review hardening (after the first full draft, run 43540458640)

**Silence rules, read strictly.** `studio/news/score_check.py --journal` now requires every event of `no-music-under-quote` and `no-music-under-news` to be `pass`. `fail`, `inconclusive`, `review` or any other status is named as a problem. The full draft's own journal (r-20261114-014102-1631002a) was read event by event. Every silence, duck and music lint event is listed here, failures included; the journal's other lints are not (161 fail events in all, every one at warn severity, and 122 review events):
- `no-music-under-quote`: 1 event, pass.
- `no-music-under-news`: 1 event, pass.
- `duck-pumping`: 1 event, pass (warn severity).
- `duck-slope`: 1 event, pass (warn severity).
- `silence-reason`: 8 events, all pass.
- `digital-silence`: 1 event, **fail**, at warn severity, so the render went on. It found 16 runs of digital silence over 4 s, 104.9 s in all, outside the declared intended silences: 0.0–6.0, 15.2–20.0, 24.8–29.7, 72.6–78.1, 102.7–108.1, 111.4–118.7, 133.0–138.5, 155.0–160.4, 216.7–222.2, 242.8–250.2, 261.6–266.3, 318.3–335.6, 337.9–347.7, 649.8–654.8, 677.3–682.4 and 698.6–703.7 s.
- `music-entry`: 3 events, 1 **fail** at warn severity: M2a (the Echo bed at 405.1 s) enters from no music with a 0 s fade-in, under the 1.5 s minimum. M2b and M2c pass.
- `music-exit`: 3 events, all 3 **fail** at warn severity: M2a leaves at 417.45 s with a 0.6 s fade-out, M2b at 524.75 s with 0.6 s and M2c at 555.1 s with 0 s, each under a bed's 1.5 s minimum.
- `music-holes`: 1 event (unit `music`), **fail** at warn severity: 22 holes over 1.5 s with no music and no declared silence, 111.1 s in all: 46.3–49.1, 72.7–78.1, 102.7–108.1, 111.4–118.7, 133.0–138.5, 155.0–160.4, 188.5–190.8, 216.7–222.2, 223.8–225.4, 242.8–250.2, 261.6–266.3, 268.4–271.6, 313.1–314.7, 318.3–335.6 and 337.9–347.7 s (after M1, before M2a), and 551.9–555.1, 635.4–638.4, 649.8–654.8, 655.8–658.1, 677.3–682.4, 683.5–685.7 and 698.6–703.7 s (after M2c, before M3).
- `music-treble` 5, `score-role` 5, `underscore-gain` 3, `bed-under-voice` 3, `bed-breathing` 3, `bed-low-end` 3, `bed-reuse` 4 and `score-repetition` 4 events: all pass.

The coordinator decides; there is no re-render until then. **Score.**
- `score_check` runs before the studio items and checks each take's decoded samples against `score.take.json`'s `decoded_sha256`.
- A music cue in the score folder must be one of its hashed outputs.
- The Echo bed's spans are cut sample-exact (soundfile, integers in and out). Each cut's decoded sha256 must equal the source's samples at the same offset.
- A cue without a numeric `bed_in_s` refuses its span.

**Sources.**
- A failed own-pages download fails the step.
- `episode-draft.mjs unusable` exits 1 when the screenplay or studio ledger cites an unusable item. An id counts wherever it stands as a token in any string, prose included (the studio ledger's "e33-echo-req-13 (rights ledger, ...)"), never inside a longer id (`e33-echo-req-1` is not cited by `e33-echo-req-13`). The manifest records those as `unusable_cited`, and `pull-render` refuses a run that lists any. A manifest from before ed207e7 (run 43540458640) has no `unusable_cited`; `pull-render` then computes it from the package's `reports/sources.json` and the screenplay at the run's commit, and refuses the run when the report is missing.
- `score_check` requires a `decoded_sha256` on every take output (all 5 in `score.take.json` carry one).
- The sources step captures `own-files` into a variable before using it, so a failure there fails the step.

**On-screen ids.** `clean.find_internal_ids` matches a hex token of 7 or more digits, with at least one letter a-f and one digit, between alphanumeric boundaries: hyphens and underscores no longer shield a hash (`cluster-2ec1fcb8`, `cluster_2ec1fcb8`, `2ec1fcb8-01`, a UUID, a run id, a 64-hex sha256). The only exemption is a named public catalogue form masked before the scan, NARA's local identifier (`342-AF-86335AC`, `111-ADC-8634`). Every issue 33 graphic template (31, the credits and lower thirds included) passes.
- `pull-render --from r2` is refused until C9.

**On-screen ids.** `clean.assert_no_internal_ids` flags a 7- to 40-hex-digit token with at least one letter and at least one digit, standing alone. The digit keeps English words spelt in a to f (DEFACED) out. A hyphen-joined catalogue number (NARA's 342-AF-86335AC in a credit) is left alone.
