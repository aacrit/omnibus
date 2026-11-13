// scripts/lint-workflows.mjs (rule 1, rule 14). The Python half (studio/tests/**/*.py: pytest skip/skipif/xfail
// marks and calls, importorskip) is transplanted from document@b62c4fa; this test covers it, since neither
// repo had a dedicated test for the script before (PR omnibus#10's reviewer).
import { describe, expect, it } from "vitest";
import { checkSkippedTestLine, checkWorkflowText } from "../scripts/lint-workflows.mjs";

const NOW = new Date("2026-11-12T00:00:00Z");

describe("checkSkippedTestLine, Python", () => {
  it("passes a pytest.mark.skip with a near expiry and a local issue ref", () => {
    const line = '@pytest.mark.skip(reason="flaky on CI")  # expires 2026-11-20 issue #42';
    expect(checkSkippedTestLine(line, NOW, "py")).toBeNull();
  });

  it("passes a pytest.mark.xfail with a cross-repo issue ref (a mark lifted from another repo)", () => {
    const line = '@pytest.mark.xfail(strict=True, reason="...")  # expires 2026-11-22 issue aacrit/document#9';
    expect(checkSkippedTestLine(line, NOW, "py")).toBeNull();
  });

  it("catches pytest.skip(), pytest.xfail() and importorskip with no annotation", () => {
    for (const line of [
      "pytest.skip(\"no ffmpeg\")",
      "pytest.xfail(\"not yet\")",
      'np = pytest.importorskip("numpy")',
      "@pytest.mark.skipif(sys.platform == \"win32\", reason=\"posix only\")",
    ]) {
      expect(checkSkippedTestLine(line, NOW, "py")).toMatch(/no "# expires/);
    }
  });

  it("refuses an expiry more than 14 days out", () => {
    const line = "@pytest.mark.skip(reason=\"wip\")  # expires 2026-12-15 issue #1";
    expect(checkSkippedTestLine(line, NOW, "py")).toMatch(/more than 14 days out/);
  });

  it("refuses an expiry that has already passed", () => {
    const line = "@pytest.mark.skip(reason=\"wip\")  # expires 2026-11-01 issue #1";
    expect(checkSkippedTestLine(line, NOW, "py")).toMatch(/expiry has passed/);
  });

  it("ignores a line with no skip/skipif/xfail/importorskip", () => {
    expect(checkSkippedTestLine("def test_a_plain_case():", NOW, "py")).toBeNull();
    expect(checkSkippedTestLine("skipper = 1  # not a mark", NOW, "py")).toBeNull();
  });

  it("does not cross-apply the JS // comment style to a Python line, or vice versa", () => {
    const pyLineJsComment = "@pytest.mark.skip(reason=\"x\")  // expires 2026-11-20 issue #1";
    expect(checkSkippedTestLine(pyLineJsComment, NOW, "py")).toMatch(/no "# expires/);
    const jsLineNoLang = 'it.skip("x", () => {});  // expires 2026-11-20 issue #1';
    expect(checkSkippedTestLine(jsLineNoLang, NOW)).toBeNull();
  });
});

describe("checkWorkflowText, unaffected by the Python port", () => {
  it("still catches an advisory-gate escape hatch", () => {
    const v = checkWorkflowText("gate.yml", "      - run: npm test || true\n");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/forbidden pattern/);
  });
});
