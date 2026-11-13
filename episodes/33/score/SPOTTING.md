# Week 33 spotting sheet

Issue 33, 2 to 8 Nov 2026. Programme clock from `episodes/33/rundown.json` (runtime 1207.9 s). Music plays in three places only, by the show bible (section g): the title, the Echo and the credits. Everything else is footage sound, room or silence. The audio files live on D: (`D:/omnibus-media/33/score/`), never in git; `score.take.json` pins them.

## Rules this sheet applies

- **No music under news.** The Week, The Weight and The Margins carry their footage's own sound only. Music under a claim is instigation (bible g).
- **Layers.** The *show* layer is the theme and the sting: the same in every episode, never under narration. The *film* layer is the episode's Echo bed, from the cue library, under the umber Echo only. There is no regional or period layer: no needle-drop, no period recording, no instrument from a tradition (bible g; the rundown's no-bridge rule).
- **The sting's mark.** The sting is two tones, 300 ms then 500 ms. Its long tone begins on the frame it marks, as the long pip of the Greenwich time signal marks the hour, so the short tone leads by 0.300 s. Engine placement is `mark - 0.300 s`.
- **No music under a period quote** (founder, chat 2026-11-12). In the Echo the bed plays only between quotations. It goes to silence, not a duck, under every reader line: Truman in x3 and x6, Eisenhower in x8, Stevenson in x9, alike. See the reader gate below.
- **The duck.** Under the narrator the mix ducks the bed 9 dB, with 250 ms smoothing, held through gaps under 1.2 s (bible g; engine A29). The bed is written thin under the words and fuller in each beat's gap after them, so the duck works on a quiet line, not a busy one.

## Cues

| # | Cue | In | Out | Length | Function | Theme | Layer | Entry | Exit |
|---|---|---|---|---|---|---|---|---|---|
| S1 | sting, clock zero | 0:05.700 | 0:06.500 | 0.8 s | mark | the sting | show | hard (15 ms ramp) | hard (110 ms ramp) |
| M1 | `theme.wav` | 0:46.000 | 1:04.000 | 18.00 s | establish | the theme, whole | show | the pedal enters at 0.8 s, from the title's room | written decay, silent by 18.0 s; hard cut to The Week's test card |
| S2 | sting, ident cut | 1:00.100 | 1:00.900 | 0.8 s | mark | the sting | show | hard | hard |
| S3 | sting, The Week test card | 1:03.700 | 1:04.500 | 0.8 s | mark | the sting | show | hard | hard |
| S4 | sting, The Weight test card | 5:47.000 | 5:47.800 | 0.8 s | mark | the sting | show | hard | hard |
| S5 | sting, Echo grey card (x0) | 10:41.800 | 10:42.600 | 0.8 s | mark | the sting | show | hard | hard |
| M2 | `echo-bed-150.wav` | 11:55.100 | 14:25.100 | 150.00 s | carry, turn | the account | film | composed 4 s swell under the x3 slate | written ending, silent from 149.6 s (14:24.7), before x7 |
| S6 | sting, The Margins test card | 16:11.800 | 16:12.600 | 0.8 s | mark | the sting | show | hard | hard |
| M3 | `credits.wav` | 19:22.900 | 20:07.900 | 45.00 s | release | the theme, developed | show | the pedal from the room at 0.4 s | the chord decays through the end board, silent by 45.0 s |

Test card times are the rundown's part starts. The sting is placed by the engine at every test card, so S3 to S6 move with the parts if E12 re-times the screenplay. The title's sting (S2) follows the title's own cut (`shots_outline`: T1 3.0 s, T2 11.4 s, T3 3.6 s, so the lockup cuts at 14.4 s, 1:00.4).

## M1, the theme, against the title (0:46.0 to 1:04.0)

| Title time | Picture (rundown) | Sound | Theme |
|---|---|---|---|
| 0.0 to 3.0 | T1: the 1958 Explorer 1 teleprinter, PICTURE FROM 1958 | the clip's own sound or the recorded strike, the title's room | 0.8 s: the contrabass E2 pedal, bowed from nothing |
| 1.6 to 2.4 | | | the bowed vibraphone's E4 swells in under the clip |
| 3.0 | cut to T2, the DRAWN macro | strikes at 74.3 cps | the sub-octave E1 joins on the cut |
| 3.0 to 12.6 | seven day lines print, Monday to Sunday, then the week line | the strikes are the percussion; the theme has no drum | the rising figure, E4 A4 B4 C#5 E5 D5 A5, one note about every 1.3 s, under the clatter, peaking on A5 near the week line |
| 12.6 to 14.4 | bell at the last character, the tear | bell, tear, 0.4 s of room | the quartal chord E4 A4 D5 under the ringing A5 |
| 14.1 | | **S2** (long tone on the 14.4 cut) | nothing new speaks under the sting |
| 14.4 to 18.0 | T3: the lockup | | A4 falls to G4 (arrives about 15.3 s): the suspension lets go; everything decays; a written 0.8 s fade from 17.2 s; silent at 18.0 |

