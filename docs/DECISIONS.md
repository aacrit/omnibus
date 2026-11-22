# Decisions

This file is a one-time, static index. It is never appended to again (a lint,
`scripts/lint-decisions.mjs`, fails the gate if it is): a shared append-only
log conflicted on every PR. A new decision is its own file instead,
`docs/decisions/YYYY-MM-DD-<slug>.md`, added with the PR that makes the
decision; that file never touches this one, so it is not a conflict magnet.

Entries recorded before the split (2026-11-21) were migrated verbatim, one per
file, into `docs/decisions/`. The list below is historical and fixed; for
anything decided since, read the directory itself (sorted by filename, which
sorts by date).

- [2026-11-11: G1 greenlight approved](decisions/2026-11-11-g1-greenlight-approved.md)
- [2026-11-11: success event `episode_completed`; the Spark unit counts as `week_opened`](decisions/2026-11-11-success-event-episode-completed-the-spark-unit-counts-as-week-opened.md)
- [2026-11-11: week 32 record and its rules](decisions/2026-11-11-week-32-record-and-its-rules.md)
- [2026-11-11: faces and tokens](decisions/2026-11-11-faces-and-tokens.md)
- [2026-11-11: rate-limit namespace 7601](decisions/2026-11-11-rate-limit-namespace-7601.md)
- [2026-11-11: custom domain, and Dial's contract runner](decisions/2026-11-11-custom-domain-and-dial-s-contract-runner.md)
- [2026-11-12: release/2026.11.12-1, Spark stub live](decisions/2026-11-12-release-2026-11-12-1-spark-stub-live.md)
- [2026-11-12: daily snapshot of void news (T1, Studio stage 1)](decisions/2026-11-12-daily-snapshot-of-void-news-t1-studio-stage-1.md)
- [2026-11-12: snapshot review fixes (supersedes parts of the entry above)](decisions/2026-11-12-snapshot-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-12: studio/house/document/, and a fast/full split for the lifted engine's suite](decisions/2026-11-12-studio-house-document-and-a-fast-full-split-for-the-lifted-engine-s-su.md)
- [2026-11-12: studio-test's real CI timings, every test tweak, and main's branch protection (supersedes parts of the entry above)](decisions/2026-11-12-studio-test-s-real-ci-timings-every-test-tweak-and-main-s-branch-prote.md)
- [2026-11-12: G2 design sign-off](decisions/2026-11-12-g2-design-sign-off.md)
- [2026-11-12: rights ledger, fetcher and dispute packet in Node (T2, Studio stage 8)](decisions/2026-11-12-rights-ledger-fetcher-and-dispute-packet-in-node-t2-studio-stage-8.md)
- [2026-11-12: rights review fixes (supersedes parts of the entry above)](decisions/2026-11-12-rights-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-12: week 33 record, record schema 2, and the --echo option](decisions/2026-11-12-week-33-record-record-schema-2-and-the-echo-option.md)
- [2026-11-12: issue 33's Echo is Korea 1952; the no-bridge reading, and party names](decisions/2026-11-12-issue-33-s-echo-is-korea-1952-the-no-bridge-reading-and-party-names.md)
- [2026-11-12: the lead's claim, the board's rows, and untitled rungs (review of PR #11)](decisions/2026-11-12-the-lead-s-claim-the-board-s-rows-and-untitled-rungs-review-of-pr-11.md)
- [2026-11-12: week 33 assets (E5): federal hosts, Wayback witnesses, T2c, and the resolver](decisions/2026-11-12-week-33-assets-e5-federal-hosts-wayback-witnesses-t2c-and-the-resolver.md)
- [2026-11-12: E5 review fixes (supersedes parts of the entry above)](decisions/2026-11-12-e5-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-12: E5 re-review: a picture's own caption, and the publication time (corrects the entry above)](decisions/2026-11-12-e5-re-review-a-picture-s-own-caption-and-the-publication-time-corrects.md)
- [2026-11-12: E5b: void news's own pages, honest 403s, DVIDS by its documented fields](decisions/2026-11-12-e5b-void-news-s-own-pages-honest-403s-dvids-by-its-documented-fields.md)
- [2026-11-12: E5b review fixes (supersedes parts of the entry above)](decisions/2026-11-12-e5b-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-12: E5c: DVIDS against the live API (supersedes the DVIDS parts of the E5b entries)](decisions/2026-11-12-e5c-dvids-against-the-live-api-supersedes-the-dvids-parts-of-the-e5b-e.md)
- [2026-11-13: E5c review fixes (supersedes parts of the entry above)](decisions/2026-11-13-e5c-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-12: week 33 screenplay (E4 part 2): CoS delegation, writer](decisions/2026-11-12-week-33-screenplay-e4-part-2-cos-delegation-writer.md)
- [2026-11-12: week 33 screenplay, review fixes (PR #18; supersedes parts of the entry above)](decisions/2026-11-12-week-33-screenplay-review-fixes-pr-18-supersedes-parts-of-the-entry-ab.md)
- [2026-11-12: week 33 screenplay, re-review fix (PR #18)](decisions/2026-11-12-week-33-screenplay-re-review-fix-pr-18.md)
- [2026-11-13: E9i: the engine reads omnibus's own ledgers](decisions/2026-11-13-e9i-the-engine-reads-omnibus-s-own-ledgers.md)
- [2026-11-13: E9i review fixes (supersedes parts of the entry above)](decisions/2026-11-13-e9i-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-12: E6 graphics generator - Chromium as a build tool, the week-32 regression metric, and two net-new compositions](decisions/2026-11-12-e6-graphics-generator-chromium-as-a-build-tool-the-week-32-regression.md)
- [2026-11-12: E6 review fixes (supersedes parts of the entry above)](decisions/2026-11-12-e6-review-fixes-supersedes-parts-of-the-entry-above.md)
- [2026-11-13: E9j: the integration branch the first draft renders from](decisions/2026-11-13-e9j-the-integration-branch-the-first-draft-renders-from.md)
- [2026-11-13: E4c: week 33 tightened and made footage-first (issue 33)](decisions/2026-11-13-e4c-week-33-tightened-and-made-footage-first-issue-33.md)
- [2026-11-13: E5d: real footage policy (founder ruling, relayed by the coordinator)](decisions/2026-11-13-e5d-real-footage-policy-founder-ruling-relayed-by-the-coordinator.md)
- [2026-11-13: S3: NARA's possibly-copyright flag on federal film; pins outside the ladder; date records (supersedes the E5d NARA line above for Signal Corps items)](decisions/2026-11-13-s3-nara-s-possibly-copyright-flag-on-federal-film-pins-outside-the-lad.md)
- [2026-11-13: S4: ruling A (picture published by the edition), fair use stays in The Weight, war.gov and state.gov](decisions/2026-11-13-s4-ruling-a-picture-published-by-the-edition-fair-use-stays-in-the-wei.md)
- [2026-11-13: E4d: the pilot cut (issue 33)](decisions/2026-11-13-e4d-the-pilot-cut-issue-33.md)
- [2026-11-13: S4 rights fix 4: a video's cuts come from the file; e33-day2-pic airs 0 to 14.5 s only (CoS ruling)](decisions/2026-11-13-s4-rights-fix-4-a-video-s-cuts-come-from-the-file-e33-day2-pic-airs-0.md)
- [2026-11-13: C8: the CPU-heavy draft runs on GitHub Actions (episode-draft.yml)](decisions/2026-11-13-c8-the-cpu-heavy-draft-runs-on-github-actions-episode-draft-yml.md)
- [2026-11-14: C8: our own pages reach Actions as the laptop's exact bytes (own-pages-<issue> release; CoS decision)](decisions/2026-11-14-c8-our-own-pages-reach-actions-as-the-laptop-s-exact-bytes-own-pages-i.md)
- [2026-11-14: C8: the draft mixes the laptop's finished score (own-score-<issue> release; CoS decision)](decisions/2026-11-14-c8-the-draft-mixes-the-laptop-s-finished-score-own-score-issue-release.md)
- [2026-11-14: C8 review hardening (after the first full draft, run 43540458640)](decisions/2026-11-14-c8-review-hardening-after-the-first-full-draft-run-43540458640.md)
- [2026-11-21: T8, the echo bank's settlement entries](decisions/2026-11-21-t8-the-echo-bank-s-settlement-entries.md)
- [2026-11-21: T8, retargeted onto main (plumbing; tag unmoved)](decisions/2026-11-21-t8-retargeted-onto-main-plumbing-tag-unmoved.md)
- [2026-11-13: C0: the capture hosts probed once from GitHub Actions](decisions/2026-11-13-c0-the-capture-hosts-probed-once-from-github-actions.md)
- [2026-11-13: C1: NOAA is a federal publisher](decisions/2026-11-13-c1-noaa-is-a-federal-publisher.md)
- [2026-11-13: C2: the capture listers](decisions/2026-11-13-c2-the-capture-listers.md)
- [2026-11-13: C6: the capture workflow, its stores and NASA's terms page](decisions/2026-11-13-c6-the-capture-workflow-its-stores-and-nasa-s-terms-page.md)
- [2026-11-13: C7: the weekly capture pool and its candidates](decisions/2026-11-13-c7-the-weekly-capture-pool-and-its-candidates.md)
- [2026-11-13: C6 review: NOAA from its feed text, refused hosts, bucket-scoped R2 keys](decisions/2026-11-13-c6-review-noaa-from-its-feed-text-refused-hosts-bucket-scoped-r2-keys.md)
- [2026-11-13: C7 review: candidates pins what it names](decisions/2026-11-13-c7-review-candidates-pins-what-it-names.md)
- [2026-11-13: C6/C7 review follow-ups: bytes, reconcile, retries, dignity excludes](decisions/2026-11-13-c6-c7-review-follow-ups-bytes-reconcile-retries-dignity-excludes.md)
- [2026-11-13: C6/C7 go-live fixes](decisions/2026-11-13-c6-c7-go-live-fixes.md)
- [2026-11-21: T3, audio routing (show bible v2 j)](decisions/2026-11-21-t3-audio-routing.md)
