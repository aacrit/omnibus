// C8: the Actions draft's sources pull, output route, R2 cap, render manifest and narration stage (episode-draft.yml).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { pullLedger, summarise } from "../scripts/lib/rights/pull.mjs";
import { Refused } from "../scripts/lib/rights/http.mjs";
import {
  BUCKET, BUDGET_ROW, MANIFEST_SCHEMA, buildManifest, manifestProblems, notPublic, outputsRoute, r2CapProblem, renderBudget,
  sha256File, statOrNull, verifyFiles,
} from "../scripts/lib/draft-outputs.mjs";
import { describe as describeRun, dirtyRefusal, localLedger, pickRun, sliceRefusal } from "../scripts/pull-render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const tmp = () => mkdtempSync(path.join(tmpdir(), "c8-"));
const posix = (p: string) => p.replace(/\\/g, "/");
const GiB = 1024 ** 3;
const SHA40 = "a".repeat(40);
const LEDGER33 = () => JSON.parse(readFileSync(path.join(ROOT, "episodes/33/rights-ledger.json"), "utf8"));
const BUDGET = () => parseYaml(readFileSync(path.join(ROOT, "budget.yaml"), "utf8"));

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

const item = (id: string, over: any = {}) => ({ id, adapter: "commons", licence: "pd-us-federal", credit: "US Army", file: `${id}.webm`, media_url: `https://upload.wikimedia.org/${id}.webm`, sha256: sha(id), ...over });

describe("rights fetch --from-ledger (pull.mjs)", () => {
  it("fetches each item from its own media_url and keeps only bytes that hash to the ledger", async () => {
    const dir = tmp();
    const http = fakeHttp({ "https://upload.wikimedia.org/a.webm": "a", "https://upload.wikimedia.org/b.webm": "not b", "https://upload.wikimedia.org/c.webm": null });
    const report = await pullLedger({ ledger: { items: [item("a"), item("b"), item("c")] }, mediaDir: dir, http, log: () => {} });
    expect(report.map((r: any) => r.outcome)).toEqual(["ok", "sha-mismatch", "not-found"]);
    expect(report[0]).toMatchObject({ licence: "pd-us-federal", credit: "US Army" });
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
    const ok = LEDGER33();
    expect(notPublic(ok)).toEqual([]); // issue 33 is public throughout: the pilot may use artifacts
    expect(outputsRoute({ ledger: ok, hasR2: false, budget: BUDGET() }).route).toBe("artifact");
    for (const licence of ["editorial-use", "fair-use-excerpt", "eu-reuse-credit"]) {
      const l = LEDGER33();
      l.items[0].licence = licence;
      const r = outputsRoute({ ledger: l, hasR2: false, budget: BUDGET() });
      expect(r.refused).toBe(true);
      expect(r.message).toContain(`${l.items[0].id}: ${licence}`);
      expect(outputsRoute({ ledger: l, hasR2: true, budget: BUDGET() }).route).toBe("r2");
    }
  });

  it("refuses an invalid or empty ledger before choosing a route", () => {
    expect(outputsRoute({ ledger: { schema: "omnibus.rights-ledger/1", issue: 33 }, hasR2: false, budget: BUDGET() }).refused).toBe(true);
    const r = outputsRoute({ ledger: { ...LEDGER33(), items: [] }, hasR2: true, budget: BUDGET() });
    expect(r.refused).toBe(true);
    expect(r.message).toMatch(/no items|invalid/);
  });

  it("refuses R2 until budget.yaml carries the draft-render row", () => {
    const r = outputsRoute({ ledger: LEDGER33(), hasR2: true, budget: { quotas: [] } });
    expect(r.refused).toBe(true);
    expect(r.message).toContain(BUDGET_ROW);
  });

  it("budget.yaml's draft-render row bounds R2, and the account's R2 shares stay under the alert", () => {
    const b = BUDGET();
    const row = renderBudget(b)!;
    expect(row.bucket).toBe(BUCKET);
    expect(row.prefix).toBe("render/");
    const account = b.quotas.find((q: any) => q.name === "r2_storage_gb")!;
    // snapshots (3 GiB, snapshot-store.mjs) + capture (1.5 GiB, the capture design) + this row + document (0.9 GB)
    expect((3 + 1.5 + row.cap_gib) * GiB + 0.9e9).toBeLessThanOrEqual(account.ceiling * b.alert_at * 1e9);
    expect(r2CapProblem({ bytes: 0.5 * GiB, listed: 0.4 * GiB, budget: b })).toBe(null);
    expect(r2CapProblem({ bytes: 0.7 * GiB, listed: 0.4 * GiB, budget: b })).toMatch(/over the 1 GiB cap/);
    expect(r2CapProblem({ bytes: 1, listed: Number.NaN, budget: b })).toMatch(/byte counts/);
    expect(r2CapProblem({ bytes: 1, listed: 0, budget: { quotas: [] } })).toMatch(/no r2_draft_render_gb/);
    const mins = b.quotas.find((q: any) => q.name === "github_actions_minutes_per_month")!;
    expect(mins.episode_draft_minutes_per_run).toBeGreaterThan(0);
    expect(mins.estimate_at_1000_users_per_day).toBeLessThanOrEqual(mins.ceiling * b.alert_at);
  });
});