The theme is the title's quiet half: the title's mix sits at -20 LUFS with the teleprinter peaking at -6 dBTP short-term (bible g), and the theme sits under it at -26 LUFS integrated.

## M2, the Echo bed, against the rundown's beats

The span is the rundown's: x3 to x6, exactly 150 s, from 715.1 s to 865.1 s. The voiced seconds are the rundown's budgets. Where the words fall inside each beat is not known until the screenplay (E4 part 2) and the narration (E7). The bed assumes what the beat intents imply: words first, after a slate's breath, then the picture holds. The audit lays real Kokoro lines on those budgets to test that.

| Beat | Programme | Bed time | Voiced (reader) | What the bed does | Cue points |
|---|---|---|---|---|---|
| x3 White House, 14 Jun 1951 | 11:55.1 to 12:50.1 | 0 to 55 | 45.1 s (37.1 s) | Enters under the slate on a 4 s composed swell under the narrator: D pedal in two octaves, cellos pp. **Silent under Truman's three passages** (gated). The strings are written through underneath so the gate can fall wherever E7 puts the readings. D minor with B-flat and C colours. | 0 s entry. Gate closed 9.65 to 48.9 s (planned). The account motif (D5 C5 G4) returns with the bed from 49.4 s and lands on the x4 cut (55.0 s, 12:50.1). |
| x4 Kumsong front, 14 Dec 1951 | 12:50.1 to 13:10.1 | 55 to 75 | 10 s (0) | One voice under the words (B-flat over the pedal). In the gap after them, the first widening: the account a third higher with its step flattened (F5 E-flat5 B-flat4), cellos and violas together. | Widening at 67.6 s (13:02.7). Settles to G minor on the x5 cut (75.0 s). |
| x5 New Hampshire, 11 Mar 1952 | 13:10.1 to 13:40.1 | 75 to 105 | 15 s (0) | The count card: one cello line, fragments of the falling step with rests, then an open fifth in the violas late. Nothing that says why. | Open fifth at 94.6 s (13:29.7). |
| x6 the Armory, 29 Mar 1952 | 13:40.1 to 14:25.1 | 105 to 150 | 22.5 s (3.3 s) | The account augmented in the cellos under the narrator, the violas answering each fall with a rising step. **Silent under the withdrawal line** (gated; nothing is written for it). After the line, the bed returns into its one widening to the high F5. Then the written ending on an open fifth, the account's last fall withheld. | Gate closed 125.85 to 129.9 s (planned; 14:00.95 to 14:05.0). It reopens over 1.5 s into the widening at 131.4 s (14:06.5). The ending begins 137.4 s (14:12.5) on the last still. Silent from 149.6 s (14:24.7). |

**Cadences on the narration's beats:** the motif lands on the x3 to x4 cut, the harmony turns on the x4 to x5 cut, the widening follows the withdrawal line, and the ending lands on the last still. Cut points inside a beat are estimates until E7 exists. When E7 lands, re-run `audit.py` with the real voice timeline. The reader gate follows the real word times by itself. If the withdrawal line ends after about 130 s, the gate swallows the widening's first bars; re-write those rows in `score.yaml` rather than sliding the file.

### The reader gate: the mix's contract (E11)

The gate is not baked into either WAV, because the readings move with the screenplay and the narration. The mix applies it. `build.py` holds the contract as `READER_GATE` (copied into `score.take.json` under `reader_gate`) and a reference implementation, `reader_gate()`.

| Term | Value |
|---|---|
| Key | each reader line (am_michael) by its first and last word time from E7's alignment; the planned windows are a fallback only |
| Closed | gain 0, silence, not a duck. Applied after the 9 dB narrator duck, to the Echo bed only |
| Window | from first word minus 0.25 s to last word plus 0.5 s |
| Ramps | raised cosine. Closing over 0.6 s, ending at the window's start. Opening over 1.5 s, starting at its end (A29's entry fade, at least 1.5 s) |
| Hold | lines under 3.0 s apart share one window (the passages of one quotation, read with a pause at each cut). An open stretch under 4.0 s between two windows stays closed (no flutter) |

Planned reader windows on the bed's clock, from `build.planned_voice` (the rundown's budgets: the slate breathes 1.2 s, the narrator's seconds come first, then the reader's passages split by word count, with 0.7 s breaths):

