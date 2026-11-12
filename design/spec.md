# void omnibus: design spec (Blueprint, for G2)

Studio designer, 2026-11-11, overnight under the founder's delegation. Sources: `CHARTER.md`, `docs/DECISIONS.md`, the Spark handoff and page, the G1 brief and the show bible (sections b, c, k), and Ink & Momentum. The founder's design rulings are applied as given: retro 1970s and 80s broadcast grammar on a clean modern picture, chrome as the neutral accent, void's walnut and cream, void's four faces (Playfair Display, Inter, Barlow Condensed, IBM Plex Mono; no fifth), test-card segment cards whose bars are measured lean, bold two-tier lower thirds, a split-flap framings board, an analogue airtime clock (Mondays 21:00 UTC), and a teleprinter title.

Every number and headline in the mocks is week 32's own, read from `data/week-32.json` and the transplanted ladder (`web/src/lib/ladder.mjs`). Nothing in a mock was drawn by a model.

**Files**

| File | What it is |
|---|---|
| `design/tokens.css` | the only colour definitions; Ink & Momentum roles over the bible's `--o-*` palette, walnut and paper, measured contrast pairs in its header |
| `design/fonts.css` | the four self-hosted faces (unchanged from Spark) |
| `design/mocks/site.css` | shared layout for the site mocks; the seed for T10's stylesheet |
| `design/mocks/{home,episode,sources,correct,privacy}.html` | one responsive mock per site surface, verified at 375, 768 and 1280 px; `?state=` shows each state, `?theme=light` or `dark` pins the theme |
| `design/mocks/broadcast/frame.css` and seven `*.html` | 1920 x 1080 frames: test card (The Week), lower third over the PD still slot, framings board, count card, clock at 20:59:54, Echo test card, end board |

Screenshots for the G2 packet live outside git, in `Agentique/reports/g2/omnibus/` (rule 8); `design/shots/` is gitignored.

---

## 1. Foundations

### 1.1 Hue and texture layer over Ink & Momentum

Ink & Momentum is the grammar. The product's own layer is:

| Role (Ink & Momentum) | omnibus token | Walnut | Paper | Its one meaning |
|---|---|---|---|---|
| bg | `--color-bg` | `--o-black` | `--o-paper` | the ground; walnut is also the pillars |
| surface | `--color-surface` | `--o-field` | paper, l minus 0.025 | cards, the 4:3 field |
| cream (text) | `--color-ink`, `-2`, `-3` | cream, grey-2, grey-3 | ink and two derived steps | text |
| terracotta (acts) | `--color-accent` | chrome `#b9c2cb` | chrome-deep `#55616c` | what acts (links, buttons, focus) and the station's own marks (lower-third rule, clock hands, the dot, the Sigil-O) |
| forest, burgundy, ochre | not used | | | good, owed and pending do not exist here, and any red, green or blue would read as a lean |
| (product) past | `--color-echo-*` | umber | deep umber | only inside the Echo |
| (product) spectrum | `--bias-*`, `--rung-ink-*` | void's dark set | void's paper set | only where a lean is measured: bars, rung marks, outlet names |
| (product) texture | `--o-stair-1..6` | | | the test card's grey staircase, the one texture |

- **Errors carry no hue.** Spark mapped `--color-error` to the right-lean red; that made an error look like a measurement. It now maps to ink, and an error is a stop glyph, a 4 px ink rule and plain words.
- **Rung ink.** Raw spectrum colours fail as text (walnut far-right 2.53:1, paper centre-left 3.67:1). Outlet names and rung labels use `--rung-ink-*`, the same hue lifted (walnut) or deepened (paper) to at least 4.5:1. Bars keep the raw colour, and their count is always printed beside them.
- **`.on-air` scope.** The programme's own picture (posters, the player stage) stays walnut on a paper page, as a television picture would.
- **Derived states** use relative colour only: oklch for chromatic sources, oklab for near-neutral ones (Edge serialises a relative hue of a low-chroma source as `none`, which turned the paper surface pink in the first measurement).
- **Radii** 4 px (cards) and 3 px (controls): the character generator's rectangle, never a rounded screen. **Shadows** only under the poster and the play button.

All contrast pairs are listed, measured, in the `tokens.css` header. The lowest text pair in use is 4.77:1 (walnut far-right rung ink on the field).

### 1.2 Type

| Voice | Face | Site | Programme (1080p) |
|---|---|---|---|
| Display | Playfair Display 600 / 700 | page titles 28 to 44 px (700), headlines 19 to 22 px (600); italic for emphasis and for the Echo | board headlines 42 px, line 48.3 px, -0.02 em; wordmark 700 |
| Structure | Inter 400 / 700 | body 16 px, lede 18 px, labels 15 px 700 | lower-third names 38 px 700, -0.01 em; count context 40 px |
| Caps register | Barlow Condensed 600, caps, +0.08 em | eyebrows 13 px, section heads 18 px, slates, chips, chapter names | slates 44 px, second lines 26 px, segment word 76 px, rung labels 22 px |
| Data | IBM Plex Mono 400 / 600, `tabular-nums` | every numeral, without exception | every numeral; hero counts 220 px on the count card, 132 px elsewhere |

The roman year on the end board (MMXXVI) is the only numeral not set in Mono (bible). Sentence case everywhere on the site except the caps register.

### 1.3 Motion

Two layers. The site's interactive UI uses Ink & Momentum's tiers and springs. The programme's graphics use the bible's period presets, which never ease into place; their physics is the flap's fall and the hands' sweep.

