# 2026-11-21: T2: what footage_cleared_s counts

`footage_cleared_s` is the number of seconds of ledger footage that a story may air as moving picture. It is read from `episodes/<n>/rights-ledger.json` and from the week's capture pool (`--pool`).

An item counts only when all of these hold:

- It is `kind: footage`, and the ledger passes its schema.
- No blocking rights lint refuses it: licence-allowlist (with the marks review), licence-evidence, ai-generated-share-zero.
- It is not fair use, which is refused (bible n).
- Its fit is not an automatic one that nobody confirmed (`unconfirmedFit`, C7).
- It belongs to the story, in one of two ways:
  - its `fit.beat` is the story key or one of the story's cluster ids;
  - the capture pool holds it (the same `item_url`, or the same file by sha256) under a pool story that shares one of the story's clusters.

How the seconds are counted:

- An item counts for its fit's aired span (`out_s - in_s`), or else for its reviewed duration.
- An item with neither is listed under `footage.no_duration` and counts 0.
- Each file (by sha256) counts once per story.

For each story, the rundown lists what counted, what was refused and why, and what is unconfirmed.

This is the rundown's planning figure. The `footage-cap` lint (ticket 6) still checks the screenplay's own shots and their sound.

Issue 35 has no ledger and no pool yet, so every story reads 0 s, and the rundown says so in `notes`.
