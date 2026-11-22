# 2026-11-22: T9a: a rundown/2's asset requests live in episodes/<n>/rundown-assets.json

`scripts/rights.mjs resolve` read its ladders from `rundown.json`'s `asset_requests`. The v2 normaliser writes `omnibus.rundown/2`, which has no such field and must never be hand-edited, so issue 35 could not be resolved at all: `resolve 35` stopped on `rundown.issue` (v2 keeps it under `edition.issue`).

The fix keeps the rundown generated and gives the sourcing pass its own file:

- `episodes/<n>/rundown-assets.json` (`omnibus.rundown-assets/1`: `{ schema, issue, asset_requests }`) holds the requests in v1's shape: an `id`, the `for` it serves, `kind`, `purpose`, `ladder`, `fallback`.
- `requestSource()` in `scripts/rights.mjs` reads a v1 rundown's own `asset_requests` as before. For a rundown/2 it reads this file, refuses another issue or schema, and refuses a request whose `for` is not a slot of the rundown (`lead`, `package_<n>`, `brief_<n>`) or `tease`. When the file is absent, the issue has no requests.
- The candidate pins in `episodes/<n>/candidates/*.json` key on these request ids as before. A pin's `fit.beat` names the story key, which is what `footage_cleared_s` counts (decision `2026-11-21-t2-footage-cleared`).

The v2 slots are news parts. `NEWS_PART` in `scripts/lib/rights/fetcher.mjs` now also matches `tease`, `lead`, `package_<n>` and `brief_<n>`. The fetcher then holds every picture for them to publication by its window's end, which for issue 35 is the cutoff (2026-11-21T14:17:37Z). This tightens the rule, and it stands in for bible n's `picture-in-week` until tickets 5 and 6 build it. The `FILMED <date>` exception is not implemented, so a picture of an event before the week is not taken.

Tests: `tests/rights-t9a.test.ts`.