| Preset | Where | Spec |
|---|---|---|
| spring press | site buttons | scale 0.97 over 80 ms, release on `--spring-snappy` over 240 ms |
| detail fade | drill cards | children rise 6 px with opacity, 240 ms, `--ease-cinematic`; chevron turns 90 degrees on `--spring-snappy` |
| rack focus | guide listings, tables | `:has(:hover)` softens siblings to 0.55 opacity and 0.4 px blur, 240 ms `--ease-rack` |
| pulse | loading | opacity 0.4 to 0.85, 3 s, on the player's track only |
| `cut` | programme default | 0 ms |
| `wipe` | lower third on | clip-path inset from the left, 240 ms linear, hard edge; it cuts off, never wipes off |
| `flap` | board rows | each row falls as a half card, `rotateX(-90deg)` to 0 over 180 ms on `--ease-flap` (gravity, accelerating into the stop) and settles on `--spring-flap-settle` (one 3% rebound); rows start 400 ms apart; one recorded flap per row |
| `step` | every programme numeral | lands whole on one frame with one tick; never counts up (a number is a fact). This overrides Ink & Momentum's value flash for the programme and the site alike |
| `sweep` | clock second hand | constant angular velocity, 6 degrees a second |
| `rostrum` | stills, maps | fills 16:9, at most 3.0x zoom, pan at most a third of the frame a second, zoom at most 15% a second, 1 to 2% creep instead of a dead hold |
| `echo-dissolve` | into the Echo | 1.5 s, the programme's only dissolve |

**Reduced motion** renders every final state at once: no wipe, no flap, no pulse, no dissolve on the site. The site clock hides its second hand and cuts the minute hand once a minute. The broadcast mocks were captured with reduced motion on, which is how the final states in the screenshots were proven.

### 1.4 Grid

- **Site.** Container 1200 px with 16 / 32 / 40 px gutters at under 600, 600 to 1023, and 1024 and up. Reading pages (Corrections, Privacy) cap at 820 px. Section rules are the 6 px staircase. No horizontal page scroll at any width (checked at 375, 768, 1280 for every state). Touch targets are 44 px.
- **Programme.** The 4:3 field is 1440 x 1080 at x = 240; the pillars are `--o-black`. Title-safe is 10% of the field: x 384 to 1536, y 108 to 972 (frame pixels). Footage and stills ignore the field and fill 16:9.

---

## 2. Site surfaces

Every surface has one job and one hero.

