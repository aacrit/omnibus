// Where an Actions draft render's files may go (C8, .github/workflows/episode-draft.yml), the R2 cap that bounds
// them, and the manifest that lets the laptop check what it pulls (scripts/pull-render.mjs). Pure, except the file
// helpers at the end.
//
// The repo is public, so a workflow artifact is public too: anyone can download it. The artifact route, the only
// one on, is allowed only when every item the episode's rights ledger holds is public domain, Creative Commons or
// our own property, all of which anyone may already copy; otherwise the run refuses before it renders. The private
// R2 route is off (docs/tickets/C9-r2-route.md).
// Net-new.

import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { validateLedger } from "./rights/ledger.mjs";
import { CC_VERSIONS, OWN_PROPERTY, PD_BASES, SA_VERSIONS } from "./rights/licences.mjs";

export const BUCKET = "omnibus-capture";
export const MANIFEST = "render-manifest.json";
export const MANIFEST_SCHEMA = "omnibus.render-manifest/2";
export const BUDGET_ROW = "r2_draft_render_gb";
/** A manifest path: forward slashes, word characters, dots and hyphens only (no spaces, drives or backslashes). */
export const PATH_RE = /^[\w./-]+$/;

/** Licence ids anyone may copy: an artifact on a public repo may carry them. */
export const PUBLIC_IDS = new Set([
  ...PD_BASES,
  "cc0-1.0",
  ...CC_VERSIONS.map((v) => `cc-by-${v}`),
  ...SA_VERSIONS.map((v) => `cc-by-sa-${v}`),
  OWN_PROPERTY,
]);

/** The ledger items an artifact may not carry, with their licence. */
export function notPublic(ledger) {
  return (ledger?.items ?? []).filter((i) => !PUBLIC_IDS.has(i.licence)).map((i) => ({ id: i.id, licence: i.licence ?? null }));
}

/** budget.yaml's draft-render R2 row, or null. */
export function renderBudget(budget) {
  const row = (budget?.quotas ?? []).find((q) => q.name === BUDGET_ROW);
  return row && Number(row.cap_gib) > 0 ? row : null;
}

/**
 * The route. Only "artifact" is reachable (CoS decision 2026-11-13, docs/DECISIONS.md C8): allowed when every
 * ledger item is public domain, CC or our own property, else refused with the reason. A ledger that fails its own
 * schema, or holds no items, is refused first. The R2 route (scripts/ci/r2.sh, r2CapProblem below) is off until
 * docs/tickets/C9-r2-route.md is done: its cap could be passed by the three stage jobs uploading at once, and it
 * has never run. Returns { route, refused, message }.
 */
export function outputsRoute({ ledger }) {
  const refuse = (message) => ({ route: null, refused: true, message: `refused: ${message}` });
  const problems = validateLedger(ledger ?? {});
  if (problems.length) return refuse(`the rights ledger is invalid (${problems.slice(0, 3).join("; ")})`);
  if (!ledger.items?.length) return refuse("the rights ledger holds no items: there is nothing to render from");
  const bad = notPublic(ledger);
  if (!bad.length) {
    return { route: "artifact", refused: false, message: `every one of the ${ledger.items.length} ledger items is public domain, CC or our own property, so the files go to short-lived workflow artifacts (public on this public repo)` };
  }
  return refuse(`a workflow artifact on this public repo is public, but ${bad.length} ledger item(s) are not public domain, CC or our own property (${bad.map((b) => `${b.id}: ${b.licence}`).join(", ")}). The private R2 route is off until docs/tickets/C9-r2-route.md is done, so this episode cannot be rendered on Actions yet.`);
}

/** Unreachable while the R2 route is off (C9): why `bytes` more may not go to the bucket's render/ prefix, which already lists `listed` bytes, or null. */
export function r2CapProblem({ bytes, listed, budget }) {
  const row = renderBudget(budget);
  if (!row) return `budget.yaml has no ${BUDGET_ROW} row`;
  const cap = Number(row.cap_gib) * 1024 ** 3;
  if (!Number.isFinite(bytes) || !Number.isFinite(listed) || bytes < 0 || listed < 0) return "the sizes are not byte counts";
  if (bytes + listed > cap) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GiB more on the ${(listed / 1024 ** 3).toFixed(2)} GiB render/ already lists is over the ${row.cap_gib} GiB cap (budget.yaml ${BUDGET_ROW})`;
  }
  return null;
}

/** Problems with a render manifest's shape (pure). */
export function manifestProblems(m) {
  const p = [];
  if (!m || m.schema !== MANIFEST_SCHEMA) p.push(`schema is not ${MANIFEST_SCHEMA}`);
  if (!/^[0-9a-f]{40}$/.test(String(m?.sha ?? ""))) p.push("sha is not a commit");
  if (!Array.isArray(m?.files) || !m.files.length) p.push("files is not a non-empty list");
  if (!Array.isArray(m?.unusable)) p.push("unusable is not a list");
  for (const f of m?.files ?? []) {
    const rel = String(f?.path ?? "");
    if (!PATH_RE.test(rel) || rel.startsWith("/") || rel.split("/").some((s) => s === ".." || s === "." || s === "")) p.push(`bad path ${JSON.stringify(f?.path)}`);
    if (!/^[0-9a-f]{64}$/.test(String(f?.sha256 ?? ""))) p.push(`${rel}: bad sha256`);
    if (!Number.isInteger(f?.bytes) || f.bytes < 0) p.push(`${rel}: bad bytes`);
  }
  return p;
}

/**
 * Each manifest file against what is on disk, and every file on disk the manifest does not list (refused, so nothing
 * unlisted rides along): [{path, ok, why}]. `stat`, `sha` and `list` are injected.
 */
export async function verifyFiles(manifest, dir, { stat, sha, list = listFiles }) {
  const out = [];
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const rel of list(dir)) if (!listed.has(rel)) out.push({ path: rel, ok: false, why: "not in the manifest" });
  for (const f of manifest.files) {
    const p = path.join(dir, ...f.path.split("/"));
    const st = stat(p);
    if (!st) out.push({ path: f.path, ok: false, why: "missing" });
    else if (st.size !== f.bytes) out.push({ path: f.path, ok: false, why: `${st.size} bytes, the manifest says ${f.bytes}` });
    else {
      const got = await sha(p);
      out.push(got === f.sha256 ? { path: f.path, ok: true, why: null } : { path: f.path, ok: false, why: `sha256 ${got.slice(0, 12)} is not ${f.sha256.slice(0, 12)}` });
    }
  }
  return out;
}

export function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(p).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

export function statOrNull(p) {
  try {
    const st = statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** Every file under `dir` (relative, forward slashes, sorted), the manifest itself left out. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.filter((f) => f !== MANIFEST).sort();
}

/** The manifest of `dir`: what was rendered (sha, ref, until, res), what could not be used, and every file. */
export async function buildManifest(dir, { issue, run = null, sha, ref = null, until = null, res = null, unusable = [] }) {
  const files = [];
  for (const rel of listFiles(dir)) {
    if (!PATH_RE.test(rel)) throw new Error(`${rel}: a file name outside ${PATH_RE} cannot be listed`);
    const p = path.join(dir, ...rel.split("/"));
    files.push({ path: rel, bytes: statSync(p).size, sha256: await sha256File(p) });
  }
  return { schema: MANIFEST_SCHEMA, issue, run, sha, ref, until: until === "" ? null : until, res, unusable, files };
}
