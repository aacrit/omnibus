# 2026-11-22: T9c: the v2 line kinds are voiced by their cast voice, and an sot line never (builder, from show bible v2 sections e and j)

Ticket 1 left the renderer unable to voice v2 lines. `voicing_manifest` and `voice_episode` now read every line through `schema.ENGINE_LINE_KIND`: `vo`, `signon` and `signoff` are narration, voiced by their `read_by` (the narrator `v-narrator`, Kokoro af_aoede 0.88, or `v-narrator-echo` at 0.84 in The Echo); `read` is a reader line (Kokoro am_michael 0.86, section j), held to its own `quote_sha256` before anything reaches the model, as v1 testimony was. An `sot` line is never voiced and never needs a take: it is the speaker's own sound, played from its clip on the sot bus (`voiced_lines` drops it by its own kind, or its kept `news_kind` once the engine has read it).

Two fixes the v2 kinds exposed: the manifest's `identity` was the first voice voiced, not the narrator's, when a reader line came first (it now finds the narrator by engine kind); and the render's `place_voices` and `check_plan` ran `--fit-voices` and the pre-flight on the screenplay as written, where no v2 line is a voice line, so nothing was fitted. Both now read the screenplay through `schema.engine_play` first, as `build_plan` already did (the reading is idempotent; the news lints undo it with `news_play`).

One latent bug found on the way: a take's length and its last word's end were rounded to the millisecond separately, so a last word ending on the take's last sample could round 1 ms past the take and the manifest refused it. Word times are now capped at the rounded length.

An sot line's clip audio in the engine (its `shot_ref` read as the engine's archival span) is not wired: issue 35 has no sot line. That is T6's, with `sot-raw-source`.
