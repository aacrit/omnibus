// The Content ID dispute packet (bible section f), generated per episode
// from its rights ledger into episodes/<issue>/disputes.json, never edited
// by hand: the gate regenerates it and fails when the file differs. For
// every asset: the source address, the licence evidence, the file's sha256,
// in and out points in the master (empty until the render places it), the
// licence's terms and addresses, and the dispute paragraph. Deterministic:
// the same ledger always gives the same bytes. Net-new. Pure.

import { createHash } from "node:crypto";
import { licenceTerms } from "./licences.mjs";

export const PACKET_SCHEMA_ID = "omnibus.disputes/1";
export const PLACEMENT_PENDING = "Not placed yet: in and out points are filled from the master's edit list when the episode is rendered.";

function paragraph(item, terms) {
  const where = "Its in and out points in the episode are listed in this packet once the episode is rendered.";
  const evidence = `The licence was read at ${item.licence_evidence.url} on ${item.licence_evidence.captured_at.slice(0, 10)}, and the text read is kept with this packet.`;
  const file = `The file used has the SHA-256 fingerprint ${item.sha256}.`;
  let rights;
  if (item.licence.startsWith("cc-")) {
    rights = `It is published under the ${terms.name} licence (${terms.deed_url}), which permits reuse, including commercial reuse, with attribution${item.licence.startsWith("cc-by-sa") ? " and share-alike; the episode is itself published under CC BY-SA 4.0" : ""}. The credit it requires is "${item.credit}".`;
  } else if (item.licence === "cc0-1.0") {
    rights = `Its author dedicated it to the public domain under CC0 1.0 (${terms.deed_url}).`;
  } else if (item.licence === "eu-reuse-credit") {
    rights = `It is European Union material reused under Commission Decision 2011/833/EU (${terms.legalcode_url}) with the required credit, "${item.credit}".`;
  } else {
    rights = `It is in the public domain: ${item.basis.replace(/\.$/, "")}.`;
  }
  return `This episode uses "${item.title}" from ${item.item_url}. ${rights} ${evidence} ${file} ${where} We are entitled to use it and ask that the claim be released.`;
}

export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The packet for a validated ledger; ledgerText is the ledger file's exact bytes. */
export function buildDisputePacket(ledger, ledgerText) {
  return {
    schema: PACKET_SCHEMA_ID,
    issue: ledger.issue,
    generated_by: "node scripts/rights.mjs packet <issue>",
    note: "Generated from rights-ledger.json. Never edited by hand: the gate regenerates it and fails on any difference.",
    ledger_sha256: sha256Text(String(ledgerText).replace(/\r\n/g, "\n")),
    assets: ledger.items.map((item) => {
      const terms = licenceTerms(item.licence, item);
      return {
        id: item.id,
        title: item.title,
        source_url: item.item_url,
        media_url: item.media_url,
        sha256: item.sha256,
        credit: item.credit,
        licence: terms,
        licence_evidence: item.licence_evidence,
        basis: item.basis,
        in_point: null,
        out_point: null,
        placement: PLACEMENT_PENDING,
        dispute: paragraph(item, terms),
      };
    }),
  };
}

export function serialisePacket(packet) {
  return `${JSON.stringify(packet, null, 2)}\n`;
}
