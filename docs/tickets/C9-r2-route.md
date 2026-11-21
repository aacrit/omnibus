# C9: the Actions draft's private R2 route

**Status:** not started. The route is off (CoS decision 2026-11-13, C8 re-review). Today
`.github/workflows/episode-draft.yml` uses short-lived workflow artifacts only, and refuses an episode with any
rights-ledger item that is not PD, CC or our own property. `scripts/ci/r2.sh` and `r2CapProblem`
(`scripts/lib/draft-outputs.mjs`) stay in the tree, unreachable.

**Why it is off.**
- Its cap could be passed. The graphics, narration and sources jobs upload their hand-offs in parallel, and each one
  reads the same `render/` size before writing. Together they could put about three times the cap in the bucket,
  and R2 bills past its free tier.
- It has never run: no R2 secrets are set, and the bucket does not exist yet.

**Done when** each item below has a test, and one R2 run has gone through end to end.

1. **One writer, or shares.** Make the cap hold under concurrency. Either one job writes to R2 (the stage jobs hand
   off through artifacts only when every item is public, or a single uploader job runs after them), or each
   stage gets its own fixed share of `cap_gib` and checks only against that share.
2. **Measured sizes.** List sizes with `aws s3api list-objects-v2 --prefix render/ --query 'sum(Contents[].Size)'`,
   reading a missing `Contents` (an empty prefix, `None`) as 0. Anything else that is not a whole number
   refuses the upload. A test runs `r2.sh` against a stub `aws` on PATH (empty prefix, a number, `None`,
   garbage).
3. **The cap from the default branch.** Read `cap_gib` from `budget.yaml` on the default branch (`git show
   origin/main:budget.yaml`), not the dispatched ref, so a branch cannot raise its own cap.
4. **Bounded deletes.** `r2.sh rm` refuses any prefix that does not match
   `^render/[0-9]{1,4}/([0-9]+/stage/)?$`.
5. **Prune after publish.** An issue's earlier renders are deleted only after this run's outputs are fully
   uploaded and its manifest is verified, never before.
6. **What goes to R2 at all.** The 120 s slice's outputs measured 2.5 GiB, and a whole film with `--layers` (ProRes
   plates) is far bigger. Both are over the 1 GiB planned share. Decide which files go private, for example the
   master and stems only, with layers rebuilt on the laptop, or raise the share against the account's other
   shares (budget.yaml `r2_storage_gb`).
7. **Founder approvals.** The bucket `omnibus-capture`, the R2 secrets, and the CLAUDE.md data line for this R2 use.
