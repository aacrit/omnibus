# 2026-11-22: T9b: locator coordinates, pages set from verbatim text, and bumper week lines

T9c's render needs the screenplay data that T4 and T9c fixed as conventions. Three changes follow.

**Locators.** Each of the 31 locator shots now carries `locator: {places: [{name, lat, lon}], scale_km, push_s}` (docs/decisions/2026-11-22-t4-shot-field-conventions.md). Each `name` is the on-screen label in `shows.lines`, in order.

Coordinates are the standard ones in each place's Wikipedia infobox, to 2 decimals. A city takes its city coordinates. A strait or island takes its feature coordinates, a region its listed coordinates, and a country its geographic centre. There are three exceptions, each placed where the story is:

- OMAN is set at Khasab on the Musandam peninsula (26.18, 56.25), where the tanker's crew came ashore.
- MYANMAR is set at Naypyitaw (19.75, 96.13), where the government's spokesperson spoke.
- POLAND in the Echo is set at Warsaw (52.23, 21.01), because Poland's frontiers of 1945 were the question.

KYIV at S-LEAD-4 and S-LEAD-8 is now a single place. RUSSIA and DNIPRO are not single points; the narration names them. The scale bar is a round distance near the span the shot's places need: 50 km for Yalta and Hormuz, 2,000 km for London and Washington.

**Pages.** A page typesets a record's own words, or it is not a page. T9c's shape is `page: {source_id, title, body, source}` (docs/decisions/2026-11-22-t9c-page-renderer-verbatim-or-refused.md). The hashes and locator ride beside it.

- S-P4-3 and S-P4-4: points 3 and 4 of the declaration, from the fetched White House page (`e35-p4-declaration`).
- S-EC-5: the Polish Government's statement, paragraphs 4 and 5 (`src-frus-1945v05-d111`).
- S-EC-6: Churchill in the Commons (`src-hansard-1945-02-27`).
- S-EC-7: Roosevelt's address (`src-app-fdr-1945-03-01`).

Every body string hashes to the quote the reader speaks, from the fetched page or the echo bank.

S-EC-2 and S-EC-3 carried only narration, and the communique's text is not held verbatim, only its sha256. So they become umber maps: S-EC-2 is GERMANY and S-EC-3 is POLAND. S-EC-8 carried only the signatures, which were never fetched as text, so it becomes the map of YALTA, the Echo's last frame. S-EC-ROOM holds that map. The narration is unchanged, and every voiced second still has a picture. The Echo's period documents are the three typeset texts; `echo-pick.json` says the communique is not typeset in this issue.

**Bumpers.** T4's `bumper_spec` wants `[word, week_line]`, and the Echo's bumper also takes its year.

- The briefs bumper prints `ISSUE 35   16 TO 21 NOV 2026`, its figures held to `week.json` (`issue` and `window.from_day`).
- The Echo's bumper prints `ISSUE 35` and `1945`. A 2026 date inside the Echo would break its own horizon (`as-of`).
