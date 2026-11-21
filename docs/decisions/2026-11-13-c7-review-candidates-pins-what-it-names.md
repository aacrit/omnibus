# 2026-11-13: C7 review: candidates pins what it names

On review of cap/c6-c7. `rights.mjs candidates <n>` pins every captured item its pins name, so a proxy outlives the 14-day sweep until the episode airs plus 30 days (`--airs-on <date>`; without it, until a date is set; `--no-pin` skips). It writes the pin request `capture/pins/<n>.json` and, on R2's S3 API, pins the index at once with a conditional write (If-Match, retried on a lost race); every capture run applies every pin request before it sweeps, so a pin is never lost to a race with a run.