| Beat | Reader | Bed clock | Programme | Bed |
|---|---|---|---|---|
| x3 | Truman, passages 1 to 3 | 9.9 to 13.57, 14.27 to 24.05, 24.75 to 48.4 | 12:05.0 to 12:43.5 | one closed window, 9.65 to 48.9 |
| x6 | Truman, the withdrawal | 126.1 to 129.4 | 14:01.2 to 14:04.5 | closed 125.85 to 129.9 |
| x2, x8, x9 | the Register, Eisenhower, Stevenson | outside the span | 11:25.2, 14:57.7 to 15:10.9, 15:42.0 | no bed plays there at all |

## Silences and why

| Span | Programme | Why |
|---|---|---|
| Clock (except S1) | 0:00 to 0:06 | The clock's own sound. The sting is the only tone. |
| Cold open | 0:06 to 0:46 | The vote's own sound, entered late. No music under the news. |
| The Week, The Weight | 1:04 to 10:42 | No music under news (bible g). Footage sound only. Stings at the test cards. |
| Echo x0 to x2 | 10:42.1 to 11:55.1 | x0 is a part card (never music across a part card). x1 is the refugees outside Kangnung, an account of violence. x2 is the Federal Register page and its reading. The bed's 150 s budget starts at x3. |
| Echo x7 | 14:25.1 to 14:45.1 | The wounded: an account of violence (bible g). The bed is digital silence from 14:24.7. |
| Echo, every reader line under the bed | x3 12:05.0 to 12:43.5; x6 14:01.2 to 14:04.5 (planned) | Founder ruling, 2026-11-12: no music under any period quote. The reader gate. |
| Echo x8, x9 | 14:45.1 to 16:12.1 | The opposition nominee's words and the result as conceded. No bed under either, which matches the ruling. Hard cut to The Margins' test card. |
| The Margins | 16:12 to 18:38 | No music under news. The Alabama shooting beat in particular: no music, no adjective. |
| The Question | 18:38 to 19:23 | The return to the lead's last frame, one line, then at least 6 s with no voice. Silence is the device; music would answer the question. |

## Resolved: the party asymmetry

The draft's open question (a bed under Truman's words, none under Eisenhower's or Stevenson's) is settled by the founder's ruling of 2026-11-12. No reader line of any speaker has music under it. The bed sounds only under the narrator and in the gaps between quotations.

## Self-audit (`audit.py`, document@b62c4fa engine functions; 35 of 35 checks pass)

| Cue | Length | Integrated | Short-term max | True peak | Low-mid share | Treble share | Breathing | Over 6 kHz | Self-similarity (max) |
|---|---|---|---|---|---|---|---|---|---|
| theme | 864000 samples, 18.000 s | -26.0 LUFS | -22.8 at 14.2 s | -12.9 dBTP | (featured) | 0.000 | | -80.6 dBFS | 0.22 |
| credits | 45.000 s | -26.0 LUFS | -22.0 at 37.6 s | -10.8 dBTP | (featured) | 0.000 | | -74.7 dBFS | 0.32 |
| echo bed (as the mix shapes it, ungated) | 150.000 s | -32.0 LUFS | -29.3 at 70.6 s | -17.0 dBTP | 0.086 (max 0.10) | 0.000 | 6.3 dB (min 6) | -79.8 dBFS | 0.72 |
| sting | 0.800 s | -20.0 LUFS | | -16.4 dBTP | | 0.000 | | | |

- **Self-similarity** is the engine's score-repetition measure, where 1.0 or more on chroma, spectrum and rhythm together is a tiled loop. No cue has a loop. Cross-cue maxima: theme against credits 0.86, theme against bed 0.70, credits against bed 0.73. No duplicates. The sampler looped no note: every note fits inside its recording.
- **No music under a quote.** Laid on the planned windows, the gated bed is exactly 0 under all four reader lines in the span. With the lead and tail it is at or under the engine's digital zero. Every return after a quotation ramps over 1.5 s.
- **Under the voice.** The stand-in is real Kokoro lines laid in the planned windows: af_aoede for the narrator, am_michael for the reader. With the bed ducked 9 dB and gated, the phone-check's minimum margin is 18.2 dB (min 15), median 30.0. Against the ungated, ducked bed's loudest second anywhere, the margin is 22.6 dB. The bed where no one speaks and the gate is open measures -31.7 LUFS (max -31). Re-run with the real narration once E7 lands.
- **Floor.** No room tone is baked into any cue. Every cue ends in digital silence (the theme's last 200 ms are at -114 dBFS). The bed is silent from 149.6 s, before x7.
- **On a phone** (the engine's small-speaker simulation): the theme measures -26.2 LUFS and the credits -26.3, nearly all of them. The bed measures -36.1, because half of its energy is the sub-bass pedal, which a phone does not play. Its strings carry it there.
