# 2026-11-21: T2: the weekly edition is a log beside the rundown

The weekly edition prints after the pin (issue 34 printed at 22:58 UTC). Neither obvious place to read it works:

- read at the pin, it would almost never be there;
- read at the history's head, it would make the rundown depend on when it was rebuilt.

So the two reads are kept apart:

- The desk and `edition.weekly_edition_seen` read weekly-issues.json at the pin only.
- `node scripts/normalise-rundown.mjs ... --crosscheck` reads it at the head and writes `weekly-crosscheck.json` beside the rundown. The file records the head it read, each cover's rank in our ranking, and whether the two agree.

The cross-check never changes a rank.
