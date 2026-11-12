import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, answersOf, claimPool, divergencePairs, quotedPhraseCards, withoutAttributed } from "../scripts/lib/card-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;
const row = (i: number, rung: string, text: string, at = `2026-11-04T1${i}:00:00Z`) => ({ i, rung, text, headline: text, outlet: `O${i}`, published_at: at });

describe("card rules", () => {
  it("sets aside what a headline attributes to someone else", () => {
    expect(withoutAttributed("JD Vance Warns Establishment Will Blame Migration Curbs for 2026 Wipeout")).toBe("JD Vance Warns Establishment Will Blame for 2026 Wipeout");
    expect(answersOf(q("dw-1"), "JD Vance Warns Establishment Will Blame Migration Curbs for 2026 Wipeout")).toEqual([]);
    expect(answersOf(q("dw-1"), "Vance blames Iran war for GOP midterm losses")).toEqual(["war"]);
  });

  it("asks a question only of headlines naming the people it is about", () => {
    expect(answersOf(q("dw-2"), "Vance Tries to Distance Himself From Iran War After GOP's Deep Losses")).toEqual([]);
    expect(answersOf(q("dw-2"), "Vance breaks sharply with Trump, blames midterm losses on handling of Iran war")).toEqual(["apart"]);
    // A verb about the President alone is not a relation between the two men.
    expect(answersOf(q("dw-2"), "Vance Blames Iran War, Israel Ties for Midterm Losses; President Trump Defends Strikes")).toEqual([]);
  });

  it("treats synonyms of one answer as one: 'breaks with' and 'distances from' are not a pair", () => {
    const pool = [row(1, "center", "Vance breaks sharply with Trump"), row(2, "far-right", "JD Vance distances himself from Trump and Iran war")];
    expect(divergencePairs(pool, [q("dw-2")])).toEqual([]);
  });

  it("pairs disjoint answers on the rungs farthest apart, earliest first, and drops a question with no pair", () => {
    const pool = [row(1, "center", "Trump defends strikes"), row(2, "right", "Trump admits war fueled losses"), row(3, "center-left", "Trump admits Iran war caused losses"), row(4, "left", "Vance blames Iran war")];
    const pairs = divergencePairs(pool);
    expect(pairs.map((p) => p.id)).toEqual(["dw-3"]);
    expect([pairs[0].a.outlet, pairs[0].b.outlet]).toEqual(["O1", "O2"]);
  });

  it("reads an apostrophe between two letters as a possessive, never as a quote mark", () => {
    const pool = [
      row(1, "left", "Trump's aide says 'we will not wait' as GOP’s count slips"),
      row(2, "center", "Vance’s team: ‘we will not wait’"),
      row(3, "right", "'We will not wait' says Trump's party"),
      row(4, "far-right", "Trump's men and Vance's men meet"),
    ];
    const cards = quotedPhraseCards(pool);
    expect(cards.map((c) => c.phrase)).toEqual(["we will not wait"]);
    expect(cards[0].rungs).toBe(3); // the possessives in rows 1, 3 and 4 open no quote
    expect(quotedPhraseCards([row(4, "left", "Trump's men and Vance's men meet"), row(5, "center", "Trump's men and Vance's men meet"), row(6, "right", "Trump's men and Vance's men meet")])).toEqual([]);
  });

  it("week 33: no card claims a headline's attributed words, and every pair names both people when asked", () => {
    const w = JSON.parse(readFileSync(path.join(root, "data", "week-33.json"), "utf8"));
    const pairs = divergencePairs(claimPool(w.lead));
    for (const p of pairs) for (const s of [p.a, p.b]) expect(answersOf(q(p.id), s.headline), s.headline).toEqual(s.answers);
    expect(pairs.find((p) => p.a.outlet === "Breitbart News" || p.b.outlet === "Breitbart News")).toBeUndefined();
    expect(quotedPhraseCards(claimPool(w.lead)).map((c) => c.phrase)).toContain("everyone knows why we lost");
  });
});
