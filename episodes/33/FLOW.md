# Issue 33: second-by-second flow (E4d pilot cut)

Pilot cut, 2026-11-13 (founder ruling: issue 33 ships as a pipeline pilot on a Resolve timeline; truth lints block, pacing is guidance). Times are the screenplay's (`episodes/33/screenplay.json`), the lines laid on their real takes. Runtime 762.8 s (12:43). Nothing was rendered.

## Totals

| picture | seconds | share |
|---|--:|--:|
| PAGE (printed pages, typeset documents) | 347.7 | 45.6% |
| CARD | 130.5 | 17.1% |
| GRAPHIC (clock, title, bars, test cards, board, credits) | 122.4 | 16.0% |
| STILL (photographs) | 97.3 | 12.8% |
| **FOOTAGE** | **64.9** | **8.5%** |

| voice | seconds | share |
|---|--:|--:|
| narration | 335.1 | 43.9% |
| quotes (reader lines) | 82.0 | 10.7% |
| **voiced** | **417.1** | **54.7%** (ceiling 55%) |
| no voice | 345.7 | 45.3% |

Footage comes in at 8.5%, not the ~13% planned, because two clips were dropped: e33-day5-pic2, on the rights review's finding (its "FILMED 6 NOV" is a YouTube posting date and it shows the person, not the day's event), and e33-day3-pic2, because no day-3 line is about the President's remarks.

## Strip (one character = 4 s)

Picture: F footage, S still, P page, C card, G graphic. Voice: N narration, Q quote, . none (majority of each 4 s).

```
GPPPPPPGGGGCGPPPPPPGPFFFFFFGCSSSSSSPPPPPGPPPPPPFPPFFFFFGPPPPPPPPPPPPCGGGGGGGCCCCCCCCCCCPGFFFFPPPPPPPPPPPPPPPPPPPPPPSSSSSPPPPPPPPSSSPSSSSSSSSSSSCCCCCCCCCCCCCCCCPPPPPPPPPPPCPPPPPPPPGGGGGGGGGGGG
...N.N.......NNNNN..NNNNN..N..NNN..NNN..NNNNNNN.NNNNNN..NNNN...NN...NNN.....NNNN.........NNN.NNNQQQQ..NNQQQQQQQQQQQNNN..NNNN....NNNQ.......NNN.NNNQQQ..NNNNQQQ..NN..NNNNN..NNNN................
```

## Footage cut in (all muted)

| shot | asset | in to out | on screen | dot label | frame check (E4d, ffmpeg tiles) |
|---|---|---|---|---|---|
| S-D2-FTG | e33-day2-pic (SES Ukraine, CC BY 4.0) | 0 to 14.533 s | 85.7 to 100.2 | FILMED 2 NOV 2026 Â· PUBLISHED 5 NOV 2026 | every 3 s over 0 to 67 s, every 1 s over 13 to 20 s: site, smoke, rescuers, a search dog, nobody harmed visible. 17 to 27 s shows a white sheet or bag carried out (possibly a body), so it is excluded. The only mark is SES Zaporizhzhia's own logo (the credited maker), with no network or agency bug |
| S-D2-FTG2 | e33-day2-pic | 38.3 to 45.767 s | 100.2 to 107.7 | same | every 1 s over 38 to 45 s: excavators at the crater and rescuers walking the site; clear |
| S-D5-PIC | e33-day5-pic (DVIDS) | 40 to 44.3 s | 186.1 to 190.4 | none (published before the horizon) | unchanged from E4c: under the count line only |
| S-D6-FTG | e33-day6-pic (White House) | 1.293 to 24.149 s | 198.9 to 221.8 | none (published 6 Nov, before the 7 Nov horizon) | every 3 s over 0 to 33 s: Miller with the President at a podium, with reporters, at a table, to camera; no network bug or lower third. Muted: its own sound is the White House's edit (music likely), not checked |
| S-X1 | e33-echo-req-12 (Signal Corps 111-ADC-8634) | 137.783 to 153.483 s | 355.7 to 371.4 | FILMED UIJONGBU Â· 2 JAN 1951 | every 4 s over 0 to 240 s, every 1 s over 132 to 153 s: a file of refugees walks along the railway in snow (after the roll-2 slate), then passes the squad close. NARA's card is only at 0 to 4 s, outside the cut |

The in and out points were moved onto source cuts to clear the engine's clip-flash lint. S-D6-PAGE grew 0.544 s, so day 6 still ends at 221.8.

