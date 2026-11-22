# 2026-11-21: T2: brief mentions are read from brief.json's history

The brief-mentions signal (0.20) counts void news's daily TL;DR briefs (`daily_briefs` in its database) that list one of a thread's clusters or share two title words with it. That database is not public. The repo commits only the current brief, as `frontend/public/data/brief.json`.

The desk reads that file's history:

1. It reads every version committed from the day before the window up to the pin.
2. It keeps one version per brief id: the last one read.
3. It counts the world edition's briefs that were created inside the window and by the cutoff.

A brief that void news wrote and then replaced between two commits is not seen. That is the record the archive holds, and it rebuilds the same from the pin.
