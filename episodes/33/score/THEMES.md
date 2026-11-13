# Week 33 thematic map

One theme, one motif and one signal. The theme and the sting are the show's: written once here and played in every episode, at the title and the credits only. The motif belongs to this Echo bed, the first of the cue library's six. Pitches are sounding pitches. All the notes are in `score.yaml`.

## The theme: "the wire"

- **What it stands for.** The machine of the old newsroom printing the new week: a rising line under the strikes, which climbs as the paper climbs the frame (bible b).
- **The cell.** E4 A4 B4: a rising perfect fourth, then a rising major second. It is open, unharmonised and singable at speech pitch.
- **The figure.** E4 A4 B4 C#5 E5 D5 A5. The cell, then the Dorian sixth (C#, the one bright note), a step back (D5) so the rise breathes, and a final leap of a fifth to A5. It is one figure, not a sequence: no interval pattern repeats.
- **Mode.** E Dorian over an E pedal. The harmony is quartal (E A D) and never states a triad until the end. The suspension (A over the E) resolves to G only after the week closes: the minor third, heard once.
- **Orchestration.** A bowed vibraphone (VCSL, CC0): a sustained instrument with a long decay. The bow swells for about a second, the bar rings for ten. It plays over a bowed contrabass pedal (VSCO 2 CE, CC0), E2 from 0.8 s and E1 from the cut to the macro. There is no drum: the teleprinter is the percussion. The vibraphone gives the broadcast era its colour. It is bowed, not struck, with no motor tremolo, so it does not quote the era's library music.
- **Register.** 41 Hz (the felt pedal) to 880 Hz. The figure stays under the strikes' brightness and above the floor.

## The motif: "the account" (Echo bed 1)

- **What it stands for.** What a war cost at home, told as account entries: a fall, then a further fall.
- **Intervals.** D5 C5 G4: a falling major second, then a falling perfect fourth. This is the theme's cell in retrograde inversion (up a fourth then a step, reversed and turned over). It is kin to the theme by construction, but it never quotes it. The theme plays nowhere but the title and the credits (bible b).
- **Mode.** D Aeolian over a D pedal, a tone below the theme's E: another time, another floor. There are B-flat and C colours (bVI, bVII), and one Phrygian E-flat in x4.
- **Orchestration.** The umber register: a contrabass pedal in two octaves, D1 felt and D2 bowed, with cellos in their tenor register and violas (VSCO 2 CE, CC0). There is no period colour, no march, no hymn, no folk instrument, no brass and no drum. The strings' fundamentals sit above 400 Hz and the pedal below 100 Hz, so the reader's voice owns 150 to 400 Hz (A29 refined).

| Beat | Harmony | Orchestration | The account |
|---|---|---|---|
| x3 White House | D minor, B-flat and C colours | pedal; cellos alone, then violas a phrase at a time; pp | stated once, in the cellos, after the readings (46.6 s), landing on the x4 cut |
| x4 Kumsong front | B-flat over D, then G minor | one voice under the words, then both sections | transposed up a third, its step flattened: F5 E-flat5 B-flat4 (Phrygian), the first widening |
| x5 New Hampshire | D, open fifths | one cello line, rests | fragmented: the falling step alone (A4 G4, B-flat4 A4); no fall of a fourth, nothing that says why |
| x6 the Armory | D minor to an open fifth | the cellos fall, the violas answer each fall with a rising step | augmented (D5 C5 G4 at 3 to 4 s a note); after the withdrawal line, the bed's one high F5; at the end the last fall is withheld: the cellos stop on D and never fall to A |

## The signal: the sting

- **Notes.** E5 (659.26 Hz), then B5 a pure fifth above (988.88 Hz, 3:2). The tones are 300 ms then 500 ms, pure sine, with 15 ms rises and 50 to 110 ms falls, at -20 LUFS.
- **Why these.** The long tone sits in the broadcast line-up tone's register (by 1 kHz). Its pitch is the theme's own open fifth, so a sting on the ident cut never clashes with the theme's last chord. Its rhythm, a short tone then a long one, follows the Greenwich time signal: the long tone marks the frame.
- **It never varies.** Bible g: the same 0.8 s of samples every time, written by `build.py`, the only electronic sound in the programme.

## The arc, and its one payoff

| Part | Theme or motif | Transformation |
|---|---|---|
| Title (0:46) | the theme, whole | the figure climbs to A5 and stops, suspended. The week closes on A falling to G |
| Echo bed (11:55) | the account | stated, transposed, fragmented, augmented; its last fall withheld |
| Credits (19:23) | the theme, developed | **A** the cell augmented in the cellos, answered on B by the vibraphone. **B** the turn: the pedal steps to C (the cell over C, C major with an added sixth and seventh), then D (the figure's middle, D Lydian colour). **C** home to E: the whole figure, quicker, and it goes one step past the title's peak to **B5**. **D** E G D under the B, decaying through the end board |

**The payoff.** At credits 36.2 s (about 19:59.9 on arrival), the figure that stopped on A at the title reaches B5, the sting's own pitch. The programme's line arrives where its signal began. It is a widening, not an explosion. Measured: the credits cue's short-term (3 s) maximum is -22.0 LUFS at 37.6 s, the B arriving. That is 2 dB under the title's whole mix (-20 LUFS) with nothing else sounding, and the closing chord after it is softer than the B it answers.
