// `node scripts/rights.mjs capture <issue> --media <dir> [--voidnews <checkout>]`:
// renders each void news page the episode's pins name (adapter voidnews) in
// headless Chromium (scripts/capture_page.py), checks it against the edition
// record at the commit it was built from (own-pages.mjs), crops it to the band
// that holds the tour target and no picture, and writes the stills and
// <media>/<issue>/voidnews-captures.json for the voidnews adapter. I/O only;
// every decision is in own-pages.mjs. Net-new.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MANIFEST, PUBLICATION, REPO } from "./adapters/voidnews.mjs";
import { PAGE_WIDTH, MAX_PICTURES_RECORDED, captureProblems, chooseRegion, editionCheck, editionOf, intersects, picturesOnPage, targetBox } from "./own-pages.mjs";
import { isoSecond } from "./text.mjs";

const ARCHIVE = "frontend/build-data/archive.json";

function runBrowser(python, script, jobs, workDir) {
  const jobsFile = path.join(workDir, "jobs.json");
  const outFile = path.join(workDir, "result.json");
  writeFileSync(jobsFile, JSON.stringify(jobs));
  execFileSync(python, [script, jobsFile, outFile], { stdio: ["ignore", "inherit", "inherit"], timeout: 30 * 60_000 });
  return JSON.parse(readFileSync(outFile, "utf8"));
}

export async function runCapture({ root, issue, mediaDir, voidnewsDir, python = "python", now = () => new Date(), log = console.log }) {
  const pins = JSON.parse(readFileSync(path.join(root, "episodes", String(issue), "asset-pins.json"), "utf8")).pins;
  const own = Object.entries(pins).flatMap(([request_id, list]) => list.filter((p) => p.adapter === "voidnews").map((p) => ({ ...p, request_id })));
  const issueMedia = path.join(mediaDir, String(issue));
  const work = path.join(issueMedia, ".capture");
  mkdirSync(work, { recursive: true });
  const script = path.join(root, "scripts", "capture_page.py");
  // The later printed-edition record: void news's main as this checkout last fetched it.
  const laterCommit = execFileSync("git", ["-C", voidnewsDir, "rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  const archives = new Map();
  const archiveAt = (sha) => {
    if (!archives.has(sha)) archives.set(sha, JSON.parse(execFileSync("git", ["-C", voidnewsDir, "show", `${sha}:${ARCHIVE}`], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })));
    return archives.get(sha);
  };
  // One full-page render per distinct page.
  const pages = [...new Set(own.map((p) => p.ref.split("#")[0]))];
  const full = new Map();
  const shots = runBrowser(python, script, pages.map((url, i) => ({ url, out: path.join(work, `page-${i}.png`), width: PAGE_WIDTH })), work);
  for (const s of shots) full.set(s.url, s);
  const captures = [];
  const clips = [];
  const capturedAt = isoSecond(now().toISOString());
  for (const p of own) {
    const url = p.ref.split("#")[0];
    const shot = full.get(url);
    const refuse = (why) => (captures.push({ ref: p.ref, request_id: p.request_id, refused: why }), log(`${p.request_id}: refused: ${why}`));
    // A stale still from an earlier run never survives a refusal, whatever the refusal.
    rmSync(path.join(issueMedia, `${p.request_id}.png`), { force: true });
    if (!shot || shot.status !== 200) {
      refuse(`${url} answered ${shot?.status ?? "nothing"}`);
      continue;
    }
    // The edition from the record the page was built from; the next edition from void news's later record.
    const ed = editionOf(archiveAt(p.data_commit), p.edition, archiveAt(laterCommit));
    if (!ed) {
      refuse(`the record at ${p.data_commit} holds no edition of ${p.edition}`);
      continue;
    }
    const row = ed.rows.find((r) => r.id === p.target_row);
    const check = editionCheck({ kind: p.page_kind, heads: shot.heads, rows: ed.rows, targetId: p.target_row });
    const box = row ? targetBox({ kind: p.page_kind, heads: shot.heads, title: row.title }) : null;
    const pictures = picturesOnPage(shot.pics);
    const region = chooseRegion({ width: shot.viewport_width, height: shot.height, pictures, target: box });
    if (check.problems.length || !row || !box || !region) {
      refuse([...check.problems, !row ? "the target row is not in the edition" : null, row && !box ? "the target headline is not on the page" : null, box && !region ? "no band of the page holds the target without a picture" : null].filter(Boolean).join("; "));
      continue;
    }
    const { problems, ...edition_check } = check;
    const rec = {
      ref: p.ref,
      request_id: p.request_id,
      file: `${p.request_id}.png`,
      captured_at: capturedAt,
      own_property: {
        publication: PUBLICATION,
        repo: REPO,
        edition: p.edition,
        printed_at: ed.printed_at,
        next_edition_at: ed.next_edition_at,
        next_edition_from: { commit: laterCommit, edition_is_latest: ed.edition_is_latest },
        data_commit: p.data_commit,
        deployment: p.deployment,
        page_url: url,
        page: { width: shot.viewport_width, height: shot.height, color_scheme: "light", title: String(shot.title ?? "").slice(0, 400), overlays_hidden: Number(shot.overlays_hidden ?? 0) },
        edition_check,
        tour_target: { row_id: row.id, position: row.pos, headline: row.title, box },
        region,
        pictures_excluded: pictures.slice(0, MAX_PICTURES_RECORDED),
        no_tour: (shot.no_tour ?? []).filter((n) => n?.box && n.box.h > 0 && intersects(n.box, region)).map((n) => ({ why: String(n.why).slice(0, 200), box: n.box })),
      },
    };
    // The same rules the fetcher and the lint apply, applied before any still is kept.
    const bad = captureProblems(rec.own_property);
    if (bad.length) {
      refuse(bad.join("; "));
      continue;
    }
    const whole = region.y === 0 && region.h === shot.height;
    if (whole) copyFileSync(shot.out, path.join(issueMedia, rec.file));
    else clips.push({ url, out: path.join(issueMedia, rec.file), width: PAGE_WIDTH, clip: region });
    captures.push(rec);
  }
  if (clips.length) runBrowser(python, script, clips, work);
  for (const c of captures.filter((x) => x.file)) {
    const buf = readFileSync(path.join(issueMedia, c.file));
    c.sha256 = createHash("sha256").update(buf).digest("hex");
    c.bytes = buf.byteLength;
    log(`${c.request_id}: ${c.file} (${c.bytes} bytes), band ${c.own_property.region.y} to ${c.own_property.region.y + c.own_property.region.h}, ${c.own_property.pictures_excluded.length} picture(s) left out`);
  }
  rmSync(work, { recursive: true, force: true });
  const out = path.join(issueMedia, MANIFEST);
  writeFileSync(out, `${JSON.stringify({ issue, written_at: capturedAt, captures }, null, 2)}\n`);
  return out;
}