**Rules that hold on every surface (round 2):**
- **Rung words, never letters.** Wherever a lean is counted, the key names the rung in words (`Far left`, `Left`, `Center left`, `Center`, `Center right`, `Right`, `Far right`, from `LEAN_LABEL_TEXT`), set on two lines when narrow, with a swatch and the count. The FL..FR abbreviations are gone from the site and the test cards.
- **Every bar says what it counts and what it leaves out.** A caption line sits above the bar: `Outlets carrying each day's lead: {238} placed across the week, {127} without a placement and left out` (Home); `Outlets carrying {Monday}'s lead: {40} placed, {18} without a placement and left out` (day rows); `Outlets on the lead: {21} placed; {18} not rated by void news and left out` (the lead); `Outlets carrying the story: {8} placed, {0} without a placement and left out` (margins). For day leads and margins the record gives only the gap between sources and placed outlets, so the copy says "without a placement"; "not rated" is used only where void news's list says `unrated` (the lead).
- **The story, plainly.** The cover headline stays verbatim (it is void news's printed headline). Beneath it, a context line names the story in the record's own words: `THE STORY {Africa Ebola outbreak passes 10,000 cases, mostly in DR Congo}. (void news's coverage record, {27 Oct})`. It quotes the lead coverage record's title; no word of it is ours, so nothing is editorialised.
- **Google News redirects are labelled.** When a record URL is a `news.google.com` redirect, the headline is plain text and the link beside it reads `via Google News`; the outlet is named in its own column. It is never presented as the outlet's address. Strings below are final copy; `{n}` marks a value filled from the record. No string uses an exclamation mark or an em dash. A quoted headline keeps its own punctuation, including an em dash where the outlet printed one (written as `&mdash;` in HTML source so the design lint stays a check on our own copy).

Shared chrome, on every page:

| Element | Copy |
|---|---|
| Lockup (links home) | `V◯ID OMNIBUS` (Playfair 700, the O is the Sigil ring in chrome); accessible name `void omnibus, the programme guide` |
| Nav | `Guide` · `Privacy` |
| Footer | `A void news programme` · `Privacy` · `Feed (RSS)` · `Episodes and pages: CC BY-SA 4.0` |

### 2.1 Home `/`: the programme guide

**Job:** tell a visitor what is on, when the next one airs, and what the programme is. **Hero:** the latest episode's poster, which is that week's test card with its measured bars.

**Layout.** 1280: two columns, 7 : 5. Left: eyebrow, the 4:3 poster (walnut on any theme), the poster's key (caption, bar, rung words and counts), the title, the context line, meta line, actions. Right: the Next on air card (clock 128 px beside the airtime) and the three lines. Below, full width: the programme guide, then feedback. 768: one column; the Next card and the three lines sit side by side. 375: one column, clock 96 px.

**Guide listings.** Columns at 768 and up: Week (Mono 24 px) · Dates (Mono) · Lead (Playfair) with a note line · Runtime (Mono, right). At 375 the week number holds the left column and the rest stacks. Newest first. The next week appears as an unlinked row.

**States and copy**

| State | What shows | Copy |
|---|---|---|
| Success (an episode has aired) | poster, title, meta, actions, Next card, guide | eyebrow `Latest episode`; title = the weekly edition's cover headline, verbatim (`Borders Fail to Contain the Spread of Disease`); meta `Week {32} · {26 Oct} to {1 Nov 2026} · {22:20}`; button `Watch week {32}`; link `Every source for this week`; Next card eyebrow `Next on air`, time `Monday {9 Nov}, {21:00} UTC`, line `Week {33}, {2} to {8 Nov 2026}`, local line `That is {16:00} where you are ({America/New York}).` (computed in the browser, never sent; hidden when the visitor is on UTC; adds ` on {Tuesday}` when the local day differs) |
| Empty (no episode aired; only "in sources" weeks) | the same grid; poster is week 32's test card, not a link | eyebrow `Programme guide`; title `No episode has aired yet.`; lede `The first episode is in preparation. Until it airs, week {32} is here as its record: the seven days, the lead on the ladder, the echo and every source.`; button `Read week {32}, in sources`; Next card eyebrow `On air`, time `Mondays, {21:00} UTC`, line `The first date is set when the pilot passes its checks.`; guide row lead `Week {32}, in sources` with tag `Rehearsal`, note `Not aired. The record the first episodes are built from.` |
| Loading | none: the page is rendered by the Worker from `index.json`; the clock draws on first paint | |
| Error (`index.json` unreadable) | eyebrow, title, lede, actions; no guide | eyebrow `Programme guide`; title `The programme guide did not load.`; lede `The list of episodes could not be read just now. Reload the page in a minute. Every episode is also kept on the Internet Archive.`; button `Reload`; link `void omnibus on the Internet Archive` |
| Reduced motion | clock without its second hand, minute hand cuts each minute | |

**Fixed copy.** The three lines, under `The week, weighed.` (Playfair italic): `The seven days, as void news printed them each morning.` / `The lead story, weighed against the outlets that carried it, left to right.` / `One echo from history, then the stories almost nobody carried.` Under them: `Mondays at {21:00} UTC, about {22} minutes. Voice only, no presenter. Every frame is on a public ledger.` Guide head `Programme guide`, aside `Newest first`; column heads `Week`, `Dates`, `Lead`, `Runtime`; next-row note `In preparation. Airs Monday {9 Nov}, {21:00} UTC.`; aired-row note `The story: {Africa Ebola outbreak passes 10,000 cases, mostly in DR Congo}. Echo: {The 1918 Influenza Pandemic}, {1918} to {1919}.`; past six weeks: `Older weeks play from the Internet Archive.` Feedback: head `Tell us what is missing`; line `A sentence is enough. It goes to the people building this. To report an error in an episode, use that week's correction page.`; label `Feedback`; button `Send feedback`; sending `Sending`; sent `Feedback received.`; empty `Write a sentence before sending.`; failed `Not sent. The server did not answer. Your text is still here; send again in a minute.`; rate-limited `Not sent. Your network has sent several messages in a short time. Wait a minute, then send again.`

**Telemetry.** `page_view` on load (existing). `episode_started` belongs to the Episode player, not Home.

### 2.2 Episode `/e/<issue>`

**Job:** play the week. **Hero:** the 16:9 stage, whose poster is the same test card shown inside its 4:3 field with walnut pillars, so the page opens on the programme's own picture.

**Layout.** Stage (full container width), then a controls bar attached beneath it, then chapters as a listings strip: one row of nine cells at 1280, two columns at 768. **Phone (under 600):** stage; controls in two rows, the scrubber alone on the first (full width, a 44 px hit row around a 4 px track with a 16 px thumb), Play, `{elapsed} / {total}`, captions, quality and full screen on the second; then the title, the context line and the narrator line; then the as-of line and actions; then `Chapters` folded into a disclosure (`{9}, now {the weight}`); then the drills. Below, 7 : 5 at 1280 (stacked below): left, eyebrow, title, as-of lede, actions, voice disclosure; right, drill cards (Transcript, Download, Also on the Internet Archive). Play button 84 px centred (56 px and lower on phones, so it does not cover the test card's word).

**Player.** Our own `<video data-episode>`: 1080p and 720p MP4 from R2 with range requests, no cookies, no third-party script. Controls: Play / Pause, `{00:00} / {22:20}`, a track with one tick per chapter, captions toggle, quality (`1080p` / `720p`), full screen. Keyboard: Space or K plays, J and L seek 10 s, Left and Right 5 s, C captions, F full screen. `episode_started` fires on the first play; `episode_completed` fires once at duration minus 30 s (the existing `watchEpisode`).

**Mock navigation.** The static mock reaches every state without a player: Play goes to `?state=playing`, Pause back to the ready state, any chapter to `?state=playing`, and `Credits` to `?state=ending`. The playing stage shows the framings board frame and the ending stage the end board, each scaled from `broadcast/`.

**Chapters** (week 32 target times from the bible; the real times come from the chapter sidecar): `{0:00} Clock`, `{0:06} Cold open`, `{0:46} Title`, `{1:04} The week`, `{6:20} The weight`, `{12:50} The echo`, `{18:20} The margins`, `{20:50} The question`, `{21:35} Credits`. The current chapter carries a 3 px chrome rule.

**States and copy**

| State | What shows | Copy |
|---|---|---|
| Success | stage with poster and play button, controls, chapters, body | play button name `Play week {32}, {22:20}`; eyebrow `Week {32} · {26 Oct} to {1 Nov 2026}`; title = cover headline verbatim; lede `As of {4 Nov 2026}, {08:34} UTC, when void news generated weekly issue {32}. Nothing printed after that enters this episode.`; actions `Every source for this week`, `Flag an error`; disclosure (with the chrome dot) `Narrated by a computer voice standing in for the founder's own, synthesised with their consent. Quotations are read by a second computer voice. The dot on screen says which is speaking.` From the founder's model onward: `Narrated in the founder's voice, synthesised with their consent. Quotations are read by a computer voice. The dot on screen says which is speaking.` Drills: `Transcript` / `Text, with times`; `Download` / `{1080p}, {720p}, captions`, body `MP4 files and the caption file (WebVTT), licensed CC BY-SA 4.0.`; `Also on the Internet Archive` / `Same master`, body `The Internet Archive keeps every master, including weeks older than the six this site holds.` |
| Playing | the picture, Pause, `{07:42} / {22:20}`, the scrubber's fill and thumb at {34.5}%, the current chapter marked (3 px chrome rule, `aria-current`) | Pause button name `Pause`; scrubber value text `{7} minutes {42} seconds of {22} minutes {20} seconds`; phone disclosure summary `{9}, now {the weight}` |
| Ending (the final 30 s, from duration minus 30 s) | the end board keeps playing; `episode_completed` fires once at that moment, and the end band appears under the controls; nothing autoplays and nothing counts down | band eyebrow `End of week {32}`; `Week {33} airs Monday {9 Nov} at {21:00} UTC.` / `Every picture, number and quotation in this episode is traced on its sources page. Nothing plays next on its own.`; button `Every source for this week`; quiet button `Programme guide`; links `Flag an error`, `Watch again`. Before the next week is scheduled the first line reads `The next week airs Monday at {21:00} UTC.` |
| Loading | poster, a band under the stage, track pulses | `Loading the video` / `{1080p} from this site. Playback starts when enough has arrived.` |
| Error (file unreachable or decode error) | poster dimmed to 45%, band under the stage | `The video did not load.` / `The file could not be reached from this site. Reload the page, or play this week from the Internet Archive, which keeps the same master.`; button `Reload`; link `Play on the Internet Archive` |
| Sources-only degrade | stage shows the test card without a play button; band beneath; then the record in four sections (The week, The weight with the board as HTML, The echo, The margins); no chapters or drills | band eyebrow `Sources only`; `This week is published as its record.` / `The video has not aired. If it airs later, it plays here, dated to its week. Everything it would show is below.`; section asides: `Each day's first printed story, with the lean of the outlets that covered it`; `{62} articles, {39} outlets, {21} placed on the ladder`; board line `One headline per occupied rung, verbatim, from the outlet the rung's rule picks: tier first, then article count in the record, then name.`; `Candidate, with its own horizon` and `Shown inside its own horizon, {1918} to {1919}, in the words of the time.`; `Rated important, carried by few`. Day rows: slate `{Monday}` over `{26 Oct 2026}`, count line `{58} sources, first of {35} printed at {17:57} UTC`. `week_opened` fires when the ledger's end is read (the Spark rule) |
| Empty (no such week) | 404 page | eyebrow `Week {99}`; `There is no week {99}.` / `The latest week is {32}. Weeks are numbered as void news numbers its weekly editions.`; button `Go to week {32}`; link `Programme guide` |
| Reduced motion | no pulse; drill content appears without the rise | |

The rehearsal (week 32) carries, above the title, the tag `Rehearsal` and the line `Dress rehearsal, not aired. Built from the record to test the programme end to end.`

### 2.3 Sources `/e/<issue>/sources`

**Job:** let anyone trace any frame to its origin. **Hero:** the shot ledger, one row per shot in order of appearance: Where (part, caps) · Shot · Source · Licence · What we did. On phones each row stacks with caps field labels.

**Layout.** Title, lede, as-of and lean definition, a jump list, then sections, each opened by the staircase: Shots (open table), The framings board, The record (drills), The lead's coverage (8 rows, then a drill with the rest), The echo (umber panel), Voice, Corrections, Files. `source_opened` fires when a link on this page is followed.

**Copy**

- Title `Week {32}, sources`; lede `Every picture, sound, number and quotation in the episode: where it came from, under what licence, and what we did to it.`; line `As of {4 Nov 2026}, {08:34} UTC. Lean is the outlet's place on void news's seven-rung ladder, not a reading of the article's words.`
- Jump list: `Shots`, `Board`, `The record`, `Coverage`, `The echo`, `Voice`, `Corrections`, `Files`.
- Shots aside `{11} in order of appearance`; heads `Where`, `Shot`, `Source`, `Licence`, `What we did`. Week 32's rows are the shots that exist today: the clock, the title's lines and its sounds, four test cards, the count card, the board, the end board, and the cold open's still marked pending (`Not fetched yet. The fetcher walks tiers {1} to {3} of the ladder.` / `Pending` / `None yet`). The title row reads `Typeset verbatim in IBM Plex Mono caps, struck at a declared {80} characters a second (this week's {704} characters in {9.6} s)`.
- Board: aside `One headline per occupied rung`; line `{21} of {39} outlets in the lead's record are placed on the ladder; {18} are unrated and not placed. Each row is the headline from the outlet the rung's rule picks: tier first, then article count in the record, then name (void news publishes no reach figure, and the board claims none).`; heads `Rung`, `Outlet`, `Headline, verbatim`, `Published`, `Headline fingerprint (sha256)` (first 12 characters; the full hash on hover). The coordinator asked for "file fingerprint"; the hash is of the headline text (`scripts/normalise-week.mjs`), not of a file, so the label says headline.
- **Who placed each outlet** (new, after the board): aside `{21} placed, {18} not rated`; line `Every placement is void news's, read as published. void omnibus does not place or rate outlets and changes none. void news has no page per outlet, so each row links to its outlet list.` One row per outlet: Outlet · Placed (swatch and rung words) · Placed by (`void news`) · Basis (`Outlet baseline; {tier}, {country}, {type}`, from void news's own fields) · Rating record (`void news outlet list, {26 Sep 2026}`, linking `https://news.voidvision.org/sources`, the human-readable list and method; the date is the last change to the list at or before the pinned commit). Then one shaded row for the rest: `{18} outlets` · `Not rated` · `void news lists them without a placement` · `{names}. They are counted in the record and left out of every bar and the board.` On phones each outlet is one line, its fields joined by a dot. The machine copy (`sources.json` at the pinned commit) is linked only as a parenthesis inside The record. Data for this table comes from void news's list at the pinned commit; T1's normaliser carries `tier`, `country`, `type` and the list's date per outlet into `week.json`.
- The record: aside `Public, at pinned commits`; drills `Weekly edition and the seven printed days` / `{8} files`, `Lead coverage records` / `{3} files`, `Outlet ratings` / `{1,061} outlets`.
- Coverage: aside `{62} articles, {39} outlets`; heads `Published, UTC`, `Outlet`, `Rung`, `Headline`; unrated rows read `Not rated`; Google News links labelled as above; drill `Show all {62} articles` / `{54} more`.
- Echo: aside `Its own horizon`; `Candidate from the void history bank, chosen by mechanism before this week's news was known. Horizon: {1918} to {1919}. Nothing learned after it enters the echo.`; links `The event on void history` · `Its evidence record`; `Alternate in the bank: {black-death}.`
- Voice: aside `Two voices, never mixed`; `The narrator is the voice of void's founder, synthesised with their consent. Until that voice is ready, a computer voice stands in, and this page names it. In week {32} the narrator is the stand-in, Kokoro af_aoede at {0.88} speed.` / `Every quotation, headline and period document is read by a second computer voice, Kokoro am_michael at {0.86}, so the programme's words and the record's words never share a voice. On screen, a dot at the end of the lower third grows a label when a synthesised or computer voice starts.`
- **Naming the narrator.** The bible's own credit line says "the founder's voice", so the founder stays unnamed and is called the founder; "the producer's own voice" is not in the bible and is not used. The sources page adds "void's founder" so a reader knows whose voice is meant.
- Corrections: `No corrections for week {32}.` + `Flag an error`. With corrections: one row each, `Read on air in week {33}, {9 Nov 2026}: {text}`.
- Files: `This page as data` / `sources.json`, body `Every row above, machine-readable, CC BY-SA 4.0.`; `Rights packet` / `disputes.json`, body `For each asset: the source address, the licence and its evidence, the file's sha256, and where it sits in the master.`; last line `Built from void news's public record at commit {dcffaaf8}.`