Not used: e33-day5-pic2 (dropped by the rights review) and e33-day3-pic2 (no line about the President's remarks; S-WED-PIC keeps the Vance portrait). Every other footage_slot keeps its page or still fallback. The Armory stills e33-echo-04, -03, -02 and -01 (dated 1952-03-29) now fill S-X6A, S-X6B, S-X6C and S-X6D, cut at L-X6's "President Truman speaks" (519.9 s) and at bed time 137.4 s (542.5 s). The Echo's music cues and quote gates did not move.

## Per shot

| part | shot | start | end | picture | asset | narr s | quote s | dot label |
|---|---|--:|--:|---|---|--:|--:|---|
| p-clock | G-CLOCK | 0.0 | 6.0 | GRAPHIC | clock-dial | 0.0 | 0.0 |  |
| p-cold-open | S-CO-0 | 6.0 | 19.2 | PAGE | e33-day4-page | 4.3 | 0.0 |  |
| p-cold-open | S-CO-1 | 19.2 | 28.9 | PAGE | e33-day4-page | 4.9 | 0.0 |  |
| p-title | T-HOLD | 28.9 | 31.9 | GRAPHIC | title-macro-f0 | 0.0 | 0.0 |  |
| p-title | T-MACRO | 31.9 | 43.3 | GRAPHIC | title-macro | 0.0 | 0.0 |  |
| p-title | T-LOCKUP | 43.3 | 46.9 | CARD |  | 0.0 | 0.0 |  |
| p-week-card | G-TC-WEEK | 46.9 | 48.7 | GRAPHIC | testcard-week | 0.0 | 0.0 |  |
| p-week-1 | G-DAY1 | 48.7 | 51.7 | GRAPHIC | day-bars-1 | 1.8 | 0.0 |  |
| p-week-1 | S-D1-PAGE | 51.7 | 56.7 | PAGE | e33-day1-page | 4.4 | 0.0 |  |
| p-week-1 | S-D1-FTG | 56.7 | 77.7 | PAGE | e33-day1-page | 14.0 | 0.0 |  |
| p-week-2 | G-DAY2 | 77.7 | 80.7 | GRAPHIC | day-bars-2 | 1.8 | 0.0 |  |
| p-week-2 | S-D2-PAGE | 80.7 | 85.7 | PAGE | e33-day2-page | 4.4 | 0.0 |  |
| p-week-2 | S-D2-FTG | 85.7 | 100.2 | FOOTAGE | e33-day2-pic | 13.5 | 0.0 | FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026 |
| p-week-2 | S-D2-FTG2 | 100.2 | 107.7 | FOOTAGE | e33-day2-pic | 1.5 | 0.0 | FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026 |
| p-week-3 | G-DAY3 | 107.7 | 110.7 | GRAPHIC | day-bars-3 | 2.6 | 0.0 |  |
| p-week-3 | C-WED-HEAD | 110.7 | 117.9 | CARD |  | 0.7 | 0.0 |  |
| p-week-3 | S-WED-PIC | 117.9 | 138.1 | STILL | e33-day3-pic | 12.4 | 0.0 |  |
| p-week-4 | G-DAY4 | 138.1 | 141.1 | GRAPHIC | day-bars-4 | 1.8 | 0.0 |  |
| p-week-4 | S-D4-PAGE | 141.1 | 146.1 | PAGE | e33-day4-page | 4.4 | 0.0 |  |
| p-week-4 | S-D4-FTG | 146.1 | 160.0 | PAGE | e33-day4-page | 7.9 | 0.0 |  |
| p-week-5 | G-DAY5 | 160.0 | 163.0 | GRAPHIC | day-bars-5 | 1.8 | 0.0 |  |
| p-week-5 | S-D5-PAGE | 163.0 | 168.0 | PAGE | e33-day5-page | 4.4 | 0.0 |  |
| p-week-5 | S-D5-FTG | 168.0 | 186.1 | PAGE | e33-day5-page | 15.8 | 0.0 |  |
| p-week-5 | S-D5-PIC | 186.1 | 190.4 | FOOTAGE | e33-day5-pic | 1.8 | 0.0 |  |
| p-week-6 | G-DAY6 | 190.4 | 193.4 | GRAPHIC | day-bars-6 | 1.9 | 0.0 |  |
| p-week-6 | S-D6-PAGE | 193.4 | 198.9 | PAGE | e33-day6-page | 4.9 | 0.0 |  |
| p-week-6 | S-D6-FTG | 198.9 | 221.8 | FOOTAGE | e33-day6-pic | 15.9 | 0.0 |  |
| p-week-7 | G-DAY7 | 221.8 | 224.8 | GRAPHIC | day-bars-7 | 1.7 | 0.0 |  |
| p-week-7 | S-D7-PAGE | 224.8 | 229.8 | PAGE | e33-day7-page | 4.4 | 0.0 |  |
| p-week-7 | S-D7-FTG | 229.8 | 247.8 | PAGE | e33-day7-page | 11.0 | 0.0 |  |
| p-weight | G-TC-WEIGHT | 247.8 | 249.6 | GRAPHIC | testcard-weight | 0.0 | 0.0 |  |
| p-weight | S-WK-1 | 249.6 | 254.1 | PAGE | e33-weight-page-01 | 3.9 | 0.0 |  |
| p-weight | S-WK-1F | 254.1 | 265.7 | PAGE | e33-weight-page-01 | 7.6 | 0.0 |  |
| p-weight | S-WK-2 | 265.7 | 271.2 | PAGE | e33-weight-page-03 | 2.1 | 0.0 |  |
| p-weight | C-WK-76 | 271.2 | 275.6 | CARD |  | 3.2 | 0.0 |  |
| p-weight | G-CW-3 | 275.6 | 284.0 | GRAPHIC | cw-3 | 6.8 | 0.0 |  |
| p-weight | G-BOARD | 284.0 | 304.2 | GRAPHIC | board-all | 0.0 | 0.0 |  |
| p-weight | C-CW-1 | 304.2 | 314.2 | CARD |  | 8.5 | 0.0 |  |
| p-weight | C-CP-1 | 314.2 | 321.0 | CARD |  | 3.6 | 0.0 |  |
| p-weight | C-CP-2 | 321.0 | 328.2 | CARD |  | 0.0 | 0.0 |  |
| p-weight | C-CP-3 | 328.2 | 335.0 | CARD |  | 0.0 | 0.0 |  |
| p-weight | C-DV-A | 335.0 | 342.2 | CARD |  | 2.3 | 0.0 |  |
| p-weight | C-DV-B | 342.2 | 347.7 | CARD |  | 0.0 | 0.0 |  |
| p-weight | S-WEND | 347.7 | 353.7 | PAGE | e33-day4-page | 0.0 | 0.0 |  |
| p-echo | G-TC-ECHO | 353.7 | 355.7 | GRAPHIC | testcard-echo | 0.0 | 0.0 |  |
| p-echo | S-X1 | 355.7 | 371.4 | FOOTAGE | e33-echo-req-12 | 9.2 | 0.0 | FILMED UIJONGBU · 2 JAN 1951 |
| p-echo | S-X2 | 371.4 | 405.1 | PAGE | e33-echo-fr-p16 | 11.4 | 16.8 |  |
| p-echo | S-X3F | 405.1 | 417.5 | PAGE | e33-echo-pg-truman-19510614 | 10.8 | 0.0 |  |
| p-echo | S-X3 | 417.5 | 460.1 | PAGE | e33-echo-pg-truman-19510614 | 0.0 | 38.8 |  |
| p-echo | S-X4 | 460.1 | 480.1 | STILL | e33-echo-06 | 12.0 | 0.0 |  |
| p-echo | S-X5F | 480.1 | 488.1 | PAGE | e33-echo-pg-nh-1953 | 6.5 | 0.0 |  |
| p-echo | S-X5 | 488.1 | 510.1 | PAGE | e33-echo-pg-nh-1953 | 9.6 | 0.0 |  |
| p-echo | S-X6A | 510.1 | 519.9 | STILL | e33-echo-04 | 8.3 | 0.0 |  |
| p-echo | S-X6B | 519.9 | 524.7 | STILL | e33-echo-03 | 4.3 | 0.0 |  |
| p-echo | S-X6 | 524.7 | 529.5 | PAGE | e33-echo-pg-truman-19520329 | 0.0 | 3.0 |  |
| p-echo | S-X6C | 529.5 | 542.5 | STILL | e33-echo-02 | 0.0 | 0.0 |  |
| p-echo | S-X6D | 542.5 | 555.1 | STILL | e33-echo-01 | 0.0 | 0.0 |  |
| p-echo | S-X7 | 555.1 | 572.0 | STILL | e33-echo-07 | 11.4 | 0.0 |  |
| p-echo | C-X8 | 572.0 | 602.1 | CARD |  | 9.9 | 11.7 |  |
| p-echo | C-X9 | 602.1 | 635.4 | CARD |  | 14.1 | 11.7 |  |
| p-margins | G-TC-MARGINS | 635.4 | 637.2 | GRAPHIC | testcard-margins | 0.0 | 0.0 |  |
| p-margins | S-M1 | 637.2 | 641.8 | PAGE | e33-margin1-page | 2.7 | 0.0 |  |
| p-margins | S-M1F | 641.8 | 654.1 | PAGE | e33-margin1-page | 7.7 | 0.0 |  |
| p-margins | C-M1 | 654.1 | 656.9 | CARD |  | 1.1 | 0.0 |  |
| p-margins | S-M2 | 656.9 | 662.5 | PAGE | e33-margin2-page | 3.7 | 0.0 |  |
| p-margins | S-M2F | 662.5 | 681.7 | PAGE | e33-margin2-page | 13.6 | 0.0 |  |
| p-margins | C-M2 | 681.7 | 684.5 | CARD |  | 1.1 | 0.0 |  |
| p-margins | S-M3 | 684.5 | 690.1 | PAGE | e33-margin3-page | 3.7 | 0.0 |  |
| p-margins | S-M3F | 690.1 | 703.0 | PAGE | e33-margin3-page | 8.3 | 0.0 |  |
| p-margins | C-M3 | 703.0 | 705.8 | CARD |  | 1.1 | 0.0 |  |
| p-question | S-Q | 705.8 | 717.8 | PAGE | e33-day4-page | 2.6 | 0.0 |  |
| p-credits | G-CREDITS | 717.8 | 758.8 | GRAPHIC | credits | 0.0 | 0.0 |  |
| p-credits | G-END | 758.8 | 762.8 | GRAPHIC | end-board | 0.0 | 0.0 |  |

