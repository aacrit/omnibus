# Issue 35 footage and primary sources (T9a)

This file is the sourcing pass against the pin b8dcf87 (cutoff 2026-11-21T14:17:37Z), updated on 2026-11-22. That update came after ticket 5 (#42) merged the kremlin, uastate and kantei adapters and OGL v3. Where each record lives:

- **Requests:** `rundown-assets.json`.
- **Pins and searches:** `candidates/<story>.json`.
- **The fetcher's record:** `ASSETS.md` and `rights-ledger.json` (with two official transcripts).

**Cleared** means the ledger holds the item and every blocking rights lint passes. It is the figure `footage_cleared_s` counts, the sum of each item's fit span. A fit span is the most that may air, not what the screenplay will cut.

## Summary

| Slot | Story | Cleared moving picture | Awaiting a signed review | SOT bites available | Documents | Gaps and refusals |
|---|---|---|---|---|---|---|
| lead | ukraine-bridges-strikes | **183.633 s**: Putin's 19 Nov news conference (kremlin.ru), his answer on the attacks on the Crimean Bridge, 1380 to 1535 s (155 s); the SSU's Kerch strike video, 0.167 to 28.8 s (28.633 s, RELEASED BY THE SECURITY SERVICE OF UKRAINE, kind `unknown`, muted; marks review signed 2026-11-22T03:30:00Z) | none | Putin, news conference, 19 Nov: `news_conference` from the page's title, with an official English transcript in the ledger; the bite is cut inside 1380 to 1535 s at sentence bounds | The Kremlin's English transcript of 19 Nov (**fetched**): "following the strikes on the Crimean Bridge, there will be no negotiations". The SSU still KerchBridgeCollapse.jpg (**fetched**, RELEASED BY THE SECURITY SERVICE OF UKRAINE) | **FlamingoKerch.jpg refused**: its only source is the President's X post, not president.gov.ua. No Zelenskyy statement or video on a Commons upload in the week. No SES or KMDA footage of the 20 Nov Kyiv strike. kremlin.ru 81276 (17 Nov bridge update) has no video. |
| package_2 | uk-eu-reset | 0 s | 0 s | none | none reachable | No OGL transfer on Commons of the speech, the summit or the agreements. T5 built no gov.uk adapter, because gov.uk video is YouTube embeds. |
| package_3 | gulf-us-iran | 0 s | 0 s | none | CENTCOM (403) and Iran (to locate) | No video of the week's events. One still: USS Theodore Roosevelt enters the 5th Fleet, 17 Nov (DVIDS). |
| package_4 | shenzhen-summit | **57.93 s**: arrival 45 to 70 s (25 s); Putin's APEC CEO Summit address 110 to 130 s (20 s, kremlin.ru); trilateral talks 0 to 12.93 s (12.93 s) | none for the fetcher (see the review list) | Putin, APEC CEO Summit address, 18 Nov, 1177.7 s, with an official English transcript in the ledger. Its `record_kind` is `unknown` (the title "Деловой саммит форума АТЭС" does not state it), so it airs muted until a checking role reviews the kind. | The declaration, White House text (**fetched**); the Kremlin's English APEC transcript (**fetched**) | kantei skipped: refused until the CoS signs its terms. kremlin.ru 81303 (trilateral meeting) lists no video. No Chinese-side picture. |
| package_5 | thread-ec790a82 (ICJ) | 0 s | 0 s | none | the judgment, the press release, Myanmar's rejection (typeset; not fetcher hosts) | No free moving picture. |
| brief_4 | thread-b1206893 | 0 s | 0 s | none | the White House release (**fetched**) | |
| brief_8 | thread-1c145f33 | **12 s**: Hegseth, Caracas, 15 to 27 s | 0 s | (a brief takes no bite) | | VTV and La Iguana TV refused |
| other briefs | | 0 s | 0 s | none | | as in the candidates files |

### Ledger changes

- The three videos ledgered before ticket 5 were re-fetched (`--redo`) so that they state `record_kind`. Its new lint blocks footage without one.
- The commons adapter reads no kind from "Participates in ... Arrival Ceremony", "Hold Trilateral Talks" or "Full Address at", so all three are `unknown` and muted.
- The arrival's nat sound therefore does not air until a checking role reviews its kind.
- Their marks reviews stood against the files' own cuts again, with no re-sign.

## Footage share against 13:30 (810 s)

| State | Moving picture | Share |
|---|---|---|
| Cleared now, by fit span | 253.563 s | 31.3% |
| Cleared now, as it would plausibly air | about 144 s | about 18% |
| Plus the Echo's film at bible q's 85 s (T8, not sourced here) | about 229 s | about 28% |

The "plausibly air" row counts the lead's news conference as one 20 s bite, not its 155 s answer span. It counts the APEC address as one 20 s bite, and the arrival, talks and Caracas spans as fitted. The share is still well under the 60 to 80% target and under bible q's 43 to 55%. Nothing is padded.

## Reviews needed from a checking role

**Marks review (the fetcher requires it): signed.** The verifier's review (verifier: claude-sonnet-5, 2026-11-22T03:30:00Z, 15 frames) is in the pin as given. Its marks: "SSU bug (СЛУЖБА БЕЗПЕКИ УКРАЇНИ), top-left in every frame: the credited source". Its note: "no identifiable remains; impact at a distance, no graphic detail". The redo fetch found the same cuts, and the review stood with no re-sign.

| Request | File (sha256) | Span | Cuts in span (found by scenes.mjs, threshold 0.2) |
|---|---|---|---|
| e35-lead-ssu-video | `D:/omnibus-media/35/review/e35-lead-ssu.webm` (6073b1e4...f825) | 0.167 to 28.8 s | 22.99, 24.491, 26.994 |

The SSU's own bug sits top left in every sampled frame. Its title card (before 0.167 s) and its end card (from about 28.8 s) are outside the span.

**Marks review for the vision pass.** The fetcher does not require these, because kremlin.ru files are not YouTube copies. They are the ledger's own files.

| Request | File (sha256) | Span | Cuts in span |
|---|---|---|---|
| e35-lead-putin-presser | `D:/omnibus-media/35/e35-lead-putin-presser.mp4` (b8a7a3e7...de15) | 1380 to 1535 s | 1385.32, 1396.76, 1401.68, 1407.2, 1412.96, 1417.16, 1436.56, 1446.96, 1455.76, 1493.68, 1498.04, 1503.04, 1526.92, 1532.64 |
| e35-p4-putin-apec | `D:/omnibus-media/35/e35-p4-putin-apec.mp4` (dcbf2045...6f60) | 110 to 130 s | 126.48, 128.04 |

**Signed `record_kind` reviews.** A pin's `record_kind: { kind, by, at, why }` comes from a verifier, the CoS or the founder, never the sourcer.

- **e35-p4-putin-apec:** an address on its occasion. Without the review, no bite can come from it.
- **e35-p4-arrival:** the kind of an arrival ceremony's raw feed. Without it, its nat sound stays muted.
- **e35-lead-putin-presser:** the page's title already gives `news_conference`. Before a bite, the reviewer should confirm whether the English page's file carries Putin's own Russian sound or an interpretation. The Russian page lists its own 1.9 GB file.

## Refused or skipped

- **FlamingoKerch.jpg:** uastate refuses it, because its source is x.com/ZelenskyyUa, not president.gov.ua.
- **kantei stills:** skipped. The adapter refuses them until the CoS signs kantei's terms.
- **kremlin.ru 81303 and 81276:** the pages list no video of their own.
- **Earlier refusals:** the CTA-bannered news conference, the produced vertical clip, Kanal13, TASS, VTV, La Iguana TV, C-SPAN, and items dated before the week. See the candidates files.
- **centcom.mil and war.gov:** both answered 403 to the honest request. Not retried.

Every request carried the fetcher's User-Agent, `void-omnibus-rights/1 (+https://omnibus.voidvision.org; asset fetcher, one request at a time)`, with no email in any header. Downloads ran one at a time. kremlin.ru was read over plain http under T5's ruling, which pins every file by sha256.
