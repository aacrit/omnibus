import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  advancePickProblems,
  bankProblems,
  firstUsableWeek,
  noBridgeTerms,
  weekOpens,
} from "../scripts/lib/echo-bank.mjs";

// T8: the Echo bank's settlement entries (bible v2, section g), and the
// advance-pick rule that makes them usable only from the week after they were
// committed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bank = JSON.parse(readFileSync(path.join(root, "ledgers", "echo-bank.json"), "utf8"));
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("the committed echo bank", () => {
  it("passes its own rules", () => {
    expect(bankProblems(bank)).toEqual([]);
  });

  it("holds the settlement-and-congress entries section g names", () => {
    const ids = bank.entries.map((e: { id: string }) => e.id);
    for (const id of [
      "yalta-conference-1945",
      "potsdam-conference-1945",
      "congress-of-vienna-1815",
      "congress-of-berlin-1878",
      "helsinki-final-act-1975",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("gives the no-bridge lint names to check for every entry", () => {
    for (const e of bank.entries) expect(noBridgeTerms(e).length, e.id).toBeGreaterThan(0);
  });
});

describe("bankProblems", () => {
  const good = () => structuredClone(bank);

  it("refuses a quote whose hash does not match", () => {
    const b = good();
    b.entries[0].period_perspectives[0].quote += " (edited)";
    expect(bankProblems(b).join("\n")).toMatch(/quote_sha256 does not match/);
  });

  it("refuses an entry with five public domain items", () => {
    const b = good();
    b.entries[0].pd_items = b.entries[0].pd_items.slice(0, 5);
    expect(bankProblems(b).join("\n")).toMatch(/5 public domain items, needs at least 6/);
  });

  it("refuses a tag outside the vocabulary", () => {
    const b = good();
    b.entries[0].mechanisms.push("made-up-tag");
    expect(bankProblems(b).join("\n")).toMatch(/not in the vocabulary/);
  });

  it("refuses a perspective dated after the horizon", () => {
    const b = good();
    const p = b.entries[0].period_perspectives[0];
    p.date = "1999-01-01";
    expect(bankProblems(b).join("\n")).toMatch(/dated after the horizon/);
  });

  it("refuses a citation to a source the entry does not hold", () => {
    const b = good();
    b.entries[0].facts[0].source = "src-nowhere";
    expect(bankProblems(b).join("\n")).toMatch(/cites "src-nowhere"/);
  });

  it("refuses a later-made item without a dot label", () => {
    const b = good();
    const it0 = b.entries[0].pd_items[0];
    it0.inside_horizon = false;
    delete it0.dot_label;
    expect(bankProblems(b).join("\n")).toMatch(/needs a dot label/);
  });

  it("refuses an em dash", () => {
    const b = good();
    b.entries[0].as_of_basis += " — ";
    expect(bankProblems(b).join("\n")).toMatch(/em dash/);
  });

  it("refuses a non-public-domain licence", () => {
    const b = good();
    b.entries[0].pd_items[0].licence = "cc-by-sa-4.0";
    expect(bankProblems(b).join("\n")).toMatch(/public domain basis/);
  });

  it("the hash rule is sha256 of the quote's UTF-8", () => {
    const p = bank.entries[0].period_perspectives[0];
    expect(p.quote_sha256).toBe(sha(p.quote));
  });
});

describe("the advance-pick rule", () => {
  it("reads any instant as its week's Monday 00:00 UTC", () => {
    expect(weekOpens("2026-11-22T23:59:59Z").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekOpens("2026-11-23T00:00:00Z").toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(weekOpens("2026-11-29T12:00:00Z").toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("an entry committed on 21 November is first usable in the week of 23 November (issue 36)", () => {
    expect(firstUsableWeek("2026-11-21T18:00:00Z").toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("passes a pick from a bank committed before the week opened", () => {
    const p = advancePickProblems({ id: "yalta-conference-1945", bankAtCommit: bank, committedAt: "2026-11-21T18:00:00Z", weekStart: "2026-11-23" });
    expect(p).toEqual([]);
  });

  it("quarantines a pick from a bank committed during the week it would serve", () => {
    const p = advancePickProblems({ id: "yalta-conference-1945", bankAtCommit: bank, committedAt: "2026-11-21T18:00:00Z", weekStart: "2026-11-16" });
    expect(p.join("\n")).toMatch(/not before the week opened.*first usable week: 2026-11-23/);
  });

  it("refuses a commit at the very instant the week opens", () => {
    const p = advancePickProblems({ id: "yalta-conference-1945", bankAtCommit: bank, committedAt: "2026-11-23T00:00:00Z", weekStart: "2026-11-23" });
    expect(p.length).toBe(1);
  });

  it("refuses an id the bank did not hold, or held without tags", () => {
    expect(advancePickProblems({ id: "nowhere", bankAtCommit: bank, committedAt: "2026-11-21T18:00:00Z", weekStart: "2026-11-23" }).join("\n")).toMatch(/not in the bank/);
    const b = structuredClone(bank);
    b.entries[0].mechanisms = [];
    expect(advancePickProblems({ id: b.entries[0].id, bankAtCommit: b, committedAt: "2026-11-21T18:00:00Z", weekStart: "2026-11-23" }).join("\n")).toMatch(/no mechanism tags/);
  });
});
