// scripts/lint-decisions.mjs: docs/DECISIONS.md was an append-only log that conflicted on
// every PR (CI0, ci0/speed). It is now a static index; this guards the split from regressing.
import { describe, expect, it } from "vitest";
import { checkDecisionFilenames, checkDecisionsIndex } from "../scripts/lint-decisions.mjs";

describe("checkDecisionsIndex", () => {
  it("passes a static index with no legacy entry headers", () => {
    const text = [
      "# Decisions",
      "",
      "This file is a one-time, static index.",
      "",
      "- [2026-11-11: faces and tokens](decisions/2026-11-11-faces-and-tokens.md)",
      "",
    ].join("\n");
    expect(checkDecisionsIndex(text)).toEqual([]);
  });

  it("fails when a new decision is appended in the old log's shape", () => {
    const text = [
      "# Decisions",
      "",
      "- [2026-11-11: faces and tokens](decisions/2026-11-11-faces-and-tokens.md)",
      "",
      "## 2026-11-22: a new decision appended by hand",
      "This should have been its own file under docs/decisions/.",
    ].join("\n");
    const violations = checkDecisionsIndex(text);
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatch(/appended to the old log/);
  });
});

describe("checkDecisionFilenames", () => {
  it("passes well-formed decision filenames", () => {
    expect(
      checkDecisionFilenames(["2026-11-11-faces-and-tokens.md", "2026-11-21-t8-the-echo-banks-settlement.md"]),
    ).toEqual([]);
  });

  it("ignores dotfiles", () => {
    expect(checkDecisionFilenames([".manifest.json", ".gitkeep"])).toEqual([]);
  });

  it("fails a filename with no date prefix or wrong extension", () => {
    const violations = checkDecisionFilenames(["DECISIONS-new.md", "2026-11-11-faces-and-tokens.txt"]);
    expect(violations.length).toBe(2);
  });
});