**States.** Success as above. Empty (no such week): the Episode 404. Loading: none (server-rendered). Error (`sources.json` unreadable): `The sources for week {32} did not load.` / `Reload the page in a minute. The same file is mirrored with the episode on the Internet Archive.` Sources-only weeks show this page unchanged; their shot rows read `Not rendered` in the Shot column's place. Reduced motion: no drill rise.

### 2.4 Corrections `/e/<issue>/correct`

**Job:** take one error and its evidence, and show what was accepted. **Hero:** the form.

**Layout.** One column, 820 px. Title, lede, the form on a surface card, then Accepted corrections.

**Copy**

- Title `Flag an error in week {32}`; lede `Tell us what is wrong and what shows it. A correction accepted by Thursday {12:00} UTC is read at the start of the next episode's margins and listed here and on both weeks' sources pages.`
- `Where is it?` chips (radio, one required, none selected on arrival): `The week`, `The weight`, `The echo`, `The margins`, `The sources page`, `Somewhere else`.
- `What is wrong?`, hint `The claim as it appears, and what the record says instead.` (textarea, 2,000 characters, empty on arrival, placeholder `For example: the count card says 64 dead; the court record of 30 Oct gives 61.`, a form example, not a claim about any episode).
- `A source that shows it (optional)`, placeholder `https://`.
- Note `Send only the error and its source. No name or contact details: there are no accounts here, and we cannot reply.`
- Button `Send correction`; while sending `Sending`.
- Accepted: head `Accepted corrections`, aside `Week {32}`; empty `None yet.` / `Accepted corrections appear here with the date they were read on air. Nothing in an episode is changed without a note.`

