# Decisions

Append-only log of scope and architecture decisions for void omnibus. Newest entry
at the bottom. Do not edit or delete past entries; add a new one that
supersedes it instead.

<!-- Format:
## YYYY-MM-DD: <short title>
<what was decided and why, 2-4 sentences>
-->

## 2026-11-11: G1 greenlight approved
Gate `omnibus-g1`, outcome: approved. The founder delegated the decision to the Chief of Staff overnight ("Finish end to end without my inputs overnight", 2026-11-11). The brief and the show bible (Fable, 2026-11-11, revised on the founder's rulings: name, retro broadcast look, synthesised founder voice, publish-by-default after four clean episodes, CC BY-SA 4.0, site only until the YouTube Data API audit passes) are the scope of record.

## 2026-11-11: success event `episode_completed`; the Spark unit counts as `week_opened`
The kill criteria count `episode_completed` (a viewer reaches an episode's final 30 seconds), so it is contract.yaml's success_event, in config.ts, CHARTER.md and `reportCoreSuccess()`. Spark cannot serve an episode, and counting a week-page read as an episode completion would make the kill count lie. So `reportCoreSuccess()` is wired only to the episode player hook (`watchEpisode`, any `video[data-episode]`, fired once at duration minus 30 s); no page has one yet, so the count stays at zero until the first episode airs. The Spark unit, `/e/32` read to its source ledger, sends a second allowed client event, `week_opened`, when `#ledger-end` comes into view (never on load). The G4 card shows it beside the success event, never in its place. A third client event lowered EVENT_DAILY_CEILING from 4,000 to 3,000 so the worst case stays at 12.6% of the account's D1 writes (cap 15%).

## 2026-11-11: week 32 record and its rules
`data/week-32.json` (37 KB) is normalised by `scripts/normalise-week.mjs` from void news's public repo (github.com/aacrit/void--news) at pinned commits: weekly issue 32 from `frontend/build-data/weekly-issues.json`, the seven daily printed editions from `frontend/build-data/feed.json` history (all seven days exist, 26 Oct to 1 Nov), the lead's three coverage records from the deep-dive files first committed for its clusters, and outlet ratings from `data/sources.json`. The weekly issue's own `week_days` list repeats one headline for all six days it holds, so the day beats come from the daily snapshots instead (rank 1 = first in printed order). The horizon is the edition's generation time, 2026-11-04 08:34 UTC (it ran late). void news publishes no outlet reach figure, so the board's "highest-reach outlet" per rung is approximated by tier (us_major, then international, then independent), then the outlet's article count in the lead's record, then name; Blueprint may replace it with a real reach figure. Headlines are quoted verbatim, punctuation included (some carry an em dash or a "- AP News" suffix as syndicated); our own copy has no em dashes. The echo is shown as a candidate only (spanish-flu-1918, alternate black-death), per the bible.

## 2026-11-11: faces and tokens
void's four faces replace the template's: Playfair Display, Inter, Barlow Condensed, IBM Plex Mono, self-hosted from @fontsource. Tokens are the bible's walnut, cream and chrome with the bias spectrum as the only chroma; the paper theme's secondary ink and surface steps are provisional until Blueprint's token layer.

## 2026-11-11: rate-limit namespace 7601
Other products use 7201-7203 (rollbook), 7301-7303 and 7311-7313 (dial), 7401 (ratio), 7501 (document). omnibus takes 7601.

## 2026-11-11: custom domain, and Dial's contract runner
The zone's WAF rate-limit rule is live (added by the founder for Dial, docs of record in aacrit/dial DECISIONS 2026-09-26). So the first release attaches omnibus.voidvision.org (`routes`, custom domain) and keeps workers_dev on, with preview_urls off. On the custom domain the WAF answers a burst before the Worker's own limiter, so the contract sends its burst to `burst_host` (omnibus.aacrit.workers.dev) after matching builds. The template's runner predates `burst_zone`/`burst_host`, so `scripts/contract.mjs` is lifted from Dial with a provenance header; folding it back into the template is an Agentique follow-up.
