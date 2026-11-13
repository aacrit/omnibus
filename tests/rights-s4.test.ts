// S4: founder ruling A of 2026-11-13. In The Week a picture of the day's own
// event may be published any time up to the edition cutoff, not only by the
// day's print time; facts and narration stay at the day's horizon, and the
// shot carries a dot label "FILMED {date} · PUBLISHED {date}". The rule is
// picture_published_by_edition. Tests both ways.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PUBLISHED_BY_EDITION, dotDay, editionDotLabel, fetchRequests, publishedByEdition, windowProblem } from "../scripts/lib/rights/fetcher.mjs";
import { validateLedger, validateRequests } from "../scripts/lib/rights/ledger.mjs";
import { resolveRequests } from "../scripts/lib/rights/resolve.mjs";

const AT = "2026-11-13T12:00:00Z";
const CUTOFF = "2026-11-08T22:16:50.309638+00:00";
const DAY2 = { from: "2026-11-02", to: "2026-11-03T19:39:27.128203+00:00" };

describe("ruling A: picture_published_by_edition", () => {
  it("formats the dot label", () => {
    expect(dotDay("2026-11-02")).toBe("2 NOV 2026");
    expect(dotDay("2026-11-05T04:06:35Z")).toBe("5 NOV 2026");
    expect(editionDotLabel("2026-11-02", "2026-11-05T04:06:35Z")).toBe("FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026");
  });

  it("admits a day's own picture published after the day's horizon and by the cutoff", () => {
    const r = publishedByEdition({ date: "2026-11-02", publishedAt: "2026-11-05T04:06:35Z", window: DAY2, editionCutoff: CUTOFF });
    expect(r?.record).toMatchObject({ rule: PUBLISHED_BY_EDITION, event_date: "2026-11-02", published_at: "2026-11-05T04:06:35Z", dot_label: "FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026" });
    expect(windowProblem("2026-11-02", DAY2, { publishedAt: "2026-11-05T04:06:35Z", requirePublished: true, editionCutoff: CUTOFF })).toBeNull();
    // published by the horizon: the ordinary rule, no record
    expect(publishedByEdition({ date: "2026-11-02", publishedAt: "2026-11-03T08:00:00Z", window: DAY2, editionCutoff: CUTOFF })).toBeNull();
  });

  it("refuses a picture published after the edition cutoff", () => {
    expect(windowProblem("2026-11-02", DAY2, { publishedAt: "2026-11-09T01:00:00Z", requirePublished: true, editionCutoff: CUTOFF })).toMatch(/after the edition cutoff/);
  });

  it("refuses an event after the day's horizon, before its window, or dated coarser than a day", () => {
    const pub = "2026-11-05T00:00:00Z";
    expect(windowProblem("2026-11-04", DAY2, { publishedAt: pub, requirePublished: true, editionCutoff: CUTOFF })).toMatch(/outside its window|not the day's/);
    expect(publishedByEdition({ date: "2026-11-04", publishedAt: pub, window: DAY2, editionCutoff: CUTOFF })?.problem).toMatch(/not the day's/);
    expect(publishedByEdition({ date: "2026-10-30", publishedAt: pub, window: DAY2, editionCutoff: CUTOFF })?.problem).toMatch(/not the day's/);
    expect(publishedByEdition({ date: "2026-11", publishedAt: pub, window: DAY2, editionCutoff: CUTOFF })?.problem).toMatch(/event's own day/);
    expect(publishedByEdition({ date: null, publishedAt: pub, window: DAY2, editionCutoff: CUTOFF })?.problem).toMatch(/event's own day/);
  });

  it("without a cutoff (any part but The Week's days) the day's horizon still holds", () => {
    expect(windowProblem("2026-11-02", DAY2, { publishedAt: "2026-11-05T04:06:35Z", requirePublished: true })).toMatch(/after its window ends/);
  });

  const still = (date: string, published_at: string) => ({
    status: "ok",
    candidate: { adapter: "commons", ref: "File:K.webm", kind_hint: "footage", title: "Destructions in Komyshuvakha", item_url: "https://commons.wikimedia.org/wiki/File:K.webm", media_url: "https://upload.wikimedia.org/k.webm", licence: "cc-by-4.0", basis: "CC BY 4.0", credit: "State Emergency Service of Ukraine", evidence: { url: "https://commons.wikimedia.org/wiki/File:K.webm", captured_text: "Creative Commons Attribution 4.0", captured_at: AT }, date, published_at, categories: [], keywords: [], own_work: false, ai_fields_checked: ["title"] },
  });
  const doc = (forPart: string, cutoff: string | null = CUTOFF) => ({ schema: "omnibus.asset-requests/1", issue: 33, ...(cutoff ? { edition_cutoff: cutoff } : {}), requests: [{ id: "e33-day2-pic", kind: "footage", for: forPart, title: "t", fallback: { tier: 4, text: "tier 4 locator map" }, candidates: [{ adapter: "commons", ref: "File:K.webm", tier: 2, window: DAY2 }] }] });
  const http = { getMedia: async (_u: string, dest: string) => { writeFileSync(dest, "x"); return { status: "ok", sha256: "a".repeat(64), sha1: "b".repeat(40), bytes: 1, mime: "video/webm", generator_tags: [] }; } };
  const opts = () => ({ adapters: { commons: { lookup: async () => still("2026-11-02", "2026-11-05T04:06:35Z") } }, http, mediaDir: mkdtempSync(path.join(os.tmpdir(), "omnibus-s4-")), checkedBy: "t", now: () => new Date(AT) });

  it("the fetcher records the rule and the dot label on the ledger item of a Week day", async () => {
    const { ledger } = await fetchRequests(doc("week-day-2"), null, opts());
    const it0 = ledger.items[0];
    expect(it0.published_by_edition).toMatchObject({ rule: PUBLISHED_BY_EDITION, event_date: "2026-11-02", edition_cutoff: CUTOFF });
    expect(it0.dot_label.text).toBe("FILMED 2 NOV 2026 · PUBLISHED 5 NOV 2026");
    expect(validateLedger(ledger)).toEqual([]);
  });

  it("the fetcher refuses the same picture in The Weight, and in The Week with no cutoff on the request file", async () => {
    const weight = await fetchRequests(doc("weight-known"), null, opts());
    expect(weight.ledger.items).toEqual([]);
    expect(JSON.stringify(weight.ledger.rejected)).toMatch(/after its window ends/);
    const none = await fetchRequests(doc("week-day-2", null), null, opts());
    expect(none.ledger.items).toEqual([]);
  });

  it("assets.json carries the edition cutoff and a pin's dot label; both are validated", async () => {
    const rundown = { issue: 33, as_of: CUTOFF, asset_requests: [{ id: "e33-echo-req-12", kind: "footage", for: "echo", purpose: "x1", fallback: "tier 4 DRAWN", ladder: [{ tier: 1, adapter: "commons", host: "commons.wikimedia.org", query: "File:X.webm", window: { from: "1951-01-01", to: "1952-11-05" } }] }] };
    const pins = { "e33-echo-req-12": [{ adapter: "commons", ref: "File:X.webm", tier: 1, fit: { beat: "echo-x1", why: "refugees" }, dot_label: { text: "FILMED UIJONGBU · 2 JAN 1951", why: "the line names Kangnung on 8 Jan" } }] };
    const out = await resolveRequests(rundown, { pins, http: {}, env: {} });
    expect(out.edition_cutoff).toBe(CUTOFF);
    expect(out.requests[0].candidates[0].dot_label.text).toBe("FILMED UIJONGBU · 2 JAN 1951");
    expect(validateRequests(out)).toEqual([]);
    expect(validateRequests({ ...out, edition_cutoff: "soon" })).toContainEqual(expect.stringMatching(/edition_cutoff/));
    const bad = structuredClone(out);
    bad.requests[0].candidates[0].dot_label = { text: "" };
    expect(validateRequests(bad).join(" ")).toMatch(/dot_label/);
    await expect(resolveRequests(rundown, { pins: { "e33-echo-req-12": [{ ...pins["e33-echo-req-12"][0], dot_label: { text: "X" } }] }, http: {}, env: {} })).rejects.toThrow(/dot_label/);
  });
});
