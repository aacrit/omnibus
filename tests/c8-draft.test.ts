// C8: the Actions draft's sources pull, output route, R2 cap, render manifest and narration stage (episode-draft.yml).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { ownFiles, ownRelease, pullLedger, summarise } from "../scripts/lib/rights/pull.mjs";
import { Refused } from "../scripts/lib/rights/http.mjs";
import {
  BUCKET, MANIFEST_SCHEMA, buildManifest, manifestProblems, notPublic, outputsRoute, renderBudget,
  sha256File, statOrNull, verifyFiles,
} from "../scripts/lib/draft-outputs.mjs";
import { describe as describeRun, dirtyRefusal, landing, localLedger, pickRun, sliceRefusal, wholeFilmRefusal } from "../scripts/pull-render.mjs";

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
    const report = await pullLedger({ ledger: { items: [item("a"), item("b"), item("c")] }, mediaDir: dir, http, log: () => {}, discard: false });
    expect(report.map((r: any) => r.outcome)).toEqual(["ok", "sha-mismatch", "not-found"]);
    expect(report[0]).toMatchObject({ licence: "pd-us-federal", credit: "US Army" });
    expect(readFileSync(path.join(dir, "a.webm"), "utf8")).toBe("a");
    expect(existsSync(path.join(dir, "b.webm"))).toBe(false);
    expect(existsSync(path.join(dir, "b.webm.mismatch"))).toBe(true);
    expect(summarise(report).unusable).toEqual(["b", "c"]);
  });

  it("discards a mismatched download outright on Actions", async () => {
    const dir = tmp();
    const http = fakeHttp({ "https://upload.wikimedia.org/b.webm": "not b" });
    const [r] = await pullLedger({ ledger: { items: [item("b")] }, mediaDir: dir, http, log: () => {}, discard: true });
    expect(r.outcome).toBe("sha-mismatch");
    expect(r.detail).toMatch(/discarded, never used/);
    expect(existsSync(path.join(dir, "b.webm"))).toBe(false);
    expect(existsSync(path.join(dir, "b.webm.mismatch"))).toBe(false);
  });

  it("reports a host's refusal and never retries it elsewhere", async () => {
    const dir = tmp();
    const http = fakeHttp({ "https://upload.wikimedia.org/a.webm": new Refused("x answered 403 (a Cloudflare bot challenge, which is not answered)") });
    const [r] = await pullLedger({ ledger: { items: [item("a")] }, mediaDir: dir, http, log: () => {} });
    expect(r.outcome).toBe("refused");
    expect(r.detail).toMatch(/403/);
    expect(http.calls).toEqual(["https://upload.wikimedia.org/a.webm"]);
  });

  it("leaves a file already there when it matches, and never downloads or recaptures our own property", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.webm"), "a");
    writeFileSync(path.join(dir, "p.png"), "p");                 // the release's exact bytes: the ledger's sha256
    const own = (id: string, over: any = {}) => item(id, { adapter: "voidnews", licence: "own-property", file: `${id}.png`, media_url: "https://x.void-news.pages.dev/paper/", ...over });
    const http = fakeHttp({});
    const report = await pullLedger({ ledger: { items: [item("a"), own("p"), own("q")] }, mediaDir: dir, http, log: () => {}, discard: false });
    expect(report.map((r: any) => r.outcome)).toEqual(["present", "present", "missing"]);
    expect(http.calls).toEqual([]);
    expect(summarise(report).unusable).toEqual(["q"]);
  });

  it("refuses an own-property file whose sha256 is not the ledger's, and never replaces it", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "p.png"), "recaptured on linux");
    const own = item("p", { adapter: "voidnews", licence: "own-property", file: "p.png", media_url: "https://x.void-news.pages.dev/paper/" });
    const http = fakeHttp({ "https://x.void-news.pages.dev/paper/": "p" });
    const [r] = await pullLedger({ ledger: { items: [own] }, mediaDir: dir, http, log: () => {}, discard: false });
    expect(r.outcome).toBe("sha-mismatch");
    expect(r.detail).toMatch(/never recaptured/);
    expect(http.calls).toEqual([]);
    expect(existsSync(path.join(dir, "p.png"))).toBe(false);
    expect(summarise([r]).unusable).toEqual(["p"]);
  });

  it("names the own-property files the sources job places from own-pages-<issue>", () => {
    expect(ownRelease(33)).toBe("own-pages-33");
    const files = ownFiles(LEDGER33());
    expect(files).toHaveLength(11);
    expect(files).toContain("e33-day1-page.png");
    expect(ownFiles({ items: [item("x", { licence: "own-property", file: "../x.png" }), item("y", { licence: "own-property", file: "a b.png" })] })).toEqual([]);
    const wf = readFileSync(path.join(ROOT, ".github/workflows/episode-draft.yml"), "utf8");
    expect(wf).toContain('gh release download "own-pages-$ISSUE"');
    expect(JSON.stringify(parseYaml(wf).jobs.sources)).not.toMatch(/rights\.mjs capture|void--news/);
  });

  it("refuses a ledger file that is not a bare name", async () => {
    const [r] = await pullLedger({ ledger: { items: [item("a", { file: "../a.webm" })] }, mediaDir: tmp(), http: fakeHttp({}), log: () => {} });
    expect(r.outcome).toBe("unusable");
  });
});

