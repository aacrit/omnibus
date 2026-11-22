# 2026-11-22: T9a: issue 35's videos wait for a verifier's marks review; staged copies sit outside the ledger

Every in-week US federal video found for issue 35 is a Commons transfer made with video2commons or tagged "Videos from YouTube". These include the White House's Shenzhen arrival and trilateral-talks records and the Department of War's Caracas address. The fetcher refuses each one until a reviewed `marks_checked` record exists (`marksProblems`, S4 review). The first fetch of 2026-11-22 recorded those refusals in the ledger's `rejected` list. It took 2 stills and 2 White House documents.

Nobody in the sourcing pass signs a marks review; that is the verifier's role. The verifier needs the file to look at, so the sourcing pass staged the three fitted videos:

- **Where.** In `D:/omnibus-media/35/review/` (`OMNIBUS_MEDIA/<issue>/review`), outside the repo and outside the ledger.
- **How they were fetched.** Through the fetcher's own `lookup()` and `getMedia()`: the honest User-Agent, allowlisted hosts, one download at a time, and a sha1 checked against Commons.
- **Cuts.** Found with `scripts/lib/rights/scenes.mjs` over each fit span (threshold 0.2, `-threads 2`).
- **Records.** `staged.jsonl` and `cuts.jsonl` beside the files list each one.

A staged file is never aired, and it counts for nothing in `footage_cleared_s`.

After the verifier signs, the sourcing pass works through these steps:

1. Copy each review into its pin as `marks_checked`.
2. Run `node scripts/rights.mjs fetch 35 --media D:/omnibus-media --redo e35-p4-arrival,e35-p4-talks,e35-b8-caracas`. The fetch step finds the cuts again in the file it downloads, as it always does.
3. Re-run the normaliser.

The 20 Nov White House news conference was staged, then deleted. It is in Washington, not Shenzhen. Every sampled frame carries a burned-in call to action ("TEXT POTUS TO 45470" and a QR code), which bible n refuses unless masked and alteration-marked. Masking it is a ruling for the CoS, not a sourcing call.

Items that need ticket 5's adapters are listed under `pending_t5` in the candidates files, with their metadata. They were not staged or fetched:

- kremlin.ru on Commons: Putin's APEC speech and the trilateral stills.
- Ukraine's state sources on Commons: the SSU's Kerch strike video and its stills.
- kantei.go.jp.
- OGL v3 for gov.uk.