describe("render manifest", () => {
  it("records what was rendered and every file, and verifies them back", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "master.mp4"), "m");
    const m = await buildManifest(dir, { issue: 33, run: "1", sha: SHA40, ref: "e4d/pilot-cut", until: 120, res: 720, unusable: ["e33-day6-doc"] });
    expect(manifestProblems(m)).toEqual([]);
    expect(m).toMatchObject({ sha: SHA40, ref: "e4d/pilot-cut", until: 120, res: 720, unusable: ["e33-day6-doc"] });
    expect(m.files).toEqual([{ path: "master.mp4", bytes: 1, sha256: sha("m") }]);
    const deps = { stat: statOrNull, sha: sha256File };
    expect((await verifyFiles(m, dir, deps)).every((c: any) => c.ok)).toBe(true);
    writeFileSync(path.join(dir, "extra.bin"), "x");
    expect((await verifyFiles(m, dir, deps)).find((c: any) => c.path === "extra.bin")?.why).toBe("not in the manifest");
    writeFileSync(path.join(dir, "master.mp4"), "x");
    expect((await verifyFiles(m, dir, deps)).find((c: any) => c.path === "master.mp4")?.why).toMatch(/sha256/);
  });

  it("refuses paths that leave the folder or fall outside the path pattern", async () => {
    for (const p of ["../x", "/x", "C:/x", "a\\b", "", "a b.mp4", "a//b", "./a", "é.wav"]) {
      expect(manifestProblems({ schema: MANIFEST_SCHEMA, sha: SHA40, unusable: [], files: [{ path: p, bytes: 1, sha256: "a".repeat(64) }] }).length).toBeGreaterThan(0);
    }
    const dir = tmp();
    writeFileSync(path.join(dir, "a b.mp4"), "m");
    await expect(buildManifest(dir, { issue: 33, sha: SHA40 })).rejects.toThrow(/cannot be listed/);
  });
});

