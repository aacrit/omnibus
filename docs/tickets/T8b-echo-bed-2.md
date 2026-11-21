# T8b: Echo bed 2 and the written-ending rule

**Owner:** the music director (Studio). The builder does not compose. **Status:** not started.
**Spec:** show bible v2, sections g, j and o (`echo-bed-ending`), and section q's Echo row.

**Why.** The Echo is now the programme's closer (section g), so its bed runs toward the credits theme. The library
holds one bed, "the account", written for Korea 1952 (issue 33). Section q says issue 35's Echo needs a new bed, and
the rotation rule forbids the same bed twice in a quarter.

**Bed 2, the cue.**
- Under The Echo only, entering on the `echo-dissolve` (1.5 s, the programme's only dissolve). Never under news,
  never under a quote or SOT (`no-music-under-news`, `no-music-under-quote`), never across a part card.
- Through-composed at two lengths, 90 s and 150 s, each with its own **written ending**. Not a loop and not a fade:
  the ending is composed, and it lands under the Echo's last frame.
- Level: −32 LUFS, ducking 9 dB under voice with 250 ms smoothing. The narrator reads the Echo at 0.84.
- Clean: any texture sits at or below the −72 dBFS room-tone floor (section j); audible hiss is a defect.
- Rotation: no bed twice in a quarter, and never under an account of violence. Each echo bank entry carries
  `bed_constraints.account_of_violence` (`ledgers/echo-bank.json`), which the cue must honour.

**The written-ending rule.**
1. The bed's written ending lands under the Echo's last frame.
2. Then 2.0 s of room tone, declared in the screenplay as `silence: intended` (the `amb` bus only).
3. Then a hard cut to the ident card and the sign-off. Never a crossfade into the theme.
4. Lint `echo-bed-ending` (section o, block): the bed stem ends at least 2.0 s before `signoff`, with no overlap
   with the theme. Ticket 3 (audio routing) wires the lint; this ticket supplies a bed that passes it.

**Done when**
- the bed's two lengths and their endings are in the score folder with a take record and decoded sha256, like
  "the account" (`episodes/33/score/score.take.json`);
- a test shows `echo-bed-ending` passing for both lengths, with the 2.0 s room declared;
- the score passes the product's audio standard and the music director's self-audit.
