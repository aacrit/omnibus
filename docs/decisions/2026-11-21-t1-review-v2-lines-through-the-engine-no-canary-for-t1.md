# 2026-11-21: T1 review, v2 lines through the engine; no canary for T1 (builder, review of PR #36)

**Review of PR #36.**
- `build_plan` reads a news show's lines through `schema.engine_play`. Every engine consumer (the mix, `voice-over-black`, the voicing manifest, A0) sees narration or testimony, and the news lints get the screenplay's own kinds back (`news_play`).
- A `role: muted` shot is journaled as `sound-muted-mode`.
- The v1 spine needs `issue: 33` and, when a folder is known, the `episodes/33` folder. The frozen screenplay's sha256 is pinned in a test.
- Count and quote cards need non-empty text.
- `fair-use-refused` also scans top-level music, a line's `transcript_ref` and the clip behind its `shot_ref`. It reads a wider fair-use basis (fair use or fair dealing, 17 USC 107 in any spelling).

**No canary for T1.** The T1 schema rules (`news-fields`, `segment-spine`, `line-schema`, `sound-role`, `card-kind`, `part-shape`, `graphic-schema`, `fair-use-refused`) block at once, with no week of log-only canary, because no v2 episode exists yet for them to misfire on. Ticket 6 wires canary mode for section o's new lints after this. **Ticket 2's acceptance item:** check each lead or package part's `shape` against its rundown story's `rundown.stories[].shape`.
