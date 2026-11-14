#!/usr/bin/env node
// Runs every gate step in order and stops at the first failure. This is the
// only thing CI (`gate.yml`) and the /ship skill's verifier run.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBin } from "./lib/run-bin.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNode(relativeScript) {
  return spawnSync(process.execPath, [path.join(repoRoot, relativeScript)], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
}

// The studio's Python: OMNIBUS_PYTHON, else the studio venv in ~/omnibus-work, else the house studio venv in
// ~/document-work (the engine transplanted at studio/engine/* is byte-identical, so its venv matches), else
// python3 / python on PATH (CI installs one with setup-python per studio/requirements-studio.txt). A missing
// interpreter or pytest fails the step; it is never skipped.
function studioPython() {
  if (process.env.OMNIBUS_PYTHON) return process.env.OMNIBUS_PYTHON;
  const bin = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  for (const home of ["omnibus-work", "document-work"]) {
    const venv = path.join(os.homedir(), home, ".venv", bin);
    if (existsSync(venv)) return venv;
  }
  return process.platform === "win32" ? "python" : "python3";
}

const STEPS = [
  { label: "typecheck (web)", run: () => runBin("typescript", "tsc", ["-p", "web/tsconfig.json", "--noEmit"], { cwd: repoRoot }) },
  { label: "typecheck (worker)", run: () => runBin("typescript", "tsc", ["-p", "worker/tsconfig.json", "--noEmit"], { cwd: repoRoot }) },
  // The build is a gate step: it injects the CSP and fails on any page that
  // breaks it, and writes dist/_headers (R-33).
  { label: "build", run: () => runNode("scripts/build.mjs") },
  {
    label: "test",
    run: () =>
      runBin("vitest", "vitest", ["run", "--reporter=default", "--reporter=json", "--outputFile=.vitest-report.json"], {
        cwd: repoRoot,
      }),
  },
  // A fast subset of the lifted engine's suite (docs/TRANSPLANT-document-engine.md), chosen by measured time
  // (coordinator ruling 2026-11-12, after PR omnibus#10's gate took 20+ minutes): the areas omnibus's own
  // tickets read from directly (aswas/A0 show-as-was, clips/A44 conform, pages, disclosure/A56, counts/A31 and
  // maps/A56 and a net-new palette-vs-tokens guard, 601 cases, measured 187s on CI for the 597 before it), none of which need the session-scoped ``rendered``/``plan``
  // fixture that makes render core, layers/stems, narrator and the titles/score audio checks slow
  // (test_render.py alone: ~4 min locally). Those run in full in .github/workflows/studio-full.yml instead
  // (docs/DECISIONS.md). pytest exits non-zero on 0 tests, so a typo'd path here fails loudly, not silently.
  {
    label: "studio-test",
    run: () =>
      spawnSync(
        studioPython(),
        [
          "-m", "pytest",
          "studio/tests/test_a0_show_as_was.py",
          "studio/tests/test_r11_clips.py",
          "studio/tests/test_pages.py",
          "studio/tests/test_a56_disclosure.py",
          "studio/tests/test_counts.py",
          "studio/tests/test_maps.py",
          "studio/tests/test_a56_map_credit.py",
          "studio/tests/test_house_tokens_match_palette.py",
          "studio/tests/test_news_lints.py",   // E3: the news lints, pure (a pass and a fail fixture per lint)
          "studio/tests/test_e9i_ledgers.py",  // E9i: licence map, E6 adapter, vision/voicing manifests (pure, <1 s)
          "studio/tests/test_c8_mediaroot.py", // C8: media roots by env, studio-items plan, graphics-ledger compare (pure, <1 s)
          // E6: broadcast graphics (studio/graphics/*). Fast and browser-free by design (layout math, motion
          // timing, the ledger, counts-match, graphics-clean, HTML building on fixtures): the actual Chromium
          // render (studio/graphics/render.py) is a separate script, never part of the gate (docs/DECISIONS.md).
          "studio/tests/test_graphics_layout.py",
          "studio/tests/test_graphics_svgparts.py",
          "studio/tests/test_graphics_motion.py",
          "studio/tests/test_graphics_ledger.py",
          "studio/tests/test_graphics_countsmatch.py",
          "studio/tests/test_graphics_clean.py",
          "studio/tests/test_graphics_compose.py",
          "studio/tests/test_graphics_data.py",
          "studio/tests/test_graphics_typeset.py",
          "studio/tests/test_graphics_fixtures.py",
          "studio/tests/test_graphics_expected.py",
          "studio/tests/test_graphics_framesheet.py",
          "-q", "-p", "no:cacheprovider",
        ],
        { cwd: repoRoot, stdio: "inherit", shell: false },
      ),
  },
  { label: "lint-size", run: () => runNode("scripts/lint-size.mjs") },
  { label: "lint-workflows", run: () => runNode("scripts/lint-workflows.mjs") },
  { label: "lint-design", run: () => runNode("scripts/lint-design.mjs") },
  { label: "lint-docs", run: () => runNode("scripts/lint-docs.mjs") },
  { label: "lint-events", run: () => runNode("scripts/lint-events.mjs") },
  // Rights (bible section j): licence-allowlist, licence-evidence, ai-generated-share-zero.
  { label: "lint-rights", run: () => runNode("scripts/lint-rights.mjs") },
  { label: "gate-selftest", run: () => runNode("scripts/gate-selftest.mjs") },
];

for (const step of STEPS) {
  console.log(`\n=== gate: ${step.label} ===`);
  const result = step.run();
  if (result.error) {
    console.error(`gate: failed to run "${step.label}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\ngate: FAILED at "${step.label}" (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log("\ngate: all steps passed");
