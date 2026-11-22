# Issue 35 footage and primary sources (T9a)

The sourcing pass of 2026-11-22 ran against the pin b8dcf87, with the cutoff at 2026-11-21T14:17:37Z. It read the rights ledger after the redo fetch of 2026-11-22, which followed the verifier's three marks reviews (verifier: claude-sonnet-5, 2026-11-22T01:00:00Z). Requests are in `rundown-assets.json`, pins and searches in `candidates/<story>.json`, and the fetcher's own record in `ASSETS.md` and `rights-ledger.json`.

**Cleared** means the ledger holds the item and every blocking lint passes, so it counts in `footage_cleared_s`. **Awaiting review** means the item is fitted and staged with its cuts found, but no marks review has been signed yet; none is left in that state.

## Summary

| Slot | Story | Cleared moving picture | Awaiting marks review | Pending T5 | SOT bites available | Documents | Gaps |
|---|---|---|---|---|---|---|---|
| lead | ukraine-bridges-strikes | 0 s | 0 s | 34.4 s: the SSU's Kerch strike video (CC BY 4.0, RELEASED BY THE SSU), plus 2 stills | none | SSU statement (pending T5); Zelenskyy statements (pending T5, president.gov.ua 403); Russian MoD statement (to locate, typeset as a state record); Poland's statement (to locate, gov.pl terms unreviewed) | No free picture of the 20 Nov Kyiv strike or of Poland by the cutoff. No Russian-side picture. Clears the 30 s cap only once T5 lands and the SSU file's fit keeps 30 s or more. |
| package_2 | uk-eu-reset | 0 s | 0 s | gov.uk video and texts under OGL v3, not yet located | none | Burnham's Brexit speech, 16 Nov (pending T5, OGL); the UK and EU agreements, 20 Nov (gov.uk pending T5; EU text on a host outside the allowlist) | No free moving picture with the adapters that exist. The Commission's audiovisual service is not a fetcher host. |
| package_3 | gulf-us-iran | 0 s | 0 s | none | none | CENTCOM statements on Qeshm (centcom.mil answered 403); Iran's foreign ministry statement (to locate) | No video of the strikes, intercepts, drones or tanker on DVIDS or Commons. One still cleared: USS Theodore Roosevelt enters the 5th Fleet, 17 Nov (DVIDS, PD). |
| package_4 | shenzhen-summit | **37.93 s**: arrival ceremony 45 to 70 s (25 s, raw pool, nat sound); trilateral talks 0 to 12.93 s (produced, mute B-roll) | 0 s | Putin's APEC Business Summit speech (1177.7 s record, CC BY 4.0, RELEASED BY THE KREMLIN); 5 Kremlin stills; kantei stills | Putin, APEC address, 18 Nov: record 1177.7 s (pending T5 and the transcript step). Trump: none clean. | The declaration, White House text of 19 Nov (**fetched**); the Kremlin's English text (pending T5) | No Chinese-side picture; Xi is a page or attributed. One still cleared: Trump and Putin, 19 Nov (White House, PD). Shape `full` (37.93 s, over the 30 s cap). |
| package_5 | thread-ec790a82 (ICJ) | 0 s | 0 s | none | none | The judgment in The Gambia v. Myanmar, 19 Nov; the Court's press release; Myanmar's rejection, 20 Nov (to locate). All typeset; icj-cij.org is not a fetcher host. | No free moving picture. UN Web TV is refused, and the ICJ's picture terms are unreviewed. A document package. |
| brief_1 | thread-a3e1e3ef (Houthis, Riyadh) | 0 s | 0 s | none | none | none named | Nothing filmed on a free source. |
| brief_2 | thread-833e5c6b (FAA ground stop) | 0 s | 0 s | none | none | none named | The White House briefing on the ground stop is dated 13 Nov, before the week (not taken). |
| brief_3 | thread-149f229b (United outage) | 0 s | 0 s | none | none | none named | Nothing free. |
| brief_4 | thread-b1206893 (cyber director) | 0 s | 0 s | none | none | The White House release naming Kirsten Davies, 20 Nov (**fetched**) | No picture. |
| brief_5 | thread-3d743169 (Mamdani, NYPD) | 0 s | 0 s | none | none | none named | New York City's video terms are unreviewed. |
| brief_6 | canada-china-tariffs | 0 s | 0 s | none | none | none named | Nothing of the agreement. |
| brief_7 | greenland-security-deal | 0 s | 0 s | none | none | none named | Folketing terms are unreviewed. |
| brief_8 | thread-1c145f33 (US and Venezuela) | **12 s**: Hegseth at the lectern, Caracas, 18 Nov (DoW, raw address, 15 to 27 s, muted) | 0 s | none | Hegseth, Caracas address, 18 Nov: record 1259.8 s (a brief takes no bite) | none named | VTV and La Iguana TV uploads are refused (laundering rule). |
| brief_9 | thread-3c336fd7 (Epstein autopsy) | 0 s | 0 s | none | none | none named | Nothing free. |
| brief_10 | thread-1a2c9331 (Knesset speaker) | 0 s | 0 s | none | none | none named | Entered when the ICJ became package 5. Not searched by name. |

## Footage share against 13:30 (810 s)

| State | Moving picture | Share |
|---|---|---|
| Cleared now (after the three marks reviews) | 49.93 s | 6.2% |
| Plus T5 (SSU 34.4 s; about 25 s from Putin's address) and their reviews | about 109 s | about 13% |
| Plus the Echo's film at bible q's 85 s (T8, not sourced here) | about 194 s | about 24% |

That is far below the 60 to 80% target and below bible q's estimate of 43 to 55%. Most of the week's free picture of the Ukraine lead and the Gulf is party-released material behind ticket 5, or does not exist on a free source. Nothing is padded.

## Verifier marks reviews (signed 2026-11-22T01:00:00Z, all three stood)

Each item is staged in `D:/omnibus-media/35/review/`. The cuts below were found with `scripts/lib/rights/scenes.mjs` at threshold 0.2 over the fit span. The redo fetch found the same cuts in the files it downloaded, and no review was marked for a re-sign.

| Request | Staged file (sha256) | Span | Cuts in span |
|---|---|---|---|
| e35-p4-arrival | e35-p4-arrival.webm (63dd396f...762e) | 45 to 70 s | none (one shot) |
| e35-p4-talks | e35-p4-talks.webm (2094dc14...f3c3) | 0 to 12.93 s | 0.751, 2.252, 3.837, 4.588, 5.339, 6.757, 7.966, 9.468, 9.885, 10.969 |
| e35-b8-caracas | e35-b8-caracas.webm (d3e95d3c...937c) | 15 to 27 s | none |

After T5 lands, two more need reviews: the SSU Kerch video and Putin's APEC address.

## Not taken, and why

- **20 Nov White House news conference.** Washington, not Shenzhen, and a burned-in CTA banner with a QR code.
- **"Addresses Historic Trilateral Meeting".** A vertical social edit with a title banner and captions.
- **The X copy of the talks.** A duplicate of the White House transfer.
- **Kanal13's Shenzhen clips.** Agency pool (AP).
- **TASS photo.** An agency.
- **Hegseth's Lincoln message.** Dated 7 Oct, and not a fit.
- **The Mullin and Duffy FAA briefing.** Dated 13 Nov.
- **C-SPAN items.** Committee camera coverage.
- **VTV and La Iguana TV.** Venezuelan media marked public domain.

The capture pool has no issue-34 or issue-35 pool, so `rights.mjs candidates 35` found nothing to map (R2: no pool; artifact: none of the last runs). The capture index of run 44933588497 held only locators for this week's stories.