**States**

| State | Copy |
|---|---|
| Idle | as above |
| Invalid (no text, or no chip) | inline under the field, with the stop glyph: `Write what is wrong before sending.` / `Choose where it is before sending.` |
| Sending | button reads `Sending`, `aria-busy` |
| Sent | status, chrome rule: `Correction received. It is checked against the record. If it is accepted, it is listed below and read on air, without a name.` The form clears; the button returns as `Send another correction`. `correction_submitted` fires |
| Rate-limited | `Not sent. Your network has sent several messages in a short time. Wait a minute, then send again.` |
| Error | `Not sent. The server did not answer. Your text is still here; send again in a minute.` |
| Empty (no such week) | the Episode 404 |
| Reduced motion | no button spring |

The mock's Send works: it validates (both inline errors can show), shows `Sending` for 600 ms, then the sent state with the form cleared. Nothing leaves the page.

### 2.5 Privacy `/privacy`

**Job:** say exactly what is counted and what is never recorded. **Hero:** the table of counted events.

**Copy.** Title `Privacy`; lede `void omnibus counts a few named events as daily totals. It does not record who you are, keeps no cookie or local storage, and loads nothing from another company.` Sections: `What is counted` (aside `Totals per day, nothing per person`), rows `page_view` `A page was opened.`, `week_opened` `A week's record was read to its last line.`, `episode_started` `An episode began playing.`, `episode_completed` `An episode reached its final 30 seconds.`, `source_opened` `A link on a sources page was followed.`, `correction_submitted` `A correction was sent.`, note `Each count has a daily ceiling, and anyone can send one, so a sudden spike is read as suspect rather than as an audience.` `The forms`, `Your connection`, `Retention and deletion`: the Spark page's facts, re-set and extended to the correction form and video (full text in `privacy.html`). Events land in `contract.yaml` with the ticket that builds their surface (charter). States: success only (static).

