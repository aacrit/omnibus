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
export const ADAPTERS = ["commons", "nasa", "loc", "dvids", "gov", "nara", "wayback", "voidnews"];

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

const DATEISH = /^\d{4}(-\d{2}(-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

/**
 * Validates an asset request file (episodes/<issue>/assets.json), the
 * rundown's ranked asks resolved to items (`node scripts/rights.mjs resolve`):
 * { schema, issue, requests: [{ id, kind, title?, fallback?: { tier, text },
 * not_fetched?: [{ tier, host, reason }], candidates: [{ adapter, ref, tier,
 * window?: { from, to }, pinned?, media?, sha256? }] }] }, candidates in
 * ladder order. A request with a fallback may have no candidate at all.
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
    const hasFallback = typeof r?.fallback?.text === "string" && r.fallback.text.trim() !== "";
    if (r?.fallback !== undefined && (!hasFallback || !(r.fallback.tier === null || r.fallback.tier === 4 || r.fallback.tier === 5))) {
      out.push(`${at}.fallback must be { tier: 4, 5 or null, text }`);
    }
    if (!Array.isArray(r?.candidates) || (r.candidates.length === 0 && !hasFallback)) out.push(`${at}.candidates must list at least one candidate, or the request must name its fallback`);
    (r?.candidates ?? []).forEach((c, j) => {
      const cat = `${at}.candidates[${j}]`;
      if (!ADAPTERS.includes(c?.adapter)) out.push(`${cat}.adapter must be one of ${ADAPTERS.join(", ")}`);
      if (typeof c?.ref !== "string" || !c.ref.trim() || c.ref.length > 400) out.push(`${cat}.ref must be a non-empty string`);
      if (!Number.isInteger(c?.tier) || c.tier < 1 || c.tier > 5) out.push(`${cat}.tier must be 1 to 5`);
      if (c?.window !== undefined && !(DATEISH.test(String(c.window?.from)) && DATEISH.test(String(c.window?.to)))) out.push(`${cat}.window must be { from, to } dates`);
      if (c?.media !== undefined && !/^https:\/\/\S+$/.test(String(c.media))) out.push(`${cat}.media must be an https address`);
      if (c?.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(c.sha256))) out.push(`${cat}.sha256 must be 64 hex digits`);
      if (c?.pinned !== undefined && typeof c.pinned !== "boolean") out.push(`${cat}.pinned must be true or false`);
    });
    (r?.not_fetched ?? []).forEach((s, j) => {
      if (!Number.isInteger(s?.tier) || typeof s?.reason !== "string" || !s.reason.trim()) out.push(`${at}.not_fetched[${j}] must be { tier, host, reason }`);
    });
  });
  return out;
}