describe("output route (draft-outputs.mjs)", () => {
  it("is the artifact route only, refused when any ledger item is not PD, CC or our own", () => {
    const ok = LEDGER33();
    expect(notPublic(ok)).toEqual([]); // issue 33 is public throughout: the pilot may use artifacts
    expect(outputsRoute({ ledger: ok }).route).toBe("artifact");
    for (const licence of ["editorial-use", "fair-use-excerpt", "eu-reuse-credit"]) {
      const l = LEDGER33();
      l.items[0].licence = licence;
      const r = outputsRoute({ ledger: l });
      expect(r.refused).toBe(true);
      expect(r.route).toBe(null);                          // never R2: that route is off (C9)
      expect(r.message).toContain(`${l.items[0].id}: ${licence}`);
      expect(r.message).toContain("C9-r2-route");
    }
  });

  it("refuses an invalid or empty ledger before choosing a route", () => {
    expect(outputsRoute({ ledger: { schema: "omnibus.rights-ledger/1", issue: 33 } }).refused).toBe(true);
    const r = outputsRoute({ ledger: { ...LEDGER33(), items: [] } });
    expect(r.refused).toBe(true);
    expect(r.message).toMatch(/no items|invalid/);
  });

  it("no workflow step reaches R2 while the route is off", () => {
    const text = readFileSync(path.join(ROOT, ".github/workflows/episode-draft.yml"), "utf8");
    const steps = JSON.stringify(parseYaml(text).jobs);
    expect(steps).not.toMatch(/r2\.sh|secrets\.R2_|aws s3/);
    expect(existsSync(path.join(ROOT, "scripts/ci/r2.sh"))).toBe(true);
    expect(existsSync(path.join(ROOT, "docs/tickets/C9-r2-route.md"))).toBe(true);
  });

  it("budget.yaml keeps the draft render's R2 share as planned, within the account's alert, and says it is not enforced", () => {
    const b = BUDGET();
    const row = renderBudget(b)!;
    expect(row.bucket).toBe(BUCKET);
    expect(row.notes).toMatch(/planned share/i);
    expect(row.notes).toMatch(/off|not enforced/i);
    const account = b.quotas.find((q: any) => q.name === "r2_storage_gb")!;
    // snapshots (3 GiB, snapshot-store.mjs) + capture (1.5 GiB, the capture design) + this row + document (0.9 GB)
    expect((3 + 1.5 + row.cap_gib) * GiB + 0.9e9).toBeLessThanOrEqual(account.ceiling * b.alert_at * 1e9);
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
    expect(pickRun(rows, 33)).toBe(null);                    // the only success for 33 is a slice
    expect(pickRun(rows, 33, { slice: true })).toBe(1);
    expect(pickRun([{ databaseId: 5, displayTitle: "episode draft, issue 33", conclusion: "success" }, ...rows], 33)).toBe(5);
    expect(pickRun(rows, 34)).toBe(null);
  });

  it("refuses a slice's manifest unless --slice, and lands the master at <root>/<n>/render/master.mp4", () => {
    expect(wholeFilmRefusal({ run: "1", until: 120 }, false)).toMatch(/--slice/);
    expect(wholeFilmRefusal({ run: "1", until: 120 }, true)).toBe(null);
    expect(wholeFilmRefusal({ run: "1", until: null }, false)).toBe(null);
    expect(landing("D:/omnibus-media", 33, "master.mp4", { win: true })).toBe(String.raw`D:\omnibus-media\33\render\master.mp4`);
    expect(landing("/m", 33, "stems/music_ducked.wav", { win: false })).toBe("/m/33/render/stems/music_ducked.wav");
    const wf = parseYaml(readFileSync(path.join(ROOT, ".github/workflows/episode-draft.yml"), "utf8"));
    const pkg = wf.jobs.render.steps.find((x: any) => x.name === "package the outputs").run;
    expect(pkg).toContain('rsync -a --exclude segments --exclude work "$OUT"/ "$PKG/"');
    expect(pkg).not.toMatch(/\$PKG\/render/);
  });

  it("the render job takes the finished score from its release and checks it before and after the render", () => {
    const wf = parseYaml(readFileSync(path.join(ROOT, ".github/workflows/episode-draft.yml"), "utf8"));
    const runs = wf.jobs.render.steps.map((x: any) => String(x.run ?? "")).join("\n");
    expect(runs).toContain('gh release download "own-score-$ISSUE"');
    expect(runs).toContain('python -m studio.news.score_check "episodes/$ISSUE" --takes-only');
    expect(runs).toContain('python -m studio.news.score_check --journal "$journal"');
    const names = wf.jobs.render.steps.map((x: any) => x.name);
    expect(names.indexOf("every music cue is on disk, and every score-folder cue is a hashed take")).toBeLessThan(names.indexOf("draft render"));
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

describe("unusable items and pull refusals", () => {
  const cli = (args: string[], cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: "utf8" });

  it("exits 1 only when the screenplay or studio ledger cites an unusable item", () => {
    const dir = tmp();
    const report = (ids: string[]) => {
      const f = path.join(dir, `${ids.join("_") || "none"}.json`);
      writeFileSync(f, JSON.stringify({ unusable: ids, items: ids.map((id) => ({ id, outcome: "sha-mismatch" })) }));
      return f;
    };
    expect(cli(["scripts/episode-draft.mjs", "unusable", report(["e33-day6-doc"]), "--issue", "33"]).status).toBe(0);
    const r = cli(["scripts/episode-draft.mjs", "unusable", report(["e33-day1-page"]), "--issue", "33"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cites unusable item\(s\): e33-day1-page/);
  });

  it("the manifest must say which unusables are cited; pull-render refuses R2 until C9", () => {
    expect(manifestProblems({ schema: MANIFEST_SCHEMA, sha: SHA40, unusable: [], files: [{ path: "a", bytes: 1, sha256: "a".repeat(64) }] }))
      .toContain("unusable_cited is not a list");
    const r = cli(["scripts/pull-render.mjs", "33", "--from", "r2", "--dest", path.join(tmp(), "render")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/C9-r2-route/);
  });

  it("a failed own-pages download fails the sources step (no warning fallback)", () => {
    const wf = parseYaml(readFileSync(path.join(ROOT, ".github/workflows/episode-draft.yml"), "utf8"));
    const run = wf.jobs.sources.steps.map((x: any) => String(x.run ?? "")).join("\n");
    expect(run).toContain('gh release download "own-pages-$ISSUE"');
    expect(run).not.toMatch(/::warning::|if ! gh release/);
    const names = wf.jobs.render.steps.map((x: any) => x.name);
    const at = (pre: string) => names.findIndex((n: string | undefined) => String(n ?? "").startsWith(pre));
    expect(at("the score matches")).toBeGreaterThan(-1);
    expect(at("the score matches")).toBeLessThan(at("studio items"));
  });
});

