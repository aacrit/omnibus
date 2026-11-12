import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import week32 from "../data/week-32.json";
import { LEAN_BASELINES, LEAN_LABEL_TEXT, leanToBucket } from "../web/src/lib/ladder.mjs";
import { esc, renderWeek, type Week } from "../web/src/render/week";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const week = week32 as Week;
const html = renderWeek(week);

describe("the ladder (lifted from void news)", () => {
  it("places every outlet baseline on its own rung, and ties go toward the centre", () => {
    for (const [rung, base] of LEAN_BASELINES) expect(leanToBucket(base)).toBe(rung);
    expect(leanToBucket(15)).toBe("left");
    expect(leanToBucket(85)).toBe("right");
    expect(Object.keys(LEAN_LABEL_TEXT)).toEqual(LEAN_BASELINES.map(([r]) => r));
  });
});

describe("week 32 record", () => {
  it("is the issue the brief names, with its edition cutoff as the horizon", () => {
    expect(week.issue).toBe(32);
    expect(week.week_start).toBe("2026-10-26");
    expect(week.week_end).toBe("2026-11-01");
    expect(week.as_of).toMatch(/^2026-11-0\dT/);
  });

  it("holds seven days in order, each printed snapshot taken on its own day", () => {
    expect(week.days.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    for (const d of week.days.filter((x) => x.available)) {
      expect(d.printed_at!.slice(0, 10)).toBe(d.date);
      expect(d.lead!.buckets).toHaveLength(7);
      expect(d.snapshot).toMatch(/^https:\/\/github\.com\/aacrit\/void--news\/blob\/[0-9a-f]{40}\//);
    }
  });

  it("knows nothing published after its horizon", () => {
    for (const a of week.lead.ledger) expect(a.published_at <= week.as_of, a.url).toBe(true);
  });

  it("draws at most one board row per rung, in ladder order, each from an outlet in the lead's record", () => {
    const order = LEAN_BASELINES.map(([r]) => r);
    const rungs = week.lead.board.map((b) => b.rung);
    expect(new Set(rungs).size).toBe(rungs.length);
    expect([...rungs].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(rungs);
    expect(rungs.length).toBeLessThanOrEqual(6);
    for (const b of week.lead.board) {
      const hit = week.lead.ledger.find((a) => a.url === b.url);
      expect(hit?.headline, b.outlet).toBe(b.headline);
      expect(hit?.rung).toBe(b.rung);
    }
  });

  it("is small (rule 8)", () => {
    expect(readFileSync(path.join(root, "data", "week-32.json")).byteLength).toBeLessThan(200_000);
  });
});

describe("week 32 page", () => {
  it("shows all seven days, the board, the echo, the margins and the ledger end the reader event watches", () => {
    for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) expect(html).toContain(d);
    expect(html.match(/class="board-row"/g)?.length).toBe(week.lead.board.length);
    expect(html).toContain("The echo");
    expect(html.match(/class="margin"/g)?.length).toBe(week.margins.stories.length);
    expect(html).toContain('id="ledger-end"');
  });

  it("quotes every board headline verbatim (escaped, never rewritten)", () => {
    for (const b of week.lead.board) expect(html).toContain(esc(b.headline));
  });

  it("our own copy has no em dash; only quoted headlines may carry one", () => {
    let own = html;
    const quoted = [
      ...week.days.flatMap((d) => [d.lead?.title ?? "", ...(d.next ?? []).map((n) => n.title)]),
      ...week.lead.ledger.map((a) => a.headline),
      ...week.lead.board.map((b) => b.headline),
      ...week.lead.records.map((r) => r.title),
      ...week.margins.stories.map((m) => m.title),
      week.cover_headline,
      week.echo.title,
    ];
    for (const q of quoted) own = own.split(esc(q)).join("");
    expect(own).not.toContain("—");
  });

  it("sets no inline style (the CSP forbids it) and leaves no placeholder", () => {
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/undefined|NaN|__/);
  });
});

describe("telemetry wiring", () => {
  const main = readFileSync(path.join(root, "web", "src", "main.ts"), "utf8");

  it("week_opened fires only from the ledger-end observer, never on load", () => {
    const calls = [...main.matchAll(/sendEvent\("week_opened"\)/g)];
    expect(calls).toHaveLength(1);
    const observer = main.slice(main.indexOf("new IntersectionObserver"), main.indexOf("observer.observe(end)"));
    expect(observer).toContain('sendEvent("week_opened")');
  });

  it("episode_completed fires only from the episode player's final 30 seconds", () => {
    expect(main).toMatch(/currentTime >= video\.duration - COMPLETION_WINDOW_S/);
    expect(main).toContain("COMPLETION_WINDOW_S = 30");
    expect([...main.matchAll(/reportCoreSuccess\(\)/g)]).toHaveLength(2); // definition + the player hook
  });
});
