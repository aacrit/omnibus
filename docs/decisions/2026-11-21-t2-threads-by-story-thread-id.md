# 2026-11-21: T2: the desk's threads are void news's story_thread_id, then a hand check

Bible k says the normaliser "reruns void's weekly score ... and stores the score per thread". But void news's weekly edition does not group threads by `story_thread_id`. `weekly_digest_generator.py` links the week's printed rows with TF-IDF and sklearn's agglomerative clustering (distance 0.70). Node cannot reproduce that byte for byte, and its output drifts with the sklearn version.

The desk (`scripts/lib/rundown2.mjs` `buildDesk`) therefore groups the window's printed rows by `story_thread_id`. That is the thread archive.json records, and the field `one-thread-per-package` names. Each thread is scored with void news's six signals and weights unchanged (`_build_threads`, `_score_weekly_threads`):

- each signal is divided by its maximum over the week, and a maximum of 0 is read as 1;
- a row without a summary is dropped;
- `rank_world` is the headline rank;
- edition spread is 1 for every thread, because every printed row is the world edition.

Two weekly editions exist for printed weeks, and both were checked:

- **Week 33:** the two covers come out at our ranks 1 and 2 (`tests/fixtures/rundown/week-33/weekly-crosscheck.json`).
- **Week 34:** the covers come out at our ranks 4 and 2.

The difference comes from the linker. The cross-check log records it whenever a weekly edition arrives.

`desk.json` keeps the raw score for each thread. The rundown's stories are the hand-checked groups from `rundown-edit.json` (see the hand-check decision), scored again by the same formula over those groups. A join changes a story's cumulative sources and days, and so it changes every maximum.
