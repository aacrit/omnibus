# Issue 33 first draft: QC packet

**Draft:** Actions run 43540458640 at e862bb0. 720p, 763.0 s (22,890 frames at 30 fps), with layers and stems. The score comes from the `own-score-33` release.

**Resolve timeline:** `D:\loom-work\omnibus\33\week-33-modular-2026-11-13 2326.drp`, built by loom e43e01c with the `omnibus` profile on Resolve 21.2.

## Acceptance
| Check | Result |
|---|---|
| Draft files checked against the manifest | 332 of 332 sha256 match |
| Clips placed | 146 of 146, 0 mismatches, 0 manual steps |
| Round trip | zero delta: 146 of 146 matched by id |
| Part markers | 16: clock, cold open, title, week card, week 1 to 7, weight, echo, margins, question, credits |
| Blocking lints (engine and loom) | none |
| No music under quotes or news | pass (block severity, journal r-20261114-014102) |
| Rights | ledger green; e33-day2-pic re-signed by the verifier (0 to 14.5 s, remains span 14.533 to 29.2 s excluded); asset-sha in force |

## Known gaps for the hand edit
1. **Dead air.** The digital-silence lint fails at warn severity: 16 stretches longer than 4 s, 104.9 s in all. Programme times in seconds:
   - 0 to 6
   - 15.2 to 20
   - 24.8 to 29.7
   - 72.6 to 78.1
   - 102.7 to 108.1
   - 111.4 to 118.7
   - 133 to 138.5
   - 155 to 160.4
   - 216.7 to 222.2
   - 242.8 to 250.2
   - 261.6 to 266.3
   - 318.3 to 335.6
   - 337.9 to 347.7
   - 649.8 to 654.8
   - 677.3 to 682.4
   - 698.6 to 703.7

   The fix is room tone at about −72 dBFS or below, or `silence: intended`. Never music under news. For issue 34 onward, the engine should add a room-tone bed or the screenplay should declare these stretches.
2. **Footage share is 7.5%.** The pilot week is thin; daily capture starts with issue 34.
3. **720p draft.** The 1080p master comes later.
4. **Narration timings are estimated.** All 67 word timings in voice.json are estimates.
5. **The `sting.wav` cue is unused** in the screenplay. The music director should confirm this is intended.
6. **The week-32 regression mock needs an update** for the new COMPUTER VOICE plate.
