// T9c: whether a footage item is telecined is measured from its own file (ffmpeg idet), never assumed, and written
// to the ledger by scripts/rights.mjs telecine (the engine's A6 telecine-declared reads it). No media, no ffmpeg.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTelecine } from "../scripts/rights.mjs";
import { decide, parseIdet, windowOf } from "../scripts/lib/rights/telecine.mjs";
import { validateLedger } from "../scripts/lib/rights/ledger.mjs";

const IDET = (p: number, neither: number, top: number, bottom = 0, tff = 0) => [
  "[Parsed_idet_0 @ 0x1] Repeated Fields: Neither:     0 Top:     0 Bottom:     0",
  "[Parsed_idet_0 @ 0x1] Multi frame detection: TFF:     0 BFF:     0 Progressive:     0 Undetermined:     0",
  `[Parsed_idet_0 @ 0x2] Repeated Fields: Neither: ${neither} Top: ${top} Bottom: ${bottom}`,
  `[Parsed_idet_0 @ 0x2] Single frame detection: TFF: ${tff} BFF: 0 Progressive: ${p} Undetermined: 0`,
  `[Parsed_idet_0 @ 0x2] Multi frame detection: TFF: ${tff} BFF: 0 Progressive: ${p} Undetermined: 0`,
].join("\n");

describe("telecine: idet's counts decide it, or nothing is decided", () => {
  it("reads the input's own counts (the last idet block), not the first, empty one", () => {
    expect(parseIdet(IDET(600, 600, 0))).toEqual({
      multi: { tff: 0, bff: 0, progressive: 600, undetermined: 0 },
      repeated: { neither: 600, top: 0, bottom: 0 },
    });
    expect(parseIdet("no idet here")).toBeNull();
  });
  it("clean progressive with no repeated field is not telecined", () => {
    expect(decide(parseIdet(IDET(600, 600, 0))).telecined).toBe(false);
  });
  it("3:2 pulldown (a field repeated in 2 of 5 frames) is telecined", () => {
    expect(decide(parseIdet(IDET(600, 360, 240))).telecined).toBe(true);
  });
  it("interlaced video, too few frames or an in-between share decide nothing", () => {
    expect(decide(parseIdet(IDET(0, 600, 0, 0, 600))).telecined).toBeNull();
    expect(decide(parseIdet(IDET(10, 10, 0))).telecined).toBeNull();
    expect(decide(parseIdet(IDET(600, 540, 60))).telecined).toBeNull();
    expect(decide(null).telecined).toBeNull();
  });
  it("reads the aired span (the fit), at most 20 s of it", () => {
    expect(windowOf({ fit: { in_s: 45, out_s: 70 } })).toEqual({ fromS: 45, durS: 20 });
    expect(windowOf({ fit: { in_s: 3, out_s: 8 } })).toEqual({ fromS: 3, durS: 5 });
    expect(windowOf({})).toEqual({ fromS: 0, durS: 20 });
  });
});

function episode() {
  const root = mkdtempSync(path.join(os.tmpdir(), "t9c-"));
  const dir = path.join(root, "episodes", "35");
  mkdirSync(dir, { recursive: true });
  const ledger = JSON.parse(readFileSync(path.join("episodes", "35", "rights-ledger.json"), "utf8"));
  ledger.items = ledger.items.map(({ telecined, telecine_check, ...i }: Record<string, unknown>) => i);
  writeFileSync(path.join(dir, "rights-ledger.json"), JSON.stringify(ledger));
  const media = path.join(root, "media");
  mkdirSync(path.join(media, "35"), { recursive: true });
  for (const i of ledger.items) writeFileSync(path.join(media, "35", i.file), "x");
  const shaOf = (id: string) => ledger.items.find((i: { id: string }) => i.id === id).sha256;
  return { root, dir, media, shaOf };
}

describe("rights.mjs telecine: written only when the file is the ledger's and the counts decide", () => {
  const now = () => new Date("2026-11-22T02:00:00Z");
  it("writes telecined and its measure to the item, and the ledger still passes", async () => {
    const { root, dir, media, shaOf } = episode();
    const r = await runTelecine({ root, issue: 35, itemId: "e35-p4-arrival", mediaDir: media, now,
      sha: async () => shaOf("e35-p4-arrival"), measure: () => ({ counts: parseIdet(IDET(600, 600, 0)), ffmpeg: "ffmpeg version test" }) });
    expect(r.telecined).toBe(false);
    const ledger = JSON.parse(readFileSync(path.join(dir, "rights-ledger.json"), "utf8"));
    const item = ledger.items.find((i: { id: string }) => i.id === "e35-p4-arrival");
    expect(item.telecined).toBe(false);
    expect(item.telecine_check.span_s).toEqual([45, 65]);
    expect(validateLedger(ledger)).toEqual([]);
  });
  it("refuses a file that is not the ledger's, before measuring", async () => {
    const { root, media } = episode();
    const measure = () => { throw new Error("measured a file that is not the ledger's"); };
    await expect(runTelecine({ root, issue: 35, itemId: "e35-p4-arrival", mediaDir: media, now, sha: async () => "0".repeat(64), measure }))
      .rejects.toThrow(/is not the ledger's/);
  });
  it("writes nothing when the counts do not decide", async () => {
    const { root, dir, media, shaOf } = episode();
    const before = readFileSync(path.join(dir, "rights-ledger.json"), "utf8");
    await expect(runTelecine({ root, issue: 35, itemId: "e35-p4-arrival", mediaDir: media, now,
      sha: async () => shaOf("e35-p4-arrival"), measure: () => ({ counts: parseIdet(IDET(600, 540, 60)), ffmpeg: null }) }))
      .rejects.toThrow(/not decided/);
    expect(readFileSync(path.join(dir, "rights-ledger.json"), "utf8")).toBe(before);
  });
  it("refuses an item that is not footage", async () => {
    const { root, media } = episode();
    await expect(runTelecine({ root, issue: 35, itemId: "e35-p4-still", mediaDir: media, now })).rejects.toThrow(/not footage/);
  });
});
