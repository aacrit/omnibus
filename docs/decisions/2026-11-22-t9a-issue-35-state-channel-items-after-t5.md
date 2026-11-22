# 2026-11-22: T9a: issue 35's state-channel items after T5, and the record_kind redo

Ticket 5 (#42) merged into `t9a/sourcing-35`. The sourcing pass then fetched what the new adapters allow:

- **kremlin.ru (taken).** Two pinned pages:
  - **81305**, the 19 Nov news conference in Shenzhen. Its video is `news_conference` by the page's title, and the fit is Putin's answer on the Crimean Bridge, 1380 to 1535 s. Its English page is fetched as a document and recorded as an official transcript.
  - **81286**, the 18 Nov APEC CEO Summit address. The video comes from the Russian page, because the English page lists none. The fit is 110 to 130 s, and its kind is `unknown`, so it is muted. Its English page is the official transcript.
- **uastate, the SSU still (taken).** `KerchBridgeCollapse.jpg`, labelled RELEASED BY THE SECURITY SERVICE OF UKRAINE.
- **uastate, the SSU video (refused).** It is a video2commons transfer and needs a marks review. It is staged with its cuts over 0.167 to 28.8 s.
- **uastate, `FlamingoKerch.jpg` (refused).** Its only source is an X post.
- **Nothing to fetch:**
  - kremlin.ru 81303 and 81276 list no video of their own.
  - No Office of the President, SES or KMDA upload of the week exists on Commons.
  - No OGL transfer exists for the UK story.
- **kantei (skipped).** Refused until the CoS signs its terms.

T5's `record-kind` lint blocked the three videos ledgered before it, which stated no kind. They were re-fetched with `--redo` through the T5 code, which reads no kind from their titles. Each now records `unknown` and is muted. Their signed marks reviews still stood against the files' own cuts.

The arrival's nat sound is therefore muted until a checking role signs a `record_kind` for it. No sourcer signs a kind.

The news conference file on kremlin.ru's English page may carry an interpretation rather than Putin's own Russian. A checking role confirms which before any bite is cut from it.