describe("pull-render", () => {
  it("picks the newest successful run for the issue", () => {
    const rows = [
      { databaseId: 3, displayTitle: "episode draft, issue 33", conclusion: "failure" },
      { databaseId: 2, displayTitle: "episode draft, issue 334", conclusion: "success" },
      { databaseId: 1, displayTitle: "episode draft, issue 33 (a 120 s slice)", conclusion: "success" },
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

  it("writes the run's graphics ledger for the laptop, changing only each output_path", () => {
    const text = '[\n  {\n    "id": "credits",\n    "output_path": "/home/runner/stage/graphics/media/credits.mov",\n    "hold_s": 12.0\n  }\n]\n';
    const { text: out, rows } = localLedger(text, "D:\\omnibus-media\\33\\graphics", { win: true });
    expect(rows[0].output_path).toBe("D:\\omnibus-media\\33\\graphics\\credits.mov");
    expect(out).toContain('"hold_s": 12.0');
    expect(out.replace(/"output_path": "[^"]*"/, "")).toBe(text.replace(/"output_path": "[^"]*"/, ""));
  });

  it("says what a run rendered, and never lets a slice replace a whole film without --slice", () => {
    const full = { run: "1", until: null, sha: SHA40, res: 720, unusable: [] };
    const slice = { run: "2", until: 120, sha: SHA40, ref: "e4d/pilot-cut", res: 720, unusable: ["e33-day6-doc"] };
    expect(describeRun(slice)).toBe("run 2, commit aaaaaaaaaaaa (e4d/pilot-cut), 720p, a 120 s slice; not usable: e33-day6-doc");
    expect(sliceRefusal(full, slice, false)).toMatch(/--slice/);
    expect(sliceRefusal(full, slice, true)).toBe(null);
    expect(sliceRefusal(slice, full, false)).toBe(null);
    expect(sliceRefusal(null, slice, false)).toBe(null);
  });
});

// The narration stage as the workflow runs it (scripts/ci/narration.sh), with a stand-in interpreter.
function bashExe() {
  if (process.platform !== "win32") return "bash";
  const git = "C:/Program Files/Git/bin/bash.exe";
  if (!existsSync(git)) throw new Error("Git Bash is needed to run the narration stage's test on Windows");
  return git;
}

function narrationStage(pythonBody: string) {
  const work = tmp();
  mkdirSync(path.join(work, "episodes/33/audio"), { recursive: true });
  mkdirSync(path.join(work, "scripts/ci"), { recursive: true });
  writeFileSync(path.join(work, "episodes/33/audio/voice.json"), '{"laptop": true}');
  for (const f of ["narration.sh", "meter.sh"]) writeFileSync(path.join(work, "scripts/ci", f), readFileSync(path.join(ROOT, "scripts/ci", f)));
  const py = path.join(work, "fake-python.sh");
  writeFileSync(py, `#!/usr/bin/env bash\n${pythonBody}\n`);
  const env = {
    ...process.env, ISSUE: "33", OMNIBUS_MEDIA_ROOT: posix(path.join(work, "media")), STAGE: posix(path.join(work, "stage")),
    METER: posix(path.join(work, "meter.log")), PYTHON: posix(py),
  };
  const r = spawnSync(bashExe(), ["-c", `chmod +x "${env.PYTHON}" && bash scripts/ci/narration.sh`], { cwd: work, env, encoding: "utf8" });
  return { r, work };
}

describe("narration stage", () => {
  it("fails, and leaves no manifest anywhere, when voicing fails inside the pipe", () => {
    const { r, work } = narrationStage('echo "voice_episode: refused" >&2; exit 2');
    expect(r.status).not.toBe(0);
    expect(existsSync(path.join(work, "episodes/33/audio/voice.json"))).toBe(false);
    expect(existsSync(path.join(work, "stage/voice.json"))).toBe(false);
  });

  it("hands on the manifest this run wrote, never the committed one", () => {
    const body = [
      'mkdir -p "$OMNIBUS_MEDIA_ROOT/33/voice"',
      'echo x > "$OMNIBUS_MEDIA_ROOT/33/voice/L-1.wav"',
      'echo "{\\"run\\": true}" > episodes/33/audio/voice.json',
      'echo "{}"',
    ].join("\n");
    const { r, work } = narrationStage(body);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(path.join(work, "stage/voice.json"), "utf8").trim()).toBe('{"run": true}');
    expect(existsSync(path.join(work, "stage/media/L-1.wav"))).toBe(true);
  });

  it("the workflow runs every step under bash with pipefail and voices through the script", () => {
    const wf = parseYaml(readFileSync(path.join(ROOT, ".github/workflows/episode-draft.yml"), "utf8"));
    expect(wf.defaults.run.shell).toBe("bash");
    expect(wf.jobs.narration.steps.some((s: any) => s.run === "bash scripts/ci/narration.sh")).toBe(true);
    expect(JSON.stringify(wf.jobs.narration.steps)).not.toMatch(/voice_episode/);
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
  });
});
