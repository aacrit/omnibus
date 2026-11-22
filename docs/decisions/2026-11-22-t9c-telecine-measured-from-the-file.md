# 2026-11-22: T9c: whether footage is telecined is measured from its file and written by rights.mjs (builder, from the engine's A6)

The engine's `telecine-declared` (A6) refuses a 29.97 or 59.94 clip whose ledger item does not state `telecined: true|false`. Issue 35's White House arrival video (`e35-p4-arrival`, AV1, 30000/1001) has no statement. Nothing wrote one, and the ledger may not be edited by hand. Three shots use it: S-TEASE-4, S-P4-1 and S-P4-7.

`node scripts/rights.mjs telecine <issue> --item <id> --media <dir>` now measures it. First the file must hash to the ledger's sha256. Then ffmpeg's `idet` reads the aired span (the item's fit, at most 20 s), with null output and nothing encoded. The command then writes `telecined` and a `telecine_check` (method, span, counts, shares, ffmpeg version and time) to the item and regenerates the dispute packet.

The decision rule:

- Progressive in at least 95% of frames, with at most 2% repeated fields: not telecined.
- At least 30% repeated fields: telecined (3:2 pulldown repeats a field in 2 of every 5 frames).
- Anything else, or fewer than 30 frames, decides nothing and writes nothing.

The arrival video measured 600 of 600 frames progressive with no repeated field, over 45 to 65 s. It is not telecined. Both fields are in the ledger schema. Because the ledger's sha256 changed, `rundown.json`'s input pin was rebuilt by `normalise-rundown.mjs` at the edition's own archive commit. Nothing else in it changed.
