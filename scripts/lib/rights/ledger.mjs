// The rights ledger: one JSON file per episode, episodes/<issue>/rights-ledger.json,
// written only by `node scripts/rights.mjs fetch` and validated against
// ledger.schema.json. Media never sits beside it (rule 8): `file` is a bare
// name inside the media directory, which lives outside the repo.
// Pure apart from loading the schema once.

import { readFileSync } from "node:fs";
import { validate } from "./json-schema.mjs";

export const LEDGER_SCHEMA = JSON.parse(readFileSync(new URL("./ledger.schema.json", import.meta.url), "utf8"));
export const SCHEMA_ID = "omnibus.rights-ledger/1";
export const REQUESTS_SCHEMA_ID = "omnibus.asset-requests/1";
export const KINDS = ["still", "footage", "sound", "document"];
export const ADAPTERS = ["commons", "nasa", "loc", "dvids"];

export function emptyLedger(issue) {
  return { schema: SCHEMA_ID, issue, items: [], rejected: [] };
}

/** JSON-schema problems plus the cross-item rules a schema cannot state. */
export function validateLedger(ledger) {
  const problems = validate(LEDGER_SCHEMA, ledger);
  if (problems.length) return problems;
  const ids = new Set();
  const requests = new Set();
  for (const it of ledger.items) {
    if (ids.has(it.id)) problems.push(`$.items: duplicate id ${it.id}`);
    ids.add(it.id);
    if (requests.has(it.request_id)) problems.push(`$.items: request ${it.request_id} is filled twice`);
    requests.add(it.request_id);
    if (it.rights_checked.date < it.licence_evidence.captured_at.slice(0, 10)) {
      problems.push(`${it.id}: rights_checked.date ${it.rights_checked.date} is before the evidence was captured (${it.licence_evidence.captured_at})`);
    }
  }
  return problems;
}

/** The ledger as written to disk: stable key order, two-space indent, trailing newline. */
export function serialiseLedger(ledger) {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

/**
 * Validates an asset request file (episodes/<issue>/assets.json), the
 * rundown's ranked asks: { schema, issue, requests: [{ id, kind, title?,
 * candidates: [{ adapter, ref, tier }] }] }, candidates in ladder order.
 */
export function validateRequests(doc) {
  const out = [];
  if (doc?.schema !== REQUESTS_SCHEMA_ID) out.push(`schema must be ${REQUESTS_SCHEMA_ID}`);
  if (!Number.isInteger(doc?.issue) || doc.issue < 1) out.push("issue must be a positive integer");
  if (!Array.isArray(doc?.requests)) return [...out, "requests must be an array"];
  const seen = new Set();
  doc.requests.forEach((r, i) => {
    const at = `requests[${i}]`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(r?.id ?? ""))) out.push(`${at}.id must be a short id (letters, digits, . _ -)`);
    if (seen.has(r?.id)) out.push(`${at}.id ${r.id} is repeated`);
    seen.add(r?.id);
    if (!KINDS.includes(r?.kind)) out.push(`${at}.kind must be one of ${KINDS.join(", ")}`);
    if (!Array.isArray(r?.candidates) || r.candidates.length === 0) out.push(`${at}.candidates must list at least one candidate`);
    (r?.candidates ?? []).forEach((c, j) => {
      if (!ADAPTERS.includes(c?.adapter)) out.push(`${at}.candidates[${j}].adapter must be one of ${ADAPTERS.join(", ")}`);
      if (typeof c?.ref !== "string" || !c.ref.trim() || c.ref.length > 400) out.push(`${at}.candidates[${j}].ref must be a non-empty string`);
      if (!Number.isInteger(c?.tier) || c.tier < 1 || c.tier > 5) out.push(`${at}.candidates[${j}].tier must be 1 to 5`);
    });
  });
  return out;
}
