import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseWeek } from "../scripts/lib/normalise.mjs";
import { gitSource } from "../scripts/lib/week-sources.mjs";

// The committed record must be exactly what the normaliser writes from void
// news's public history at the record's own commit: the refactor behind the
// snapshot source changed no rule. Uses VOIDNEWS_DIR or ../voidnews when it
// holds that commit, else a blob-less clone (about 5 MB; git fetches only
// the blobs the normaliser reads). Never skipped: no checkout, no pass.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasCommit(dir: string, sha: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    execFileSync("git", ["-C", dir, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function voidnewsAt(sha: string): string {
  for (const dir of [process.env.VOIDNEWS_DIR, path.join(root, "..", "voidnews")]) {
    if (dir && hasCommit(dir, sha)) return dir;
  }
  const clone = path.join(os.tmpdir(), "omnibus-voidnews-partial");
  if (!hasCommit(clone, sha)) {
    if (existsSync(path.join(clone, ".git"))) execFileSync("git", ["-C", clone, "fetch", "-q", "origin"], { stdio: "ignore" });
    else {
      mkdirSync(path.dirname(clone), { recursive: true });
      execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", "https://github.com/aacrit/void--news", clone], { stdio: "ignore" });
    }
  }
  return clone;
}

// Each committed record is rebuilt with the options it records: its schema
// (absent means 1, week 32's rules) and, from schema 2, its echo as picked
// (a slug, or "pending" before one is picked).
for (const issue of [32, 33]) {
  describe(`data/week-${issue}.json`, () => {
    it("is rebuilt byte for byte by the git source at its own commit", async () => {
      const text = readFileSync(path.join(root, "data", `week-${issue}.json`), "utf8");
      const rec = JSON.parse(text);
      const at = rec.normalised_from.origin_main as string;
      expect(at).toMatch(/^[0-9a-f]{40}$/);
      const options = rec.schema ? { schema: rec.schema, echo: rec.echo.status === "pending" ? "pending" : rec.echo.slug } : {};
      const out = await normaliseWeek(gitSource(voidnewsAt(at), { at }), issue, options);
      expect(JSON.stringify(out, null, 2) + "\n").toBe(text);
    }, 240_000);
  });
}
