#!/usr/bin/env node
// C0: probe the capture job's hosts once, from wherever this runs (GitHub
// Actions, by .github/workflows/probe-hosts.yml), with the fetcher's honest
// identity (http.mjs USER_AGENT, a browser's ordinary Accept and
// Accept-Language). One GET per URL and no retry of any kind; the first 403 a
// host gives ends that host's probe, so a refusing host is asked nothing more.
// Redirects are followed by hand on the same host only, and recorded. Nothing
// here answers a challenge, rotates an identity or reads around a refusal.
//
// Order per host: robots.txt, then its feed, then its home page.
//
//   node scripts/capture/probe-hosts.mjs [--json out.json] [--md out.md]
//
// fetchImpl is injectable (probeHost / probeAll) so tests never touch the network.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACCEPT_LANGUAGE, ACCEPT_TEXT, USER_AGENT, refusalKind } from "../lib/rights/http.mjs";

export const PROBE_TIMEOUT_MS = 20_000;
export const MAX_SAME_HOST_REDIRECTS = 3;
const BODY_SNIFF = 20_000;

/** The 11 hosts of the capture design (reports/omnibus-capture-design.md, Feeds), each with one feed. */
export const HOSTS = [
  { host: "www.whitehouse.gov", feed: "https://www.whitehouse.gov/videos/feed/" },
  { host: "commons.wikimedia.org", feed: "https://commons.wikimedia.org/w/api.php?action=query&format=json&list=logevents&letype=upload&lelimit=1" },
  { host: "api.dvidshub.net", feed: "https://api.dvidshub.net/docs/copyright" },
  { host: "www.dvidshub.net", feed: "https://www.dvidshub.net/rss/news" },
  { host: "www.voanews.com", feed: "https://www.voanews.com/api/" },
  { host: "images-api.nasa.gov", feed: "https://images-api.nasa.gov/search?media_type=video&year_start=2026&page_size=1" },
  { host: "tools.cdc.gov", feed: "https://tools.cdc.gov/podcasts/feed.asp?feedid=183", home: "https://www.cdc.gov/media/index.html" },
  { host: "www.noaa.gov", feed: "https://www.noaa.gov/rss.xml" },
  { host: "www.war.gov", feed: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10" },
  { host: "www.state.gov", feed: "https://www.state.gov/feed/" },
  { host: "web.archive.org", feed: "https://web.archive.org/cdx/search/cdx?url=www.war.gov/&limit=1&output=json" },
];

/** The URLs probed for one host, in order: robots.txt, feed, home. */
export function probeUrls(entry) {
  return [
    { kind: "robots", url: `https://${entry.host}/robots.txt` },
    { kind: "feed", url: entry.feed },
    { kind: "home", url: entry.home ?? `https://${entry.host}/` },
  ];
}

async function sniff(res) {
  try {
    const reader = res.body?.getReader();
    if (!reader) return { text: "", bytes: 0 };
    const chunks = [];
    let bytes = 0;
    while (bytes < BODY_SNIFF) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    return { text: new TextDecoder().decode(Buffer.concat(chunks)).slice(0, BODY_SNIFF), bytes };
  } catch {
    return { text: "", bytes: 0 };
  }
}

/** One honest GET, redirects followed by hand on the same host only. Never retried. */
export async function probeOne(url, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const origin = new URL(url).hostname;
  let current = url;
  const redirects = [];
  for (let hop = 0; hop <= MAX_SAME_HOST_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetchImpl(current, {
        headers: { "user-agent": USER_AGENT, accept: ACCEPT_TEXT, "accept-language": ACCEPT_LANGUAGE },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
    } catch (err) {
      return { url, final_url: current, status: null, server: null, content_type: null, refusal_kind: null, error: String(err?.message ?? err).slice(0, 200), redirects, ms: Date.now() - started };
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, current);
      await res.body?.cancel?.().catch(() => {});
      redirects.push(next.toString());
      if (next.hostname !== origin) {
        return { url, final_url: next.toString(), status: res.status, server: res.headers.get("server"), content_type: null, refusal_kind: null, error: `redirects off host to ${next.hostname}; not followed`, redirects, ms: Date.now() - started };
      }
      current = next.toString();
      continue;
    }
    const { text } = await sniff(res);
    const server = res.headers.get("server");
    const kind = res.status === 403 ? refusalKind(server, text).replace(/^ \(|\)$/g, "") || "plain 403" : null;
    return { url, final_url: current, status: res.status, server, content_type: res.headers.get("content-type"), refusal_kind: kind, error: null, redirects, ms: Date.now() - started };
  }
  return { url, final_url: current, status: null, server: null, content_type: null, refusal_kind: null, error: `more than ${MAX_SAME_HOST_REDIRECTS} redirects`, redirects, ms: Date.now() - started };
}

/** A host's probe: robots, feed, home, stopping at the first 403 (the rest are recorded as not asked). */
export async function probeHost(entry, opts = {}) {
  const rows = [];
  let refused = false;
  for (const { kind, url } of probeUrls(entry)) {
    if (refused) {
      rows.push({ kind, url, status: null, skipped: "not asked: the host refused an earlier request" });
      continue;
    }
    const r = await probeOne(url, opts);
    rows.push({ kind, ...r });
    if (r.status === 403) refused = true;
  }
  return { host: entry.host, refused, rows };
}

export async function probeAll(hosts = HOSTS, opts = {}) {
  const out = [];
  for (const h of hosts) out.push(await probeHost(h, opts));
  return out;
}

const cell = (r) => (r.skipped ? "not asked" : r.status === null ? `error: ${r.error}` : `${r.status}${r.refusal_kind ? ` (${r.refusal_kind})` : ""}${r.error ? `, ${r.error}` : ""}`);

/** Pure: the result as a Markdown table, one row per host. */
export function toMarkdown(results, { at, where }) {
  const lines = [
    `Probed ${at} from ${where}, user agent \`${USER_AGENT}\`; one GET per URL, no retries, a host's first 403 ends its probe.`,
    "",
    "| host | robots.txt | feed | home | server | refused |",
    "|---|---|---|---|---|---|",
  ];
  for (const h of results) {
    const by = Object.fromEntries(h.rows.map((r) => [r.kind, r]));
    const server = h.rows.find((r) => r.server)?.server ?? "";
    lines.push(`| ${h.host} | ${cell(by.robots)} | ${cell(by.feed)} | ${cell(by.home)} | ${server} | ${h.refused ? "yes" : "no"} |`);
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const where = process.env.GITHUB_ACTIONS ? `GitHub Actions (${process.env.RUNNER_OS ?? "runner"}, run ${process.env.GITHUB_RUN_ID ?? "?"})` : "a local machine";
  const results = await probeAll();
  const md = toMarkdown(results, { at, where });
  console.log(md);
  if (opt("--json")) writeFileSync(opt("--json"), `${JSON.stringify({ at, where, user_agent: USER_AGENT, results }, null, 2)}\n`);
  if (opt("--md")) writeFileSync(opt("--md"), `${md}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
