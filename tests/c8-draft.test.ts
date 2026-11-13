// C8: the Actions draft's sources pull, output route and render manifest (episode-draft.yml).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pullLedger, summarise } from "../scripts/lib/rights/pull.mjs";
import { Refused } from "../scripts/lib/rights/http.mjs";
import { buildManifest, manifestProblems, notPublic, outputsRoute, sha256File, statOrNull, verifyFiles } from "../scripts/lib/draft-outputs.mjs";
import { dirtyRefusal, pickRun } from "../scripts/pull-render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const tmp = () => mkdtempSync(path.join(tmpdir(), "c8-"));

function fakeHttp(bodies: Record<string, string | Error | null>) {
  const calls: string[] = [];
  return {
    calls,
    getMedia: async (url: string, dest: string) => {
      calls.push(url);
      const b = bodies[url];
      if (b instanceof Error) throw b;
      if (b === null || b === undefined) return { status: "not_found" };
      writeFileSync(dest, b);
      return { status: "ok", sha256: sha(b), bytes: b.length };
    },
  };
}

const item = (id: string, over: any = {}) => ({ id, adapter: "commons", licence: "pd-us-federal", file: `${id}.webm`, media_url: `https://upload.wikimedia.org/${id}.webm`, sha256: sha(id), ...over });

describe("rights fetch --from-ledger (pull.mjs)", () => {
  it("fetches each item from its own media_url and keeps only bytes that hash to the ledger", async () => {
    const dir = tmp();
    const http = fakeHttp({ "https://upload.wikimedia.org/a.webm": "a", "https://upload.wikimedia.org/b.webm": "not b", "https://upload.wikimedia.org/c.webm": null });
    const report = await pullLedger({ ledger: { items: [item("a"), item("b"), item("c")] }, mediaDir: dir, http, log: () => {} });
    expect(report.map((r: any) => r.outcome)).toEqual(["ok", "sha-mismatch", "not-found"]);
    expect(readFileSync(path.join(dir, "a.webm"), "utf8")).toBe("a");
    expect(existsSync(path.join(dir, "b.webm"))).toBe(false);
    expect(existsSync(path.join(dir, "b.webm.mismatch"))).toBe(true);
    expect(summarise(report).unusable).toEqual(["b", "c"]);
  });

  it("reports a host's refusal and never retries it elsewhere", async () => {
    const dir = tmp();
    const http = fakeHttp({ "https://upload.wikimedia.org/a.webm": new Refused("x answered 403 (a Cloudflare bot challenge, which is not answered)") });
    const [r] = await pullLedger({ ledger: { items: [item("a")] }, mediaDir: dir, http, log: () => {} });
    expect(r.outcome).toBe("refused");
    expect(r.detail).toMatch(/403/);
    expect(http.calls).toEqual(["https://upload.wikimedia.org/a.webm"]);
  });

  it("leaves a file already there when it matches, and never downloads our own pages", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.webm"), "a");
    writeFileSync(path.join(dir, "p.png"), "recaptured on linux");
    const own = item("p", { adapter: "voidnews", licence: "own-property", file: "p.png", media_url: "https://x.void-news.pages.dev/paper/" });
    const http = fakeHttp({});
    const report = await pullLedger({ ledger: { items: [item("a"), own, item("q", { adapter: "voidnews", file: "q.png" })] }, mediaDir: dir, http, log: () => {} });
    expect(report.map((r: any) => r.outcome)).toEqual(["present", "recaptured-differs", "missing"]);
    expect(http.calls).toEqual([]);
    expect(summarise(report).unusable).toEqual(["q"]);
  });

  it("refuses a ledger file that is not a bare name", async () => {
    const [r] = await pullLedger({ ledger: { items: [item("a", { file: "../a.webm" })] }, mediaDir: tmp(), http: fakeHttp({}), log: () => {} });
    expect(r.outcome).toBe("unusable");
  });
});

describe("output route (draft-outputs.mjs)", () => {
  it("allows a public artifact only when every ledger item is PD, CC or our own", () => {
    const ok = { items: [item("a"), item("b", { licence: "cc-by-4.0" }), item("c", { licence: "cc-by-sa-4.0" }), item("d", { licence: "own-property" }), item("e", { licence: "cc0-1.0" })] };
    expect(outputsRoute({ ledger: ok, hasR2: false }).route).toBe("artifact");
    for (const licence of ["editorial-use", "fair-use-excerpt", "eu-reuse-credit", undefined]) {
      const r = outputsRoute({ ledger: { items: [...ok.items, item("x", { licence })] }, hasR2: false });
      expect(r.refused).toBe(true);
      expect(r.message).toMatch(/x: /);
      expect(outputsRoute({ ledger: { items: [item("x", { licence })] }, hasR2: true }).route).toBe("r2");
    }
  });

  it("issue 33's ledger is public throughout, so the pilot may use the artifact route", () => {
    const ledger = JSON.parse(readFileSync(path.join(ROOT, "episodes/33/rights-ledger.json"), "utf8"));
    expect(notPublic(ledger)).toEqual([]);
  });
});

describe("render manifest", () => {
  it("lists every file with bytes and sha256 and verifies them back", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "master.mp4"), "m");
    const m = await buildManifest(dir, { issue: 33, run: "1" });
    expect(manifestProblems(m)).toEqual([]);
    expect(m.files).toEqual([{ path: "master.mp4", bytes: 1, sha256: sha("m") }]);
    expect((await verifyFiles(m, dir, { stat: statOrNull, sha: sha256File })).every((c: any) => c.ok)).toBe(true);
    writeFileSync(path.join(dir, "master.mp4"), "x");
    expect((await verifyFiles(m, dir, { stat: statOrNull, sha: sha256File }))[0].why).toMatch(/sha256/);
  });

  it("refuses paths that leave the folder", () => {
    for (const p of ["../x", "/x", "C:/x", "a\\b", ""]) {
      expect(manifestProblems({ schema: "omnibus.render-manifest/1", files: [{ path: p, bytes: 1, sha256: "a".repeat(64) }] }).length).toBeGreaterThan(0);
    }
  });
});

describe("pull-render", () => {
  it("picks the newest successful run for the issue", () => {
    const rows = [
      { databaseId: 3, displayTitle: "episode draft, issue 33", conclusion: "failure" },
      { databaseId: 2, displayTitle: "episode draft, issue 334", conclusion: "success" },
      { databaseId: 1, displayTitle: "episode draft, issue 33", conclusion: "success" },
    ];
    expect(pickRun(rows, 33)).toBe(1);
    expect(pickRun(rows, 34)).toBe(null);
  });

  it("refuses a dirty or unreadable data volume, and never checks the system drive", () => {
    const env = { SystemDrive: "C:" };
    expect(dirtyRefusal("C:/x", { platform: "win32", env, run: () => { throw new Error("no"); } })).toBe(null);
    expect(dirtyRefusal("D:/omnibus-media/33/render", { platform: "win32", env, run: () => "Volume - D: is NOT Dirty" })).toBe(null);
    expect(dirtyRefusal("D:/omnibus-media/33/render", { platform: "win32", env, run: () => "Volume - D: is Dirty" })).toMatch(/chkdsk/);
    expect(dirtyRefusal("D:/x", { platform: "win32", env, run: () => { throw new Error("denied"); } })).toMatch(/failed/);
    expect(dirtyRefusal("/home/x", { platform: "linux" })).toBe(null);
  });
});
