# 2026-11-22: T9b: shots waiting on ticket 5 air their cleared fallback

Some of issue 35's best pictures and voices are behind ticket 5 or a capture: the SSU's Kerch video, Putin's APEC address, the Kremlin and kantei stills, gov.uk under OGL, the Office of the President's statements. Every such shot is written against a picture that is already cleared or drawn: a locator, a typeset page or a count card. The shot names its request in `picture_slot` (`request`, `awaits`, `now`, `pending_t5: true` where it applies), in the shape issue 33 used.

Every request is in `episodes/35/screenplay-requests.json`, with its class:

- `pending_t5`: waits for ticket 5's adapters.
- `to_fetch`: a request for `scripts/rights.mjs`.
- `to_capture`: a primary text to capture with its terms URL before a reader speaks it.
- `rights_read`: a NARA restriction for a reader to clear.
- `ticket_3`, `ticket_8b`: audio, owned by those tickets.

Nothing pending is in any ledger, so the draft renders on what is cleared. When the SSU video clears, the normaliser recomputes the lead's shape (34.4 s is over the cap). The lead then becomes a full package and is rewritten toward 150 s.

The requests stay out of `rundown-assets.json` so this ticket does not desynchronise `assets.json`; the sourcing ticket moves them there.
