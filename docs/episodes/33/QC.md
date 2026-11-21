# Issue 33 first draft: QC packet

**Draft:** Actions run 43540458640 at e862bb0. 720p, 763.0 s (22,890 frames at 30 fps), with layers and stems. The score comes from the `own-score-33` release. The draft was pulled before ed207e7 (the C8 review hardening), so its manifest carries no `unusable_cited`; `pull-render` now computes that from the package's `reports/sources.json` and the screenplay, and for this run it is empty. Render journal: `r-20261114-014102-1631002a`.

**Resolve timeline:** `D:\loom-work\omnibus\33\week-33-modular-2026-11-13 2326.drp`, built by loom e43e01c with the `omnibus` profile on Resolve 21.2.

## Acceptance
| Check | Result |
|---|---|
| Draft files checked against the manifest | 332 of 332 sha256 match |
| Clips placed | 146 of 146, 0 mismatches, 0 manual steps |
| Round trip | zero delta: 146 of 146 matched by id |
| Part markers | 16: clock, cold open, title, week card, week 1 to 7, weight, echo, margins, question, credits |
| Blocking lints (engine and loom) | none. 4 of loom's 8 lints are `not_implemented` (declared by the profile, code in a later phase), so they did not check anything: `a7_whole_open`, `a29`, `a40_slot` and `no_unledgered_ai` |
| No music under quotes or news | pass (block severity, journal r-20261114-014102-1631002a) |
| Rights | ledger green; e33-day2-pic re-signed by the verifier (0 to 14.5 s, remains span 14.533 to 29.2 s excluded); asset-sha in force |
| Unusable items | 1: e33-day6-doc (the White House HTML page). Its download hashed to aa63c508ea51, not the ledger's bb431fc30a20, so it was discarded and not used. Neither the screenplay nor the studio ledger cites it, so nothing aired depends on it |

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
2. **Footage share is 7.5%** (57.4 s of 762.8 s, `episodes/33/FLOW.md` at b31bcf0, measured on the cut before voices were fitted; the draft runs 763.0 s). The pilot week is thin; daily capture starts with issue 34.
3. **720p draft.** The 1080p master comes later.
4. **Narration timings are estimated.** The word timings of all 67 lines (947 words) in voice.json are estimates.
5. **The `sting.wav` cue is unused** in the screenplay. The music director should confirm this is intended.
6. **The week-32 regression mock needs an update** for the new COMPUTER VOICE plate.
7. **Music lints fail at warn severity** (journal r-20261114-014102-1631002a, assembly stage; times are programme seconds from the screenplay's cues):
   - `music-entry`, 1 fail: M2a (Echo bed, 405.1 s) enters from no music with a 0 s fade-in; the minimum is 1.5 s. M2b and M2c pass.
   - `music-exit`, 3 fails: M2a leaves at 417.45 s with a 0.6 s fade-out, M2b at 524.75 s with 0.6 s, and M2c at 555.1 s with 0 s; a bed's minimum is 1.5 s.
   - `music-holes`, 1 fail (unit `music`): 22 holes over 1.5 s with no music and no declared silence, 111.1 s in all: 46.3 to 49.1, 72.7 to 78.1, 102.7 to 108.1, 111.4 to 118.7, 133 to 138.5, 155 to 160.4, 188.5 to 190.8, 216.7 to 222.2, 223.8 to 225.4, 242.8 to 250.2, 261.6 to 266.3, 268.4 to 271.6, 313.1 to 314.7, 318.3 to 335.6, 337.9 to 347.7 (after M1, before M2a), and 551.9 to 555.1, 635.4 to 638.4, 649.8 to 654.8, 655.8 to 658.1, 677.3 to 682.4, 683.5 to 685.7, 698.6 to 703.7 (after M2c, before M3). The fix is the same as for item 1: carry a bed through, or declare `silence: intended` with its reason. Never music under news.

   Every other music, bed and duck lint passed: music-entry M2b and M2c, music-treble (5), score-role (5), underscore-gain (3), bed-under-voice, bed-breathing and bed-low-end (3 each), bed-reuse (4), score-repetition (4), duck-pumping, duck-slope, no-music-under-quote and no-music-under-news (1 each). The journal's other warn fails (161 fail events in all, none at block severity) and its 122 review events are listed in the journal itself.
