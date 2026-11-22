// T9a: a rundown/2 has no asset ladders of its own; its sourcing pass writes
// episodes/<n>/rundown-assets.json, and v2's slots are held to publication by
// their window's end. No media, no network.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ASSET_REQUESTS_V2, requestSource } from "../scripts/rights.mjs";
import { NEWS_PART, windowProblem } from "../scripts/lib/rights/fetcher.mjs";

const v2 = (issue: number) => ({
  schema: "omnibus.rundown/2",
  edition: { issue, cutoff_utc: "2026-11-21T14:17:37Z", archive_commit: "b".repeat(40), weekly_edition_seen: false },
  stories: [
    { key: "a", slot: "lead", shape: "document" },
    { key: "b", slot: "package_4", shape: "full" },
    { key: "c", slot: "brief_9", shape: "brief" },
  ],
});
const req = (id: string, slot: string) => ({ id, for: slot, kind: "footage", purpose: "p", ladder: [{ tier: 1, adapter: "commons", host: "commons.wikimedia.org", query: "File:X.webm" }], fallback: "tier 4: the locator" });

function episode(files: Record<string, unknown>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "t9a-"));
  const dir = path.join(root, "episodes", "35");
  mkdirSync(dir, { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(path.join(dir, name), JSON.stringify(doc));
  return { root, dir };
}

describe("requestSource: where an episode's asset requests come from", () => {
  it("reads a v1 rundown's own asset_requests", () => {
    const { root, dir } = episode({ "rundown.json": { issue: 35, asset_requests: [req("x", "week-day-1")] } });
    expect(requestSource(dir, 35).asset_requests.map((r: { id: string }) => r.id)).toEqual(["x"]);
    expect(() => requestSource(dir, 34)).toThrow(/issue 35, not 34/);
    rmSync(root, { recursive: true, force: true });
  });

  it("reads a rundown/2's requests from rundown-assets.json, and none when the file is absent", () => {
    const { root, dir } = episode({ "rundown.json": v2(35) });
    expect(requestSource(dir, 35)).toEqual({ issue: 35, as_of: null, asset_requests: [] });
    writeFileSync(path.join(dir, "rundown-assets.json"), JSON.stringify({ schema: ASSET_REQUESTS_V2, issue: 35, asset_requests: [req("e35-p4", "package_4"), req("e35-b9", "brief_9")] }));
    expect(requestSource(dir, 35).asset_requests.map((r: { id: string }) => r.id)).toEqual(["e35-p4", "e35-b9"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a request for a slot the rundown does not have, another issue, or another schema", () => {
    const { root, dir } = episode({ "rundown.json": v2(35) });
    writeFileSync(path.join(dir, "rundown-assets.json"), JSON.stringify({ schema: ASSET_REQUESTS_V2, issue: 35, asset_requests: [req("e35-p5", "package_5")] }));
    expect(() => requestSource(dir, 35)).toThrow(/package_5, which is no slot/);
    writeFileSync(path.join(dir, "rundown-assets.json"), JSON.stringify({ schema: ASSET_REQUESTS_V2, issue: 34, asset_requests: [] }));
    expect(() => requestSource(dir, 35)).toThrow(/issue 34, not 35/);
    writeFileSync(path.join(dir, "rundown-assets.json"), JSON.stringify({ schema: "x", issue: 35, asset_requests: [] }));
    expect(() => requestSource(dir, 35)).toThrow(/schema must be/);
    expect(() => requestSource(dir, 36)).toThrow(/issue 35, not 36/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("v2 slots are news parts: a picture is public by its window's end", () => {
  it("matches v2 slots and keeps v1's parts", () => {
    for (const s of ["lead", "package_2", "package_5", "brief_1", "brief_10", "tease", "cold-open", "week-day-3", "weight-1", "margins-2"]) expect(NEWS_PART.test(s), s).toBe(true);
    for (const s of ["echo", "title", "credits", "leader", "package-2", "brief"]) expect(NEWS_PART.test(s), s).toBe(false);
  });

  it("refuses a picture published after the cutoff even when its date is inside the week", () => {
    const w = { from: "2026-11-16", to: "2026-11-21T14:17:37Z" };
    expect(windowProblem("2026-11-19", w, { publishedAt: "2026-11-21T13:22:43Z", requirePublished: true })).toBeNull();
    expect(windowProblem("2026-11-19", w, { publishedAt: "2026-11-21T21:58:00Z", requirePublished: true })).toMatch(/after its window ends/);
    expect(windowProblem("2026-10-07", w, { publishedAt: "2026-11-20T04:32:02Z", requirePublished: true })).toMatch(/outside its window/);
  });
});
