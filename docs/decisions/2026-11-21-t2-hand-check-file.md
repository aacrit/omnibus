# 2026-11-21: T2: the hand check of threads is episodes/<n>/rundown-edit.json

Bible k asks the rundown step to check each thread's members by hand. A package may bundle clusters from different threads only with a written `thread_reason`.

The file `episodes/<n>/rundown-edit.json` (`omnibus.rundown-edit/1`) holds those checks as an ordered list:

- `split`: the named clusters leave the thread void news filed them in and become one story, under its `key` (default `cluster-<id8>`).
- `join`: the named clusters become one story under the given `key`, whatever threads they were in. The join's reason becomes the story's `thread_reason`.

Rules for the checks:

- Every check needs a reason of 12 characters or more.
- The normaliser refuses a story that bundles two threads unless a join gives the reason.
- A cluster can be named by either id, whole or by an unambiguous prefix:
  - its cluster id (`source_cluster_id`), which void news's briefs and weekly use;
  - the id of one of its printed rows (archive.json `id`), which the analyst brief and bible q quote.
- Each check is recorded in the rundown's `thread_checks`, with the threads it moved clusters from.

The same file carries the editorial fields the rundown step writes:

- `stories.<key>`: slug, place, parties, entities, primary_sources, mechanisms;
- `tease`, `briefs_order` and `echo`.

A story ref is the story's `key`, because slugs are written after the ranking exists. Where the file gives no editorial fields, the normaliser writes nulls and empty lists, and `rundownProblems(..., { final: true })` lists what is still unwritten.