---

## 3. Broadcast graphics at 1920 x 1080

All drawn by code (HTML, CSS and SVG here; the T5 generators render the same geometry to PNG sequences). Zero AI pixels. No scanline, noise, vignette, curvature or interlace in any engine-drawn layer.

### 3.1 The field
1440 x 1080 at x = 240, fill `--o-field`; pillars `--o-black`. Title-safe x 384 to 1536, y 108 to 972. Graphics compose inside; footage and stills fill 16:9.

### 3.2 Title (bible b): the teleprinter's lines, from week 32
The Blender master is unchanged. The weekly layer typesets these seven lines in IBM Plex Mono caps, verbatim, wrapped at 69 columns (the paper's width):

```
MON 26 OCT   58 SRC  EGYPT APPROVES MILITARY SUPPORT FOR SAUDI ARABIA AFTER HOUTHI ATTACKS ESCALATE
TUE 27 OCT   55 SRC  EX-FBI CHIEF JAMES COMEY FACES FEDERAL CHARGES FOR THIRD TIME
WED 28 OCT  107 SRC  SPAIN TRAIN CRASH: AT LEAST 64 DEAD AFTER COLLISION IN TOLEDO PROVINCE
THU 29 OCT   36 SRC  UKRAINE: 14 KILLED IN RUSSIAN DRONE STRIKE ON CROWDED DNIPRO TRAIN STATION
FRI 30 OCT   51 SRC  TWO AUSTRALIANS CAUGHT UP IN SPANISH TRAIN DISASTER, GOVERNMENT SAYS
SAT 31 OCT   26 SRC  THOUSANDS TAKE TO STREETS OF FRANCE, GERMANY, ITALY AND SPAIN AS POLICE BRACE FOR VIOLENCE ON THIRD WEEKEND OF PROTESTS
SUN 01 NOV   32 SRC  UK'S BURNHAM SAYS HE IS 'OPEN' TO FORMAL APOLOGY FOR SLAVERY, BUT RULES OUT REPARATIONS
WEEK 32  CLOSED WED 04 NOV 08:34 UTC
```

- **Ruling (CoS, delegated, G2 round).** The title stays 18 s. The strike rate is declared per week on the sources page, capped at 100 cps; only a week whose verbatim lines would need more than 100 cps extends the title, by exactly the time the excess needs. Every line stays verbatim.
- **The constraint.** The bible declares 30 characters a second inside S2's 9.6 s, which prints 288 characters. Week 32's verbatim lines are 704. Truncation would break `title-lines-verbatim`. This spec sets the strike rate per week, computed and declared on the sources page: `rate = characters / (9.6 s minus 60 ms per platen step)`, which is **80 cps** for week 32 (704 characters, about 13 steps with wraps). At 80 cps each strike cannot be a separate recorded impact (2.7 strikes a frame), so the strike track becomes a dense bed of recorded impacts, one per frame. A G2 question.
- Monday's line is Egypt, not Ebola: the bible's example line was illustrative; the rank-1 printed story on 26 Oct was Egypt (58 sources).
- The week line uses the edition's real close, Wed 04 Nov 08:34 UTC (it ran late), per the bible's honesty rule.
- **S5 lockup card:** field, Sigil ring 320 px centred at y 330, `void omnibus` Playfair 700 cream 124 px, week line in Mono 30 px `Week 32 · 26 Oct to 1 Nov 2026`.

### 3.3 Test card (segment card), mock `broadcast/testcard-week.html`
- Castellated border: a 30 px band of 60 px blocks alternating `--o-stair-1` and `--o-stair-5`; inner hairline frame at inset 30.
- Fine grid: 1 px `--color-grid` (cream at 7%) every 60 px.
- Central disc: r 390 at the field's centre, `--o-black`, 3 px cream ring.
- Segment word: Barlow 600 caps 76 px, +0.08 em, baseline y 410 (field). `THE WEEK`, `THE WEIGHT`, `THE MARGINS`.
- Measured bars: one band 600 x 150 at y 448, seven contiguous bars whose widths are each rung's share of the total, in rung order, in the raw spectrum; a rung with zero width draws nothing. Frame 1.5 px `--o-stair-3`.
- Caption: Barlow 600 caps 20 px grey-2 at y 594, what the bars count (`OUTLETS CARRYING EACH DAY'S LEAD · 238 PLACED`).
- Key: seven equal columns across 680 px (x 380 to 1060, a little wider than the band): 14 px swatch (y 610), the rung in words from `LEAN_LABEL_TEXT`, Barlow 18 px grey-2, on two lines when it has two words (y 646 and 666), the count in Mono 30 px cream (y 704). Band moved to y 436, 124 px tall.
- Week line: Mono 30 px grey-2, baseline y 772: `WEEK 32 · 26 OCT TO 1 NOV 2026`.
- Staircase: 12 px band, x 144 to 1296, y 960 (field), six steps.
- Data (week 32), by ruling: The Week = the outlets carrying each day's lead, labelled exactly so, `FL 0, L 6, CL 71, C 93, CR 34, R 27, FR 7` (238); The Weight = the lead's outlets, `0, 0, 5, 14, 1, 0, 1` (21 of 39); The Margins = the three stories combined, `0, 2, 8, 8, 2, 2, 0` (22). The Week's definition is a choice: the bible says "the week's whole distribution", and the record holds buckets only for each day's lead, so the card measures the seven leads; the sources page says so.
- Motion: cut in, hold 1.8 s with the sting, cut out. Numerals `step`.

### 3.4 Echo test card, mock `broadcast/testcard-echo.html`
Same card on `--o-echo-field`; castellation `--o-stair-1` / `--o-stair-4`; ring umber. `THE ECHO` at y 410; six equal grey bars (stair 6 to 1, light to dark) 600 x 84 at y 448, no legend, because the past has no outlet measurement; the year in Mono 150 px at y 690 (`1918`); line `WEEK 32 · HORIZON 1918 TO 1919`. Entered after a cut, left by the 1.5 s `echo-dissolve` into the Echo's first picture.

### 3.5 Lower third, mock `broadcast/lower-third.html`
Over full-bleed picture (the mock shows the PD still slot, a plain field with a dashed safe frame; no image fetched). Two tiers, bold, solid:
- Rule: 4 px `--o-chrome`, full width of tier 1, at y 838.
- Tier 1: x 312, height 88, `--color-bar` (walnut at 92%), padding 0 72 px so text lands on title-safe x 384.
  - **Slate**: place in Barlow 600 caps 44 px cream (`TOLEDO PROVINCE, SPAIN`).
  - **Speaker**: name in Inter 700 38 px, -0.01 em, cream.
- Tier 2: 4 px below tier 1, height 58, own width, same bar; baseline y 972.
  - Slate: date in Mono 26 px grey-2 (`WED 28 OCT 2026`).
  - Speaker: role in Barlow 600 caps 26 px grey-2, then the date in Mono (`{ROLE} · 28 OCT 2026`).
- Provenance dot: 22 px chrome disc with a 4 px walnut keyline, 18 px right of the rule's end, centred on the rule. Its label grows to the right in Barlow 22 px grey-2 on the A42/A56 triggers: `SYNTHESISED VOICE`, `COMPUTER VOICE`, `RECONSTRUCTED`, `TRANSCRIBED PAGE`, `PICTURE FROM {DATE}` (a picture dated outside its moment), and the 40 s regrow. Umber in the Echo.
- Motion: `wipe` on, 240 ms linear from the left with a hard edge; hold at most 4 s; cut off. Nothing else is written on footage.

### 3.6 Framings board, mock `broadcast/flap-board.html`
- Head at y 108: `THE WEIGHT` (Barlow 26 px grey-3) left, `WEEK 32` (Mono) right.
- Rows flow from y 168 to 868 in rung order, far left first. Each headline is one flap card 1000 px wide: Playfair 600 42 px, line 48.3 px; per text line the upper half is `--o-stair-1`, the lower `--o-black`, with a 2 px hinge in `--o-field` through the middle. The card's left edge drifts with its rung (`clamp(rungX minus 500, 0, 152)`).
- Under each card the outlet's name, Barlow 600 caps 26 px in its rung ink, centred on its rung's x and clamped inside title-safe (CGTN's full name is right-aligned to x 1536).
- Ladder at y 890: fifteen 2 px ticks across title-safe, a 28 x 16 mark in the rung's colour at each occupied rung; rung labels from `LEAN_LABEL_TEXT` in Barlow 22 px grey-3 at y 918 (the bible's 11 px is below legibility at 1080p).
- Week 32's rows: NPR (center-left), Associated Press (center), The Telegraph (center-right), CGTN (China Global Television Network) (far-right), headlines verbatim with their suffixes.
- **Capacity (ruled).** Four rows per page. A fifth or sixth occupied rung goes to a second page that `flap`s over the first, rungs kept in order, each page held at least 3 s per row.
- Motion: `flap`, rows 400 ms apart; narrator silent during the board.

### 3.7 Count card, mock `broadcast/count-card.html`
Head as the board. Barlow caps 30 px grey-2 qualifier above (`PASSED`) when the record's verb is a threshold; hero numeral Mono 220 px cream (`10,000`) centred at y 350; context line Inter 40 px cream, at most 960 px wide (`Ebola cases in the outbreak in Africa, most of them in DR Congo.`); date line Mono 28 px grey-2 (`AS OF 26 OCT 2026`); staircase at the foot. No source name on the picture (the sources page carries it). Motion: cut in; the numeral `step`s in on one frame with one tick. Hold words / 3 + 1.5 s.

### 3.8 Locator map (no mock; T5)
Natural Earth 1:10m and GeoNames, in the field: coastlines and borders 1.5 px cream at 40%, the country of interest 2 px cream. The place is a chrome 2 px box (24 x 24) with a 2 px chrome leader to a label on `--color-bar`: Barlow 600 caps 30 px cream (`TOLEDO PROVINCE`). Scale bar and imagery date in Mono 22 px grey-2 at the bottom title-safe edge. `rostrum` push into the box. No globe, no 3D, no relief. Sentinel or Worldview imagery dated within the week replaces the vector ground when a place changed, credited per its terms in the sources ledger.

### 3.9 Clock, mock `broadcast/clock.html`
- Dial: 720 px cream disc centred at (720, 456) in the field. Sixty ticks: minutes 1.4 units long-thin walnut; hours 4.5 wide from r 74; quarters 7 wide from r 70 (of 97).
- Hour and minute hands chrome with a 3-unit walnut keyline (chrome on a cream dial is 1.4:1 without it; the keyline is the clean way to keep chrome); second hand `--o-chrome-deep`, 1.6 units, the accent as it appears on a light ground, with an 18-unit tail; hub chrome-deep with a walnut ring.
- Under the dial: `void omnibus` Playfair 700 60 px; `MON 02 NOV 2026 · UTC` Mono 30 px grey-2.
- Motion: the second hand `sweep`s the last six seconds to the airtime (20:59:54 to 21:00:00); at zero the sting and a cut to the cold open. Rendered last, to the true release time (`clock-true`).

### 3.10 Echo register shift
Begins on the Echo test card. Inside the Echo: field `--o-echo-field`; the lower-third rule and the dot turn umber; the slate sets in Playfair 600 italic 44 px cream with the period's own place and date words (tier 2 in Mono); the staircase stays; period pictures keep their own tones; music is heard for the first time since the title; the narrator slows to 0.84. Left by a hard cut to The Margins' test card.

### 3.11 Credits and end board, mock `broadcast/end-board.html`
Credits roll: Barlow 600 caps 30 px cream over the walnut field, centred, 90 px a second (3 px a frame at 30 fps, so the roll stays sharp), every asset's credit, then `Narrated in the founder's voice, synthesised with their consent` (or the stand-in line). End board: Sigil ring 320 px at y 170 (the brand kit's Sigil geometry replaces the plain ring at T5), `void omnibus` Playfair 700 124 px at y 600, and `WEEK 32 · MMXXVI · CC BY-SA 4.0 · omnibus.voidvision.org` at y 800 (caps in Barlow, numerals and the address in Mono, the roman year in Barlow). Holds 4 s.

---

## 4. Notes for Forge (T5, T10)

- Production markup carries no inline `style` (the CSP); the mocks use a few for brevity (bar widths, clamps). T10 draws bars as SVG attributes, as Spark does.
- Posters and the stage take `.on-air`; nothing else redefines tokens.
- The site clock is the only client-side animation besides UI feedback. It reads the device clock in UTC; no network.
- Spark's `web/src/style.css` keeps working on the new tokens (every token it reads still exists); its error colour changes from the right-lean red to ink, as intended.
- Mock state switching (`?state=`) is review-only and never ships.

## 5. Anti-slop checklist, per surface

| Surface | 1 Template look? | 2 Accents earned? | 3 Numerals in Mono, tabular? | 4 Copy clean? | 5 Motion means state? | 6 Negative space? | Result |
|---|---|---|---|---|---|---|---|
| Home | No: a programme guide opening on a test card whose bars are data | Chrome only on actions and the clock; spectrum only in the measured bars | Yes, including dates, airtime and runtime | Yes | Clock sweep is time; press, rack focus | Yes, one hero then the guide | Pass |
| Episode | No: our own stage, period test-card poster, listings chapters | Chrome on play, current chapter, dot | Yes | Yes | Pulse = loading only | Yes | Pass |
| Sources | No: a ledger, the product's reason to exist | Spectrum only on rung swatches and outlet names | Yes | Yes; quoted headlines keep their own punctuation | Drill rise = revealed detail | Dense by nature; drills keep entry light | Pass |
| Corrections | No | Chrome on the selected chip, button, sent rule; errors carry no hue | Yes | Yes; errors say what happened and what to do | Press only | Yes | Pass |
| Privacy | No | None beyond links | Yes | Yes | None | Yes | Pass |
| Broadcast frames | No: period grammar, clean picture | Spectrum only on bars, rung marks, outlet names; chrome on station marks | Yes (roman year excepted, by the bible) | Yes | Wipe, flap, step, sweep each mark a state | Title-safe respected | Pass, with the title rate and board capacity limits above |

## 6. G2 rulings (CoS, delegated, after round 1)

1. **Title.** 18 s stays. Declared strike rate per week on the sources page, capped at 100 cps; the title extends only past that cap. Every line verbatim. (Week 32: 80 cps.)
2. **Clock hands.** As drawn: chrome hands with a walnut keyline, a chrome-deep second hand. The mock's date does not matter; the real clock is drawn at release.
3. **The Week's bars.** The outlets carrying each day's lead, labelled exactly so. The board paginates to a second page past four rows.

## 7. Round 2 (user-sim dry run, Maya)

Episode `?state=playing` and `?state=ending`, reachable from the mock's Play and chapter links; the phone player and order above; rung words everywhere; every bar captioned with what it counts and leaves out; Who placed each outlet on Sources; Google News links labelled; headline fingerprint label; the context line under the cover headline; Corrections empty on arrival with a working mock Send; the poster key on Home; the founder named as void's founder on Sources.

## 8. Data questions for void news (for the founder)

void news is read-only here: no rating or record was changed. These are questions, not findings.

1. **CGTN at Far right.** void news's list places CGTN (China Global Television Network) at `far-right` (state-affiliated, its notes describe official Chinese government messaging), while Xinhua (English), also Chinese state media, sits at `center`. Is CGTN's rung intended, or should state outlets be placed on a different basis? The user simulator flagged it as implausible on the board, where CGTN is the far-right row.
2. **Most of the story's own region is unrated.** 18 of the lead's 39 outlets are `unrated` in the list, 13 of them African (Africanews, AllAfrica, Nation Africa, The Standard, The Star (Kenya), The East African, TheCable, Vanguard Nigeria, Citi Newsroom, MyJoyOnline, Togo First, Eye Radio (South Sudan), The Independent Uganda). The lead's bars therefore measure mostly outlets outside the region where the outbreak is. Is placing these outlets planned?
3. **A name and id mismatch.** Eye Radio (South Sudan) has the id `south-sudan-monitor`.
4. **Reach.** The board picks by the tier-then-count-then-name rule because the list publishes no reach figure. Does void news intend to publish one?
