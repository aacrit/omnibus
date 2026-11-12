// The week record's rules (show bible, section e), apart from where the
// record is read from. scripts/normalise-week.mjs picks a source:
// void news's public git history at pinned commits (scripts/lib/week-sources.mjs
// gitSource), or the daily snapshots in a local directory or R2
// (snapshotSource). Every value comes from void news's own record: nothing
// is inferred, paraphrased or invented. A field the record does not hold is
// left out and the page says so.
//
// A source provides:
//   origin()              the commit the record is read at, and its repo
//   weekly(issueNo)       { issue, link } for that weekly issue
//   outlets()             { list, link }: data/sources.json
//   day(date)             { feed, link } for the date's printed edition, or null
//   deepdive(id)          { rows, link } for a cluster's first printed coverage record, or null
//   echo(path)            the history bank file's text
//
// Rules applied here:
//   - the lead is the weekly edition's cover story (cover_timelines story 0);
//   - each day's beat is that day's rank-1 printed story (feed order);
//   - the margins: outside the lead and the day leads, covered categories
//     only, importance_score at or above the week's 70th percentile, then
//     thin coverage (source_count < 6) first, then lowest source_count;
//   - the board: for each occupied rung, one headline, verbatim, from that
//     rung's highest-reach outlet. void news publishes no reach figure, so
//     reach is approximated by outlet tier (us_major, international,
//     independent), then the outlet's article count in the lead's record,
//     then name; docs/DECISIONS.md records this stand-in. No board below 6
//     sources.
//   - lean is the outlet's placement on void news's seven-rung ladder
//     (data/sources.json political_lean_baseline), never the article's words.
//   - schema 2 (week 33 on; absent means 1, week 32's rules): a board
//     headline loses the " - <publisher>" Google News appends only when that
//     is provable (publisherSuffix), and keeps headline_raw and
//     stripped_suffix so the sources page can disclose it; a day with no
//     printed edition says no_print in words.

import { createHash } from "node:crypto";
import { LEAN_BASELINES, leanToBucket } from "../../web/src/lib/ladder.mjs";

export const REPO_URL = "https://github.com/aacrit/void--news";
const COVERED = new Set(["politics", "conflict", "world", "general", "economy", "science", "health", "environment"]);
const TIER_RANK = { us_major: 0, international: 1, independent: 2 };
const BOARD_MIN_SOURCES = 6;
const BOARD_MAX_ROWS = 6;
const MARGINS = 3;
// Week 32's echo candidate, the default when no --echo is given, so week 32
// rebuilds unchanged. Any other week names its own (or "pending").
const DEFAULT_ECHO = { slug: "spanish-flu-1918", alternate: "black-death" };
const ECHO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const echoPath = (slug) => `data/history/events/${slug}.yaml`;
// Schema 1: week 32's rules. Schema 2: the board strips a provable Google
// News publisher suffix (publisherSuffix) and keeps headline_raw beside it.
const SCHEMAS = new Set([1, 2]);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}
const isGoogleNews = (u) => hostOf(u) === "news.google.com";

/**
 * Google News RSS appends " - <publisher>" to the title of every item it
 * syndicates. Returns { headline, suffix } when the article's title ends in
 * that suffix provably: the outlet is read through a Google News feed
 * (data/sources.json rss_url), the article's link is a Google News link, and
 * the suffix names the outlet (its name, a word run inside its name, or its
 * domain's first label: "AP News" for apnews.com). Otherwise null, and the
 * headline stays whole.
 */
