// Ukraine's state sources, through their Wikimedia Commons uploads (T5, show
// bible v2 section n): president.gov.ua answers 403 to our honest request, and
// that refusal is never worked around, so these bodies' pictures are taken
// only as Commons transfers. Four bodies publish under CC BY 4.0 on their own
// sites: the Security Service (SSU), the Office of the President, the Kyiv City
// State Administration and the State Emergency Service (SES).
//
// A file passes as one body's only when its own Commons record shows it: the
// licence Commons reads is CC BY 4.0, the file page carries that body's licence
// template, its author is that body, and its |source= is a page on that body's
// own site, where the CC BY 4.0 terms apply. A picture the body posted on X,
// Telegram or YouTube is not under its site's terms, and is refused. Every
// Commons check still runs (the uploader, the refused sources, the YouTube-copy
// marks review, AI provenance). The item carries the party label
// RELEASED BY <body>. Net-new. Pure apart from lookup().

import * as commons from "./commons.mjs";
import { hostOf } from "../licences.mjs";
import { partyLabel } from "../records.mjs";
import { sourceLines } from "../sources.mjs";
import { clip } from "../text.mjs";

/** The bodies, as bible v2 section n names them (CoS, 2026-11-21). */
export const BODIES = Object.freeze([
  {
    id: "ssu",
    body: "the Security Service of Ukraine",
    hosts: ["ssu.gov.ua"],
    template: /\{\{\s*Ssu\.gov\.ua\s*(?:\||\}\})/i,
    author: /Security Service (?:of )?Ukraine|\bSBU\b|\bSSU\b|Служба безпеки України|\bСБУ\b/i,
  },
  {
    id: "op",
    body: "the Office of the President of Ukraine",
    hosts: ["president.gov.ua"],
    template: /\{\{\s*President\.gov\.ua\s*(?:\||\}\})/i,
    author: /Office of the President of Ukraine|Офіс Президента України/i,
  },
  {
    id: "kcsa",
    body: "the Kyiv City State Administration",
    hosts: ["kyivcity.gov.ua"],
    template: /\{\{\s*kyivcity\.gov\.ua\s*(?:\||\}\})/i,
    author: /Kyiv City State Administration|Київська міська державна адміністрація|\bКМДА\b/i,
  },
  {
    id: "ses",
    body: "the State Emergency Service of Ukraine",
    hosts: ["dsns.gov.ua"],
    template: /\{\{\s*dsns\.gov\.ua\s*(?:\||\}\})/i,
    author: /State Emergency Service of Ukraine|Державна служба України з надзвичайних ситуацій|\bДСНС\b/i,
  },
]);

const onHost = (url, hosts) => {
  const h = hostOf(url);
  return Boolean(h) && hosts.some((x) => h === x || h.endsWith(`.${x}`));
};

/**
 * Pure: a Commons candidate read as a Ukrainian state body's release. Returns the commons result with the
 * candidate turned into a uastate one; any reason it is not shown to be the body's own lands in
 * adapter_problems, so checkCandidate refuses it.
 */
export function asStateRelease(result) {
  if (result?.status !== "ok") return result;
  const c = result.candidate;
  const wikitext = String(c.source_text ?? "");
  const authorLines = sourceLines(wikitext).filter((l) => /^\|\s*author\s*=/.test(l));
  const problems = [];
  const body = BODIES.find((b) => b.template.test(wikitext)) ?? null;
  if (!body) problems.push("the file page carries none of the Ukrainian state bodies' licence templates ({{Ssu.gov.ua}}, {{President.gov.ua}}, {{kyivcity.gov.ua}}, {{dsns.gov.ua}})");
  if (c.licence !== "cc-by-4.0") problems.push(`Commons reads its licence as ${c.licence_raw ?? "none"}, not CC BY 4.0`);
  const sources = [...new Set(sourceLines(wikitext).filter((l) => /^\|\s*source\s*=/.test(l)).flatMap((l) => [...l.matchAll(/https?:\/\/[^\s\]|}<>"]+/g)].map((m) => m[0])))];
  if (body) {
    const named = [...(c.credit_fields ?? []), ...authorLines].some((t) => body.author.test(String(t)));
    if (!named) problems.push(`its author is not ${body.body} (Artist ${clip(c.credit_fields?.[0] ?? "(none)", 80)})`);
    const own = sources.filter((u) => onHost(u, body.hosts));
    if (!own.length) {
      problems.push(`its source is not a page on ${body.body}'s own site (${body.hosts.join(", ")}), where the CC BY 4.0 terms apply: ${sources.map((u) => clip(u, 100)).join("; ") || "no source address"}`);
    }
  }
  const releasedBy = body?.body ?? null;
  const evidence = {
    ...c.evidence,
    captured_text: clip(
      [
        c.evidence.captured_text,
        `State body: ${releasedBy ?? "(none shown)"}; licence template: ${body ? wikitext.match(body.template)?.[0] : "(none)"}; source: ${sources.join(" ") || "(none)"}.`,
        problems.length ? `Refused as a state release: ${problems.join("; ")}.` : `A release of ${releasedBy} under CC BY 4.0 on its own site, transferred to Commons; party label ${partyLabel(releasedBy)}.`,
      ].join("\n"),
      4000,
    ),
  };
  return {
    status: "ok",
    candidate: {
      ...c,
      adapter: "uastate",
      basis: problems.length ? c.basis : `CC BY 4.0 under ${releasedBy}'s own site terms, as the Commons licence tag states; the file's source is the body's own page ${clip(sources.find((u) => onHost(u, body.hosts)), 300)} (bible v2 section n)`,
      evidence,
      released_by: releasedBy,
      party_label: partyLabel(releasedBy),
      adapter_problems: problems,
    },
  };
}

/** Network lookup: the Commons record (imageinfo, the file page, the uploader), then the state-body checks. */
export async function lookup(ref, ctx) {
  return asStateRelease(await commons.lookup(ref, ctx));
}
