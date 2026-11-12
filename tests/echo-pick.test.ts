import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A week record whose echo is approved must point at a pick file that agrees
// with it: the same slug, an as_of on the recorded horizon, the same approver,
// and the statement that the pick came after the week was known.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const records = readdirSync(path.join(root, "data"))
  .filter((f) => /^week-\d+\.json$/.test(f))
  .map((f) => ({ f, rec: JSON.parse(readFileSync(path.join(root, "data", f), "utf8")) }))
  .filter(({ rec }) => rec.echo?.status === "approved");

describe("approved echoes and their pick files", () => {
  it("week 33's echo is approved", () => {
    expect(records.map(({ f }) => f)).toContain("week-33.json");
  });

  for (const { f, rec } of records) {
    it(`${f}: the pick file exists and agrees with the record`, () => {
      expect(rec.echo.pick).toBe(`episodes/${rec.issue}/echo-pick.json`);
      const file = path.join(root, rec.echo.pick);
      expect(existsSync(file), rec.echo.pick).toBe(true);
      const pick = JSON.parse(readFileSync(file, "utf8"));
      expect(pick.issue).toBe(rec.issue);
      expect(pick.chosen.slug).toBe(rec.echo.slug);
      expect(pick.chosen.as_of.slice(0, 10)).toBe(rec.echo.horizon);
      expect(pick.approved_by).toBe(rec.echo.approved_by);
      expect(pick.picked_after_week_known).toBe(true);
      expect(pick.candidates.map((c: { slug: string }) => c.slug)).toContain(rec.echo.slug);
    });

    it(`${f}: every quote_sha256 is the sha256 of its quote`, () => {
      const pick = JSON.parse(readFileSync(path.join(root, rec.echo.pick), "utf8"));
      const pairs: Array<{ quote: string; quote_sha256: string }> = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (typeof o.quote === "string" && typeof o.quote_sha256 === "string") pairs.push(o as { quote: string; quote_sha256: string });
          Object.values(o).forEach(walk);
        }
      };
      walk(pick);
      expect(pairs.length).toBeGreaterThanOrEqual(4);
      for (const { quote, quote_sha256 } of pairs) expect(createHash("sha256").update(quote).digest("hex"), quote).toBe(quote_sha256);
    });

    it(`${f}: every item is dated on or before the echo's as_of`, () => {
      const pick = JSON.parse(readFileSync(path.join(root, rec.echo.pick), "utf8"));
      expect(pick.items.length).toBeGreaterThanOrEqual(6);
      for (const it of pick.items as Array<{ id: string; date: string }>) {
        expect(it.date, it.id).toMatch(/^\d{4}(-\d{2}(-\d{2})?)?$/);
        expect(it.date <= pick.chosen.as_of.slice(0, it.date.length), it.id).toBe(true);
      }
    });
  }
});