export function publisherSuffix(article, outletRecord) {
  if (!outletRecord || !isGoogleNews(outletRecord.rss_url) || !isGoogleNews(article?.url)) return null;
  const m = /^(.*\S) - ([^-]+)$/.exec(String(article.title ?? ""));
  if (!m) return null;
  const [, headline, publisher] = m;
  const p = squash(publisher);
  if (p.length < 2) return null;
  const name = squash(outletRecord.name);
  const label = hostOf(outletRecord.url).replace(/^www\./, "").split(".")[0];
  const names = p === name || (p.length >= 3 && name.includes(p)) || p === squash(label);
  return names ? { headline, suffix: ` - ${publisher}` } : null;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bucketsArray(b) {
  // void news exports lean_buckets with underscores, far left first.
  return LEAN_BASELINES.map(([rung]) => b?.[rung.replace("-", "_")] ?? 0);
}

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * The week record for one weekly issue, read through `source`.
 * options.schema: 1 (default, week 32's rules) or 2 (see SCHEMAS).
 * options.echo: undefined (week 32's candidate and alternate), "pending", or
 * a history bank slug, read from data/history/events/<slug>.yaml.
 */
export async function normaliseWeek(source, issueNo, { schema = 1, echo: echoChoice } = {}) {
  if (!SCHEMAS.has(schema)) throw new Error(`unknown record schema ${schema}; known: ${[...SCHEMAS].join(", ")}`);
  if (echoChoice !== undefined && echoChoice !== "pending" && !(typeof echoChoice === "string" && echoChoice.length <= 80 && ECHO_SLUG.test(echoChoice))) {
    throw new Error(`echo must be "pending" or a history bank slug (a-z, 0-9, hyphens), not ${JSON.stringify(echoChoice)}`);
  }
  const { issue, link: weeklyLink } = await source.weekly(issueNo);
  const origin = await source.origin();
  const { list: sources, link: sourcesLink } = await source.outlets();
  const outlet = new Map(sources.map((s) => [s.name, s]));
  const placement = (name) => {
    const s = outlet.get(name);
    const base = s && LEAN_BASELINES.find(([rung]) => rung === s.political_lean_baseline);
    return base ? leanToBucket(base[1]) : null; // unrated or unknown: unplaced
  };

  // ---- The seven days -------------------------------------------------------
  const days = [];
  const dayLeadIds = new Set();
  const pool = new Map(); // cluster id -> latest printed copy in the week
  for (let i = 0; i < 7; i++) {
    const date = addDays(issue.week_start, i);
    const snap = await source.day(date);
    if (!snap) {
      // Schema 2 says so in words: the source held no printed edition that day.
      days.push(schema >= 2 ? { date, available: false, no_print: "no printed edition of that date in the source" } : { date, available: false });
      continue;
    }
    const printed = snap.feed.clusters;
    const lead = printed[0];
    dayLeadIds.add(lead.id);
    for (const c of printed) pool.set(c.id, { ...c, printed_on: date });
    days.push({
      date,
      available: true,
      printed_at: snap.feed.builtAt,
      printed_count: printed.length,
      snapshot: snap.link,
      lead: {
        title: lead.title,
        category: lead.category,
        source_count: lead.source_count,
        buckets: bucketsArray(lead.bias_diversity?.lean_buckets),
      },
      next: printed.slice(1, 5).map((c) => ({ title: c.title, source_count: c.source_count })),
    });
  }

  // ---- The lead and its board -------------------------------------------------
  const timeline = (issue.cover_timelines ?? []).find((t) => t.story_index === 0)?.entries ?? [];
  const leadIds = new Set(timeline.map((e) => e.cluster_id));
  const articles = new Map(); // url -> article, pooled across the lead's clusters
  const leadRecords = [];
  for (const e of timeline) {
    const dd = await source.deepdive(e.cluster_id);
    if (!dd) {
      leadRecords.push({ date: e.date_iso, title: e.title, source_count: e.source_count, deepdive: null });
      continue;
    }
    for (const { article: a } of dd.rows) if (!articles.has(a.url)) articles.set(a.url, a);
    leadRecords.push({ date: e.date_iso, title: e.title, source_count: e.source_count, deepdive: dd.link });
  }

  const byOutlet = new Map();
  for (const a of articles.values()) {
    const list = byOutlet.get(a.source.name) ?? [];
    list.push(a);
    byOutlet.set(a.source.name, list);
  }
  const rungCounts = LEAN_BASELINES.map(() => 0);
  let unplaced = 0;
  const rungOutlets = new Map();
  for (const [name, list] of byOutlet) {
    const rung = placement(name);
    if (!rung) {
      unplaced++;
      continue;
    }
    rungCounts[LEAN_BASELINES.findIndex(([r]) => r === rung)]++;
    const arr = rungOutlets.get(rung) ?? [];
    arr.push({ name, list, tier: outlet.get(name)?.tier });
    rungOutlets.set(rung, arr);
  }
  const maxSources = Math.max(0, ...leadRecords.map((r) => r.source_count ?? 0));
  const board = [];
  if (maxSources >= BOARD_MIN_SOURCES) {
    for (const [rung] of LEAN_BASELINES) {
      const arr = rungOutlets.get(rung);
      if (!arr) continue;
      arr.sort(
        (x, y) =>
          (TIER_RANK[x.tier] ?? 9) - (TIER_RANK[y.tier] ?? 9) || y.list.length - x.list.length || x.name.localeCompare(y.name),
      );
      const pick = arr[0];
      const a = [...pick.list].sort((x, y) => x.published_at.localeCompare(y.published_at))[0];
      // sha256 is always of the title as void news recorded it.
      const strip = schema >= 2 ? publisherSuffix(a, outlet.get(pick.name)) : null;
      board.push({
        rung,
        outlet: pick.name,
        headline: strip ? strip.headline : a.title,
        ...(strip ? { headline_raw: a.title, stripped_suffix: strip.suffix } : {}),
        url: a.url,
        published_at: a.published_at,
        sha256: sha256(a.title),
      });
    }
  }
  board.splice(BOARD_MAX_ROWS);

  // ---- The margins ------------------------------------------------------------
  const all = [...pool.values()];
  const p70 = percentile(all.map((c) => c.importance_score ?? 0), 0.7);
  const margins = all
    .filter((c) => !leadIds.has(c.id) && !dayLeadIds.has(c.id) && COVERED.has(c.category))
    .filter((c) => (c.importance_score ?? 0) >= p70)
    .sort(
      (x, y) =>
        Number(y.source_count < BOARD_MIN_SOURCES) - Number(x.source_count < BOARD_MIN_SOURCES) ||
        x.source_count - y.source_count ||
        (y.importance_score ?? 0) - (x.importance_score ?? 0) ||
        x.id.localeCompare(y.id),
    )
    .slice(0, MARGINS)
    .map((c) => ({
      title: c.title,
      category: c.category,
      source_count: c.source_count,
      importance_score: c.importance_score,
      printed_on: c.printed_on,
      buckets: bucketsArray(c.bias_diversity?.lean_buckets),
    }));

  // ---- Echo candidate (bible section k: pre-registered in the history bank) ---
  // "pending": not picked yet (the Echo pick follows the week); nothing is read.
  let echoOut = { slug: null, status: "pending" };
  if (echoChoice !== "pending") {
    const slug = echoChoice ?? DEFAULT_ECHO.slug;
    const echo = await source.echo(echoPath(slug));
    const field = (k) => new RegExp(`^${k}: (.*)$`, "m").exec(echo.text)?.[1]?.replace(/^'|'$/g, "") ?? null;
    if (field("slug") !== slug) throw new Error(`echo record ${echoPath(slug)} names slug ${field("slug")}, not ${slug}`);
    echoOut = {
      slug,
      title: field("title"),
      date_display: field("date_display"),
      horizon: field("date_display"),
      status: "candidate",
      page: `https://news.voidvision.org/history/${slug}/`,
      record: echo.link,
      ...(echoChoice === undefined ? { alternate: DEFAULT_ECHO.alternate } : {}),
    };
  }

  const out = {
    issue: issueNo,
    ...(schema >= 2 ? { schema } : {}),
    week_start: issue.week_start,
    week_end: issue.week_end,
    as_of: issue.created_at,
    edition: issue.edition,
    cover_headline: issue.cover_headline,
    cover_numbers: issue.cover_numbers ?? [],
    normalised_from: { repo: REPO_URL, origin_main: origin, weekly: weeklyLink, sources: sourcesLink },
    days,
    lead: {
      records: leadRecords,
      outlets: byOutlet.size,
      articles: articles.size,
      rung_counts: rungCounts,
      unplaced,
      board,
      ledger: [...articles.values()]
        .sort((x, y) => x.published_at.localeCompare(y.published_at) || x.url.localeCompare(y.url))
        .map((a) => ({ outlet: a.source.name, rung: placement(a.source.name), headline: a.title, url: a.url, published_at: a.published_at })),
    },
    margins: { p70_importance: Math.round(p70 * 100) / 100, pool: all.length, stories: margins },
    echo: echoOut,
  };
  if (source.provenance) out.normalised_from.snapshots = await source.provenance();
  return out;
}
