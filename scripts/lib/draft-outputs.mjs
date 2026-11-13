// Where an Actions draft render's outputs may go (C8, .github/workflows/episode-draft.yml), and the manifest that
// lets the laptop check what it pulls (scripts/pull-render.mjs). Pure, except the two file helpers at the end.
//
// The repo is public, so a workflow artifact is public too: anyone can download it. The artifact route is allowed
// only when every item the episode's rights ledger holds is public domain, Creative Commons or our own property, all
// of which anyone may already copy. Editorial-use, fair-use and EU-reuse items (and anything else) need the private
// R2 route; without its secrets the run refuses before it renders. Net-new.

import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CC_VERSIONS, OWN_PROPERTY, PD_BASES, SA_VERSIONS } from "./rights/licences.mjs";

export const BUCKET = "omnibus-capture";
export const MANIFEST = "render-manifest.json";
export const MANIFEST_SCHEMA = "omnibus.render-manifest/1";

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

/**
 * The outputs' route: "r2" whenever its secrets exist (private), else "artifact" when every ledger item is public,
 * else refused with the reason. Returns { route, refused, message }.
 */
export function outputsRoute({ ledger, hasR2 }) {
  if (hasR2) return { route: "r2", refused: false, message: `outputs go to R2 bucket ${BUCKET} (private)` };
  const bad = notPublic(ledger);
  if (!bad.length) {
    return { route: "artifact", refused: false, message: `no R2 secrets: every one of the ${(ledger?.items ?? []).length} ledger items is public domain, CC or our own property, so the outputs go to a short-lived workflow artifact (public on this public repo)` };
  }
  return {
    route: null,
    refused: true,
    message: `refused: no R2 secrets, and a workflow artifact on this public repo is public, but ${bad.length} ledger item(s) are not public domain, CC or our own property (${bad.map((b) => `${b.id}: ${b.licence}`).join(", ")}). Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ACCOUNT_ID to render this episode on Actions.`,
  };
}

/** Problems with a render manifest's shape (pure). */
export function manifestProblems(m) {
  const p = [];
  if (!m || m.schema !== MANIFEST_SCHEMA) p.push(`schema is not ${MANIFEST_SCHEMA}`);
  if (!Array.isArray(m?.files) || !m.files.length) p.push("files is not a non-empty list");
  for (const f of m?.files ?? []) {
    const rel = String(f?.path ?? "");
    if (!rel || path.posix.isAbsolute(rel) || rel.split("/").includes("..") || rel.includes("\\") || /^[A-Za-z]:/.test(rel)) p.push(`bad path ${JSON.stringify(f?.path)}`);
    if (!/^[0-9a-f]{64}$/.test(String(f?.sha256 ?? ""))) p.push(`${rel}: bad sha256`);
    if (!Number.isInteger(f?.bytes) || f.bytes < 0) p.push(`${rel}: bad bytes`);
  }
  return p;
}

/** Each manifest file against what is on disk: [{path, ok, why}]. `stat` and `sha` are injected (pure). */
export async function verifyFiles(manifest, dir, { stat, sha }) {
  const out = [];
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

export async function buildManifest(dir, { issue, run = null }) {
  const files = [];
  for (const rel of listFiles(dir)) {
    const p = path.join(dir, ...rel.split("/"));
    files.push({ path: rel, bytes: statSync(p).size, sha256: await sha256File(p) });
  }
  return { schema: MANIFEST_SCHEMA, issue, run, files };
}
