// void news's own printed pages (ledger class own_property; founder ruling,
// chat 2026-11-12: void news is the same owner's publication). Nothing is
// downloaded here: `node scripts/rights.mjs capture <issue> --media <dir>`
// renders each pinned page in headless Chromium and writes the still and its
// capture record to the media directory (<dir>/<issue>/voidnews-captures.json);
// this adapter reads that record back, so the fetcher can hash the still in
// place and enter it in the ledger with every other item. Net-new.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { OWN_ADAPTER, OWN_PROPERTY } from "../licences.mjs";
import { captureProblems } from "../own-pages.mjs";
import { clip, isoSecond } from "../text.mjs";

export const MANIFEST = "voidnews-captures.json";
export const PUBLICATION = "void news";
export const REPO = "https://github.com/aacrit/void--news";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-02" as "2 Nov 2026". */
export function dayLabel(date) {
  const m = String(date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(date ?? "");
}

/** Pure: the candidate one capture record describes. */
export function parseCapture(rec, { capturedAt }) {
  if (!rec || typeof rec !== "object" || !rec.file) return { status: "not_found", reason: "no capture of this page in the media directory; run node scripts/rights.mjs capture" };
  const o = rec.own_property;
  const kind = o?.edition_check?.kind === "story" ? "story page" : "Paper";
  const target = o?.tour_target;
  const lines = [
    `void news (news.voidvision.org; ${REPO}) is published by the same owner as void omnibus: its pages are our own property, and no licence is needed or claimed.`,
    `Page: ${o?.page_url} (${kind}), from Cloudflare Pages ${o?.deployment?.environment} deployment ${o?.deployment?.id} at ${o?.deployment?.url}, built from commit ${o?.deployment?.source_commit}, deployed ${o?.deployment?.created_at}.`,
    `Built from void news commit ${o?.data_commit}, whose printed-edition record (frontend/build-data/archive.json) holds the edition of ${o?.edition}, printed ${o?.printed_at}. In void news's later record (commit ${o?.next_edition_from?.commit}) ${o?.next_edition_at ? `the next edition was printed ${o.next_edition_at}` : o?.next_edition_from?.edition_is_latest ? "this is still the latest edition" : "no next edition could be read"}.`,
    `Edition check: ${o?.edition_check?.matched} of ${o?.edition_check?.headlines} headline(s) on the page are the edition's rows, in its order (first at position ${o?.edition_check?.first_position}).`,
    `Captured ${o?.page?.width} pixels wide in headless Chromium, colour scheme ${o?.page?.color_scheme}, with ${o?.page?.overlays_hidden} fixed or sticky overlay(s) hidden; the still is the band y ${o?.region?.y} to ${(o?.region?.y ?? 0) + (o?.region?.h ?? 0)} of a ${o?.page?.height}-pixel page.`,
    `${(o?.pictures_excluded ?? []).length} picture element(s) on the page are left out of the still (none is ours to show); nothing is blurred.`,
    ...(o?.no_tour ?? []).map((n) => `No tour rests on y ${n.box.y} to ${n.box.y + n.box.h}: ${n.why}.`),
  ];
  return {
    status: "ok",
    candidate: {
      adapter: OWN_ADAPTER,
      ref: rec.ref,
      kind_hint: "still",
      title: clip(`${PUBLICATION}, printed edition of ${dayLabel(o?.edition)} (${kind})${target?.headline ? `, toured to "${target.headline}"` : ""}`, 400),
      description: "",
      item_url: o?.page_url,
      media_url: o?.page_url,
      local_file: rec.file,
      ext: ".png",
      mime: "image/png",
      bytes_expected: Number.isInteger(rec.bytes) ? rec.bytes : null,
      sha1: null,
      sha256_expected: rec.sha256 ?? null,
      licence_raw: "own property (void news, the same owner)",
      licence: OWN_PROPERTY,
      licence_note: null,
      basis: clip(
        `void news is published by the same owner as void omnibus, so the page is our own property (ledger class own_property). Captured from its Cloudflare Pages deployment ${o?.deployment?.id}, built from commit ${String(o?.data_commit ?? "").slice(0, 12)}, as the edition of ${o?.edition} was served.`,
        1000,
      ),
      credit: `${PUBLICATION}, printed edition of ${dayLabel(o?.edition)}`,
      credit_fields: [],
      evidence: { url: o?.page_url, captured_text: lines.join("\n"), captured_at: rec.captured_at ?? capturedAt },
      date: o?.edition ?? null,
      published_at: isoSecond(o?.deployment?.created_at),
      categories: [],
      keywords: [],
      own_work: false,
      uploader: null,
      own_property: o,
      own_problems: captureProblems(o),
      ai_fields_checked: ["title", "credit", "page headlines"],
    },
  };
}

/** Reads the capture record for ref from the media directory's manifest. */
export async function lookup(ref, { mediaDir, now = () => new Date() } = {}) {
  if (!mediaDir) return { status: "not_found", reason: "own-page captures are read from the media directory, and none was given (dry run)" };
  const file = path.join(mediaDir, MANIFEST);
  if (!existsSync(file)) return { status: "not_found", reason: `${MANIFEST} is not in the media directory; run node scripts/rights.mjs capture first` };
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const rec = (doc.captures ?? []).find((c) => c.ref === ref);
  if (!rec) return { status: "not_found", reason: `no capture of ${clip(ref, 200)} in ${MANIFEST}` };
  if (rec.refused) return { status: "not_found", reason: rec.refused };
  return parseCapture(rec, { capturedAt: isoSecond(now().toISOString()) });
}
