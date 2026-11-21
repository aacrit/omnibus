# 2026-11-21: T3, audio routing (show bible v2 j)

Ticket 3 (section r): the `sot` bus, nat levels, the room-tone floor, `dead-air` promoted to block, and
`echo-bed-ending`. Builder session, branch `t3/audio` from `origin/main`. Ticket 1 (PR #36, the schema spine with
`sound.role`) is still open; this ticket codes against its names and is written to rebase cleanly once it merges.

**Spec ambiguities resolved, and why:**

1. **`sound.role` before ticket 1 merges.** `studio/engine/render.py` gets its own `shot_audio_role(sound)`: the v2
   `role` (`sot`/`nat`/`muted`) when a shot states it, else the v1 `sound.mode` (`own` -> `nat`, `mute` -> `muted`),
   so issue 33's frozen screenplay (which only ever states `mode`) keeps playing exactly as before. Ticket 1 owns
   `sound.role`'s schema validation; this is only the engine's own reading of it, needed so the mix can route a bus
   before that ticket lands. When ticket 1 merges, `shot_audio_role` keeps working unchanged (it already prefers
   `role`); nothing here needs to move.
2. **Bible-j leveling only applies to a shot that states `role` explicitly.** A v1 clip (`sound.mode` only, e.g.
   issue 33) is never leveled or ducked by this ticket: its own-sound plays at its native level, exactly as before
   ("one static gain, never cleaned or limited"). Only a v2 shot with `sound.role` gets NAT_FULL_LUFS / NAT_UNDER_VO_
   LUFS / SOT_LUFS applied. This is what keeps the issue 33 regression green while the new levels are real for any
   v2 fixture.
3. **The clips bus becomes nat; sot is new, without renaming internals.** `STEM_BUSES` now writes `sot.wav` (new)
   and `nat.wav` (renamed from `clips.wav`); the Python dict key stays `"clips"` everywhere in `render.py` (bus_
   capture, `voice_ceiling_pass`, `level_title_audio`, `_mix_at`), so only the *file name* changes and every other
   reader of the dict is untouched. `sot` is summed into the mix as a fifth, fixed bus (held across every voice-
   ceiling pass, exactly like clips/nat always was); title audio still lands on nat specifically (bible j never
   mentions SOT under the title), since `level_title_audio` mutates its `clips` argument in place.
4. **Level targets.** Bible j gives ranges, not single numbers, for nat (`-20` to `-18` LUFS short-term) and SOT
   (`-18` to `-20`, "the same level as the narrator"). Decided: `NAT_FULL_LUFS = -19.0` (the midpoint); `SOT_LUFS =
   DIALOGUE_LUFS` (`-20.0`, the narrator's own constant, read literally from "the same level as the narrator"
   rather than its own midpoint). `NAT_UNDER_VO_LUFS = -24.0` is the bible's own ceiling, not a range.
5. **"Nat under VO" as a static per-clip level, not a continuous duck.** The bible's package grammar means a nat
   clip's own-sound span is either entirely under a VO line or entirely in the clear (a slate beat, a package out,
   the pre-tease 0.8-1.2 s): there is no case in the grammar of one clip's span being half under VO. So each clip
   is leveled once, to whichever target its own span mostly falls under (`_own_sound_under_vo`, a >=50% coverage
   rule against the VO lines already placed), rather than building a second continuous duck curve for nat (which
   music already has, for a different bus, at a different depth). This is documented as a decision, not a
   generalisation past what the bible's own shape needs.
6. **Foreign-language SOT's two-stage gain.** "Comes up full for 1.5 s, then ducks to -24 (official) / -18 (ours)"
   is one clip, one static base gain (to `SOT_LUFS`), with a per-sample envelope (`_translation_envelope`) baked
   into its own audio before placement: full gain for `TRANSLATION_FULL_S`, a 200 ms ramp, then the duck gain
   (reached by the dB difference between the duck LUFS target and `SOT_LUFS`, not a second loudness measurement:
   the clip's own loudness does not change in 1.5 s). `translation` only ever applies to `role: sot`.
7. **`room-tone-floor` and `dead-air` are render-time, not plan-time.** Both need the actual rendered samples (a
   real dBFS peak, a real run of true digital silence), so they are not `studio/news/lints.py` plan-time checks;
   they are new functions beside `sound_lints` in `render.py` (`room_tone_lints`, `dead_air_lints`), run in
   `render()` right after `sound_lints`, gated to `(plan.get("show") or {}).get("news")` (the existing `prof["news"]`
   convention) so void-document is untouched. `dead-air` sits beside, not instead of, the generic engine's own
   `digital-silence` warning (`SILENCE_WARN_S = 4.0`): the bible's rule is the news programme's own, tighter floor
   (`DEAD_AIR_MAX_S = 2.0`, declared silence at most `DEAD_AIR_DECLARED_MAX_S = 6.0`). Both rule ids are registered
   in `SOUND_LINTS` (the mix/take-only parity table `test_preflight_voice.py` holds to the code).
8. **`echo-bed-ending` is deferred until ticket 1 merges.** The check itself (`studio/news/lints.py`,
   `echo_bed_ending_checks`) is implemented and unit-tested (`studio/tests/test_t3_audio_routing.py`, with
   `SC.SEGMENTS` monkeypatched to include a `signoff` segment, simulating ticket 1's schema): it finds the Echo's
   bed cue (`score.cue_role` `bed`) and checks it ends at least 2.0 s before the sign-off part and never overlaps
   the theme (`score.cue_role` `main_title`). But today's schema (pre-ticket-1) has no `signoff` segment at all, so
   it is moved to `NL.DEFERRED` rather than wired into `checks()`'s active pipeline: wiring it in now would block
   every v1 screenplay (issue 33's frozen spine), which has no sign-off to time the Echo's bed against. The
   rebase onto ticket 1 should move it from `DEFERRED` to an active `_guarded("echo-bed-ending", ...)` call; no
   other code changes needed.
9. **Loom change, on a branch, not pushed.** `loom/profiles/omnibus/profile.yaml`'s buses become `voice, sot, nat,
   music, amb` (ticket 3's own file, in the loom repo). `loom/modules/ingest/document_layers.py`'s `BUS_TRACKS`
   becomes profile-aware (`bus_tracks_for`): a profile with no `sot` bus (void-document, and any other) gets
   exactly the old `BUS_TRACKS`, file for file and track-name for track-name; omnibus's profile gets a sot track
   inserted after voice, and its archival-sound track reads `nat.wav`. The bus-presence fallback in the same
   function (which used to pad a Cut's buses with a hardcoded `voice, clips, music, amb`) now reads the same list,
   so it stops adding a spurious unused `clips` bus to a profile that no longer declares one. Committed on branch
   `t3/audio-buses` in the loom repo (loom is local-only git, with no remote: nothing is pushed). Tests: `tests/
   test_ingest_document_layers.py` (two new cases: omnibus gets sot/nat tracks; void-document is unchanged) and
   `tests/test_profile.py` (the omnibus bus list). Full loom suite green (`python -m pytest tests/`, 192 passed).

**Evidence (laptop, targeted files only; the laptop has a CPU fault, so no full render locally):**

```
python -m pytest studio/tests/test_stems.py studio/tests/test_preflight_voice.py studio/tests/test_news_lints.py \
    studio/tests/test_t3_audio_routing.py studio/tests/test_a40_title_audio.py studio/tests/test_r12_fill_sound.py \
    studio/tests/test_voice_over_black.py studio/tests/test_r11_clips.py -q
-> all passed (see the PR for the exact counts)
```

CI's sharded `studio-full` runs the full render-path regression, including issue 33.
