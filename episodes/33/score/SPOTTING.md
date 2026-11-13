# Week 33 spotting sheet

Issue 33, 2 to 8 Nov 2026. Programme clock from `episodes/33/rundown.json` (runtime 1207.9 s). Music plays in three places only, by the show bible (section g): the title, the Echo and the credits. Everything else is footage sound, room or silence. The audio files live on D: (`D:/omnibus-media/33/score/`), never in git; `score.take.json` pins them.

## Rules this sheet applies

- **No music under news.** The Week, The Weight and The Margins carry their footage's own sound only. Music under a claim is instigation (bible g).
- **Layers.** The *show* layer is the theme and the sting: the same in every episode, never under narration. The *film* layer is the episode's Echo bed, from the cue library, under the umber Echo only. There is no regional or period layer: no needle-drop, no period recording, no instrument from a tradition (bible g; the rundown's no-bridge rule).
- **The sting's mark.** The sting is two tones, 300 ms then 500 ms. Its long tone begins on the frame it marks, as the long pip of the Greenwich time signal marks the hour, so the short tone leads by 0.300 s. Engine placement is `mark - 0.300 s`.
- **The duck.** Under any voice the mix ducks the bed 9 dB, with 250 ms smoothing, held through gaps under 1.2 s (bible g; engine A29). The bed is written thin under the words and fuller in each beat's gap after them, so the duck works on a quiet line, not a busy one.

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
| x3 White House, 14 Jun 1951 | 11:55.1 to 12:50.1 | 0 to 55 | 45.1 s (37.1 s) | Enters under the slate on a 4 s composed swell: D pedal in two octaves, then one string section at a time (cellos, then violas), pp. Each phrase ends in a rest on the pedal. D minor with B-flat and C colours. | 0 s entry. The account motif (D5 C5 G4) starts at 46.6 s, after the last reading in the budget, and lands on the x4 cut (55.0 s, 12:50.1). |
| x4 Kumsong front, 14 Dec 1951 | 12:50.1 to 13:10.1 | 55 to 75 | 10 s (0) | One voice under the words (B-flat over the pedal). In the gap after them, the first widening: the account a third higher with its step flattened (F5 E-flat5 B-flat4), cellos and violas together. | Widening at 67.6 s (13:02.7). Settles to G minor on the x5 cut (75.0 s). |
| x5 New Hampshire, 11 Mar 1952 | 13:10.1 to 13:40.1 | 75 to 105 | 15 s (0) | The count card: one cello line, fragments of the falling step with rests, then an open fifth in the violas late. Nothing that says why. | Open fifth at 94.6 s (13:29.7). |
| x6 the Armory, 29 Mar 1952 | 13:40.1 to 14:25.1 | 105 to 150 | 22.5 s (3.3 s) | The account augmented in the cellos, the violas answering each fall with a rising step. One held viola A4 only, around the reader's line. After the line, the bed's one widening to its high F5. Then the written ending on an open fifth, the account's last fall withheld. | Thin from 125.2 s (14:00.3). Widening at 131.4 s (14:06.5). Ending begins 137.4 s (14:12.5) on the last still. Silent from 149.6 s (14:24.7). |

**Cadences on the narration's beats:** the motif lands on the x3 to x4 cut, the harmony turns on the x4 to x5 cut, the widening follows the withdrawal line, and the ending lands on the last still. Cut points inside a beat are estimates until E7 exists. When E7 lands, re-run `audit.py` with the real voice timeline. If the withdrawal line falls after 131 s, the widening must move after it; re-write those rows in `score.yaml` rather than sliding the file.

## Silences and why

| Span | Programme | Why |
|---|---|---|
| Clock (except S1) | 0:00 to 0:06 | The clock's own sound. The sting is the only tone. |
| Cold open | 0:06 to 0:46 | The vote's own sound, entered late. No music under the news. |
| The Week, The Weight | 1:04 to 10:42 | No music under news (bible g). Footage sound only. Stings at the test cards. |
| Echo x0 to x2 | 10:42.1 to 11:55.1 | x0 is a part card (never music across a part card). x1 is the refugees outside Kangnung, an account of violence. x2 is the Federal Register page and its reading. The bed's 150 s budget starts at x3. |
| Echo x7 | 14:25.1 to 14:45.1 | The wounded: an account of violence (bible g). The bed is digital silence from 14:24.7. |
| Echo x8, x9 | 14:45.1 to 16:12.1 | The opposition nominee's words and the result as conceded. No bed under either; see the open question below. Hard cut to The Margins' test card. |
| The Margins | 16:12 to 18:38 | No music under news. The Alabama shooting beat in particular: no music, no adjective. |
| The Question | 18:38 to 19:23 | The return to the lead's last frame, one line, then at least 6 s with no voice. Silence is the device; music would answer the question. |

## Open question for the founder

The rundown puts the bed under x3 and x6, which are Truman's own words (the governing party), and under no reading of Eisenhower (x8) or Stevenson (x9). The bed holds no tradition and no period colour. It is at its thinnest under the words: one string voice, the strings 4 dB under the pedal, then the 9 dB duck. Still, music sits under one party's speaker and not the other's.

My recommendation: keep the span as the rundown has it (x7 is violence, so the bed cannot move later), and have the mix take the bed to the pedal alone under the two reader lines. That is gain automation in E11, not a new score. The founder decides at the QC packet.

## Self-audit (`audit.py`, document@b62c4fa engine functions; 33 of 33 checks pass)

| Cue | Length | Integrated | Short-term max | True peak | Low-mid share | Treble share | Breathing | Over 6 kHz | Self-similarity (max) |
|---|---|---|---|---|---|---|---|---|---|
| theme | 864000 samples, 18.000 s | -26.0 LUFS | -22.8 at 14.2 s | -12.9 dBTP | (featured) | 0.000 | | -80.6 dBFS | 0.22 |
| credits | 45.000 s | -26.0 LUFS | -22.0 at 37.6 s | -10.8 dBTP | (featured) | 0.000 | | -74.7 dBFS | 0.32 |
| echo bed (as the mix shapes it) | 150.000 s | -32.0 LUFS | -29.4 at 70.6 s | -17.1 dBTP | 0.085 (max 0.10) | 0.000 | 6.4 dB (min 6) | -79.8 dBFS | 0.77 |
| sting | 0.800 s | -20.0 LUFS | | -16.4 dBTP | | 0.000 | | | |

- **Self-similarity** is the engine's score-repetition measure, where 1.0 or more on chroma, spectrum and rhythm together is a tiled loop. No cue has a loop. Cross-cue maxima: theme against credits 0.86, theme against bed 0.70, credits against bed 0.69. No duplicates. The sampler looped no note: every note fits inside its recording.
- **Under the voice** (a stand-in of real Kokoro af_aoede and am_michael lines laid on the rundown's voiced budgets, the bed ducked 9 dB): the phone-check's minimum margin is 17.9 dB (min 15), median 25.0. Against the bed's loudest second anywhere, the margin is 22.7 dB. The bed in the voice's gaps measures -31.7 LUFS (max -31). Re-run with the real narration once E7 lands.
- **Floor.** No room tone is baked into any cue. Every cue ends in digital silence (the theme's last 200 ms are at -114 dBFS). The bed is silent from 149.6 s, before x7.
- **On a phone** (the engine's small-speaker simulation): the theme measures -26.2 LUFS and the credits -26.3, nearly all of them. The bed measures -36.1, because half of its energy is the sub-bass pedal, which a phone does not play. Its strings carry it there.
