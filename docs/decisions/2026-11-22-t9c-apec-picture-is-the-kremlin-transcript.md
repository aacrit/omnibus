# 2026-11-22: T9c: S-P4-APEC's picture is the Kremlin's English transcript, typeset (CoS decision, relayed by the coordinator)

The APEC CEO Summit video (`e35-p4-putin-apec`) exists only on kremlin.ru's Russian page. Its ledger title is Russian, and the engine's credits face (Inter, Latin) has no glyph for it, so `credits-fits` blocked (run 44988037726). The English twin page (en.kremlin.ru 81286) carries no video, so there was nothing to re-fetch.

S-P4-APEC is now a `page` graphic (`g-page-apec`), with its timing kept. It typesets L039, the reader's line, verbatim from `e35-p4-apec-read`, the Kremlin's official English text ("APEC CEO Summit"), with its quote_sha256, and it carries the dot label RELEASED BY THE KREMLIN. L039 is unchanged and still matches its hash. The video item stays in the ledger, cited by nothing. The engine's credits list only the assets of the shots that play (`credits_blocks` walks the plan's shots), so its title is no longer drawn. `credits-fits` is unchanged. Shenzhen keeps 37.93 s of footage, so the rundown's shape for it is still full. The ledger is unchanged, so its pin needed no rebuild.

The adapter's own fix, taking the English twin page's title for a Russian-only item, is the coordinator's follow-up ticket.
