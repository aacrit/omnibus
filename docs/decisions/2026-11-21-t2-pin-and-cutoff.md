# 2026-11-21: T2: the pin, the cutoff and the window

- **Window.** `--from` and `--to` set the week, as UTC dates, both days included. Issue 35 runs from 16 to 21 Nov 2026, by the founder's ruling of 2026-11-21 (relayed by the coordinator): the programme does not wait for Sunday's print or for the weekly edition.
- **Pin.** The first commit on void news's main history whose `frontend/build-data/archive.json` holds the `--to` day's print (bible k: the first commit that contains the closing day's print).
  - If no commit holds it yet, the pin is the newest commit that touches archive.json, and the desk lists the days it lacks.
  - `--at` only bounds the history searched, so a rebuild at the pin, or at any later head, finds the same pin.
- **Cutoff.** The pinned commit's committer time, in UTC (bible k: the horizon is the pinned commit's timestamp). The time of the edition's last printed row is kept beside it as `last_print_utc`.
  - Issue 35: pin b8dcf8752b2ddbb903c3e9a0ed05f29d3a98d82c, cutoff 2026-11-21T14:17:37Z, rows printed at 14:07:07Z.
- **Rebuild.**
  - desk.json and rundown.json depend only on the pin and the episode's own files: rundown-edit.json, rights-ledger.json and the capture pool. The rundown records each file's path and sha256.
  - Nothing reads the clock. The rights lints check that a captured-at time is not in the future; that check is given a fixed far-future time.
