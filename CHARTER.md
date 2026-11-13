# Charter

At most 5 surfaces for v1. Any surface added later needs a charter amendment. From the G1 brief (2026-11-11). Kill dates assume the pilot airs by 2026-12-14 and are re-dated at G3.

| Surface | Why | Justifying user event | Kill date |
|---|---|---|---|
| Home `/` | The latest episode, the programme guide (next airtime, past weeks), what the programme is in three lines | `episode_started` | 2027-03-14 |
| Episode `/e/<issue>` | Our own player (1080p and 720p from R2, range requests, no cookies), chapters, captions, transcript. In Spark: the week's record as a page, `/e/32` "Week 32, in sources" (`week_opened`) | `episode_completed` | 2027-03-14 |
| Sources `/e/<issue>/sources` | Every shot to its source, licence, credit and treatment; the ladder data behind every board; the echo's horizon and sources; the voice disclosure; corrections | `source_opened` | 2027-03-14 |
| Corrections `/e/<issue>/correct` | Anyone can flag an error; accepted corrections are read in the next episode and listed here | `correction_submitted` | 2027-03-14 |
| Studio (local CLI `omnibus`, the cloud drafting routine, the Board ask) | Snapshot, rundown, screenplay, lints, narration, render, QC, publish | `episode_published` | 2027-03-14 |

`/privacy` (aggregate counts, the form, the rate limit) and `/feed.xml` ship with Home. Events other than `page_view`, `episode_completed` and `week_opened` are added to `contract.yaml` by the ticket that builds their surface.

## Kill criteria

Aggregate counts in D1 (`/e`'s `event_counts`); nothing per person. No money changes hands.

- **Cadence.** Fewer than 3 episodes aired in any rolling 4 weeks after the pilot: archive. Measured by `episode_published` rows in D1, written by the publish step.
- **Audience, site.** 2027-03-14 (pilot + 90 days): fewer than 600 `episode_completed` in total: archive.
- **Audience, YouTube** (armed only when YouTube publishing starts). 90 days after the first public YouTube episode: fewer than 6,000 YouTube views across all episodes (`videos.list?part=statistics`, read once a day by a GitHub Action into D1) and fewer than 600 site `episode_completed` in the same 90 days: archive. Dormant until then, and the G4 card says so.
- **Cost.** Two consecutive episodes each consuming more than 15% of the week's Claude usage (logged to the registry row by the drafting session): pause and re-scope before the next edition.

`week_opened` (the Spark unit) is reported on the G4 card beside these counts and never substitutes for `episode_completed`.

Reading the counts: every count is capped by its daily ceiling, and a browser-sent one can be inflated by anyone who posts to `/e`. So the G4 packet shows each count's day-level spikes (days at or near a ceiling, or far above the usual day) next to the totals, and a total carried by a spike is read as suspect, not as progress.

## Not in v1

- YouTube publishing before the Data API audit passes; Shorts or clips; comments; accounts; dubbing or non-English subtitles; live; guests or interviews.
- Any opinion segment (the weekly edition's generated opinions are not used).
- Day-precision "on this day" history (the echo matches by mechanism, not by date).
- Resolve finishing on the weekly path (per-episode opt-in only); a founder voice-recording workflow; PeerTube; a US edition; a mobile app.
- Any product-side LLM call.

## Workflows: 5 (gate, verify-production, branch-prune, snapshot, studio-full)

`studio-full` (added 2026-11-12) runs the lifted engine's whole test suite (`studio/tests`, about 2,560
cases); the per-commit `gate` runs only a fast subset (docs/DECISIONS.md).
