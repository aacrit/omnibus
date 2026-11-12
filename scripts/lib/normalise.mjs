// The week record's rules (show bible, section e), apart from where the
// record is read from. scripts/normalise-week.mjs picks a source:
// void news's public git history at pinned commits (scripts/lib/week-sources.mjs
// gitSource), or the daily snapshots in a local directory or R2
// (snapshotSource). Every value comes from void news's own record: nothing
// is inferred, paraphrased or invented. A field the record does not hold is
// left out (or null) and the page says so.
//
// A source provides:
//   origin()              the commit the record is read at, and its repo
//   weekly(issueNo)       { issue, link } for that weekly issue
//   outlets()             { list, link }: data/sources.json
//   day(date)             { feed, link } for the date's front page (feed.json), or null (schema 1)
//   archive()             { rows, link }: frontend/build-data/archive.json, the printed editions (schema 2)
//   deepdive(id)          { rows, link } for a cluster's first printed coverage record, or null
//   echo(path)            the history bank file's text
//
// Rules applied here:
//   - the lead is the weekly edition's cover story (cover_timelines story 0);
//   - each day's beat is that day's first printed story: in schema 1 the
//     front page's first cluster (feed.json order, as week 32 was built); in
//     schema 2 the printed edition's edition_position 1 (archive.json);
//   - the margins: outside the lead and the day leads, covered categories
//     only, rank (schema 1 importance_score, schema 2 headline_rank, the same
//     figure in void news's two files) at or above the week's 70th
//     percentile, then thin coverage (source_count < 6) first, then lowest
//     source_count;
//   - the board: for each occupied rung, one headline, verbatim, from the
//     outlet the tier-then-count-then-name rule picks on that rung: outlet
//     tier (us_major, international, independent), then the outlet's article
//     count in the lead's record, then name. void news publishes no reach
//     figure, and the board does not claim one. No board below 6 sources.
//   - lean is the outlet's placement on void news's seven-rung ladder
//     (data/sources.json political_lean_baseline), never the article's words.
//   - schema 2 (week 33 on; absent means 1, week 32's rules): days from the
//     printed editions; the lead's record also pools each cluster's printed
//     members (archive.json), which carry no headline, so board candidates
//     are the outlets with a headline in a deep dive; a board headline loses
//     the " - <publisher>" Google News appends only when that is provable
//     (publisherSuffix), keeping headline_raw and stripped_suffix; each board
//     row names its cluster and record date, and hashes both the raw and the
//     shown headline.

import { createHash } from "node:crypto";
import { LEAN_BASELINES, leanToBucket } from "../../web/src/lib/ladder.mjs";

export const REPO_URL = "https://github.com/aacrit/void--news";
const COVERED = new Set(["politics", "conflict", "world", "general", "economy", "science", "health", "environment"]);
const TIER_RANK = { us_major: 0, international: 1, independent: 2 };
const BOARD_MIN_SOURCES = 6;
const BOARD_MAX_ROWS = 6;
const MARGINS = 3;
// Week 32's echo candidate, used only for week 32 under schema 1 so it
// rebuilds unchanged. Every other record names its own (or "pending").
const DEFAULT_ECHO = { slug: "spanish-flu-1918", alternate: "black-death" };
const DEFAULT_ECHO_ISSUE = 32;
const ECHO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const echoPath = (slug) => `data/history/events/${slug}.yaml`;
const SCHEMAS = new Set([1, 2]);
export const NO_PRINT = "absent from archive.json printed_on and from the weekly's week_days";
export const ARCHIVE_MISSING = "in the weekly's week_days, absent from archive.json printed_on";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Whole words, lower case, a leading "the" dropped.
const words = (s) => {
  const w = String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return (w[0] === "the" ? w.slice(1) : w).join(" ");
};
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
 * the text after the LAST " - " names the outlet whole: its name, its name
 * without a parenthesis, the parenthesis itself, word for word, or its
 * domain's first label ("AP News" for apnews.com). A part of a name never
 * matches ("Chicago" is not Chicago Tribune). Otherwise null, and the
 * headline stays whole.
 */
export function publisherSuffix(article, outletRecord) {
  if (!outletRecord || !isGoogleNews(outletRecord.rss_url) || !isGoogleNews(article?.url)) return null;
  const m = /^(.*\S) - (\S.*)$/.exec(String(article.title ?? ""));
  if (!m) return null;
  const [, headline, publisher] = m;
  const p = words(publisher);
  if (squash(publisher).length < 2) return null;
  const name = String(outletRecord.name ?? "");
  const forms = [name, name.replace(/\s*\([^)]*\)\s*/g, " "), ...[...name.matchAll(/\(([^)]*)\)/g)].map((x) => x[1])].map(words).filter(Boolean);
  const label = hostOf(outletRecord.url).replace(/^www\./, "").split(".")[0];
  const names = forms.includes(p) || (label.length >= 2 && squash(publisher) === squash(label));
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
 * options.schema: 1 (default, week 32's rules) or 2 (see the header).
 * options.echo: "pending", or a history bank slug, read from
 * data/history/events/<slug>.yaml. Required except for week 32 under
 * schema 1, which keeps its recorded candidate and alternate.
 */
export async function normaliseWeek(source, issueNo, { schema = 1, echo: echoChoice } = {}) {
  if (!SCHEMAS.has(schema)) throw new Error(`unknown record schema ${schema}; known: ${[...SCHEMAS].join(", ")}`);
  if (echoChoice === undefined && (issueNo !== DEFAULT_ECHO_ISSUE || schema >= 2)) {
    throw new Error(`--echo is required for issue ${issueNo} at schema ${schema}: a history bank slug, or "pending"`);
  }
  if (echoChoice !== undefined && echoChoice !== "pending" && !(typeof echoChoice === "string" && echoChoice.length <= 80 && ECHO_SLUG.test(echoChoice))) {
    throw new Error(`echo must be "pending" or a history bank slug (a-z, 0-9, hyphens), not ${JSON.stringify(echoChoice)}`);
  }
  const v2 = schema >= 2;
  const { issue, link: weeklyLink } = await source.weekly(issueNo);
  const origin = await source.origin();
  const { list: sources, link: sourcesLink } = await source.outlets();
  const outlet = new Map(sources.map((s) => [s.name, s]));
  const placement = (name) => {
    const s = outlet.get(name);
    const base = s && LEAN_BASELINES.find(([rung]) => rung === s.political_lean_baseline);
    return base ? leanToBucket(base[1]) : null; // unrated or unknown: unplaced
  };

  let archive = null;
  if (v2) {
    if (typeof source.archive !== "function") throw new Error("schema 2 reads archive.json (the printed editions); this source does not hold it");
    archive = await source.archive();
    if (!Array.isArray(archive?.rows)) throw new Error("archive.json is not a list of printed stories");
  }

  // ---- The seven days -------------------------------------------------------
  const days = [];
  const dayLeadIds = new Set();
  const pool = new Map(); // cluster id -> latest printed copy in the week
  const weekDays = new Set((issue.week_days ?? []).map((d) => d?.date));
  for (let i = 0; i < 7; i++) {
    const date = addDays(issue.week_start, i);
    if (v2) {
      const edition = archive.rows
        .filter((r) => r.printed_on === date)
        .sort((x, y) => x.edition_position - y.edition_position || String(x.source_cluster_id).localeCompare(String(y.source_cluster_id)));
      if (edition.length === 0) {
        days.push(weekDays.has(date) ? { date, available: false, archive_missing: ARCHIVE_MISSING } : { date, available: false, no_print: NO_PRINT });
        continue;
      }
      const lead = edition[0];
      dayLeadIds.add(lead.source_cluster_id);
      for (const r of edition) pool.set(r.source_cluster_id, { ...r, id: r.source_cluster_id, printed_on: date });
      days.push({
        date,
        available: true,
        printed_at: lead.created_at,
        printed_count: edition.length,
        record: archive.link,
        lead: {
          cluster_id: lead.source_cluster_id,
          edition_position: lead.edition_position,
          title: lead.title,
          category: lead.category,
          source_count: lead.source_count,
          buckets: bucketsArray(lead.bias_diversity?.lean_buckets),
        },
        next: edition.slice(1, 5).map((c) => ({ title: c.title, source_count: c.source_count })),
      });
      continue;
    }
    const snap = await source.day(date);
    if (!snap) {
      days.push({ date, available: false });
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
  const origins = new Map(); // url -> { cluster_id, record_date } where it was first read
  const leadRecords = [];
  const excluded = [];
  let afterHorizon = 0;
  for (const e of timeline) {
    const dd = await source.deepdive(e.cluster_id);
    if (!v2) {
      if (!dd) {
        leadRecords.push({ date: e.date_iso, title: e.title, source_count: e.source_count, deepdive: null });
        continue;
      }
      for (const { article: a } of dd.rows) if (!articles.has(a.url)) articles.set(a.url, a);
      leadRecords.push({ date: e.date_iso, title: e.title, source_count: e.source_count, deepdive: dd.link });
      continue;
    }
    const take = (a) => {
      if (!a.url || articles.has(a.url)) return;
      if (a.published_at && a.published_at > issue.created_at) {
        afterHorizon++;
        return;
      }
      articles.set(a.url, a);
      origins.set(a.url, { cluster_id: e.cluster_id, record_date: e.date_iso });
    };
    for (const { article: a } of dd?.rows ?? []) take(a);
    // The cluster's first printing in the archive, and its members (no headlines).
    const printedRow = archive.rows
      .filter((r) => r.source_cluster_id === e.cluster_id)
      .sort((x, y) => String(x.printed_on).localeCompare(String(y.printed_on)) || x.edition_position - y.edition_position)[0];
    const members = Array.isArray(printedRow?.members) ? printedRow.members : [];
    for (const m of members) take({ title: null, url: m.url, published_at: m.published_at ?? null, source: { name: m.source_name } });
    if (!dd && members.length === 0) excluded.push({ cluster_id: e.cluster_id, source_count: e.source_count });
    leadRecords.push({
      date: e.date_iso,
      cluster_id: e.cluster_id,
      title: e.title,
      source_count: e.source_count,
      deepdive: dd ? dd.link : null,
      archive: printedRow ? { printed_on: printedRow.printed_on, members: members.length, record: archive.link } : null,
    });
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
  const untitledRungs = [];
  if (maxSources >= BOARD_MIN_SOURCES) {
    for (const [rung] of LEAN_BASELINES) {
      let arr = rungOutlets.get(rung);
      if (!arr) continue;
      // Schema 2: a candidate needs a headline (archive members carry none).
      if (v2) arr = arr.filter((o) => o.list.some((a) => typeof a.title === "string" && a.title.length > 0));
      if (arr.length === 0) {
        untitledRungs.push(rung);
        continue;
      }
      arr.sort(
        (x, y) =>
          (TIER_RANK[x.tier] ?? 9) - (TIER_RANK[y.tier] ?? 9) || y.list.length - x.list.length || x.name.localeCompare(y.name),
      );
      const pick = arr[0];
      const titled = v2 ? pick.list.filter((a) => typeof a.title === "string" && a.title.length > 0) : pick.list;
      const a = [...titled].sort((x, y) => x.published_at.localeCompare(y.published_at))[0];
      if (!v2) {
        board.push({ rung, outlet: pick.name, headline: a.title, url: a.url, published_at: a.published_at, sha256: sha256(a.title) });
        continue;
      }
      // sha256 is of the title as void news recorded it; headline_sha256 of the text shown.
      const strip = publisherSuffix(a, outlet.get(pick.name));
      const headline = strip ? strip.headline : a.title;
      board.push({
        rung,
        outlet: pick.name,
        cluster_id: origins.get(a.url).cluster_id,
        record_date: origins.get(a.url).record_date,
        headline,
        ...(strip ? { headline_raw: a.title, stripped_suffix: strip.suffix } : {}),
        url: a.url,
        published_at: a.published_at,
        sha256: sha256(a.title),
        headline_sha256: sha256(headline),
      });
    }
  }
  board.splice(BOARD_MAX_ROWS);

  // ---- The margins ------------------------------------------------------------
  const rank = (c) => (v2 ? c.headline_rank : c.importance_score) ?? 0;
  const all = [...pool.values()];
  const p70 = percentile(all.map(rank), 0.7);
  const margins = all
    .filter((c) => !leadIds.has(c.id) && !dayLeadIds.has(c.id) && COVERED.has(c.category))
    .filter((c) => rank(c) >= p70)
    .sort(
      (x, y) =>
        Number(y.source_count < BOARD_MIN_SOURCES) - Number(x.source_count < BOARD_MIN_SOURCES) ||
        x.source_count - y.source_count ||
        rank(y) - rank(x) ||
        x.id.localeCompare(y.id),
    )
    .slice(0, MARGINS)
    .map((c) => ({
      ...(v2 ? { cluster_id: c.id } : {}),
      title: c.title,
      category: c.category,
      source_count: c.source_count,
      ...(v2 ? { headline_rank: c.headline_rank } : { importance_score: c.importance_score }),
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

  const ledger = [...articles.values()]
    .sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)) || x.url.localeCompare(y.url))
    .map((a) => ({ outlet: a.source.name, rung: placement(a.source.name), headline: a.title, url: a.url, published_at: a.published_at }));
  const out = {
    issue: issueNo,
    ...(v2 ? { schema } : {}),
    week_start: issue.week_start,
    week_end: issue.week_end,
    as_of: issue.created_at,
    edition: issue.edition,
    cover_headline: issue.cover_headline,
    cover_numbers: issue.cover_numbers ?? [],
    normalised_from: {
      repo: REPO_URL,
      origin_main: origin,
      weekly: weeklyLink,
      sources: sourcesLink,
      ...(v2 ? { archive: archive.link } : {}),
    },
    days,
    lead: v2
      ? {
          records: leadRecords,
          coverage_complete: excluded.length === 0,
          ...(excluded.length ? { excluded_clusters: excluded } : {}),
          outlets: byOutlet.size,
          articles: articles.size,
          untitled_articles: [...articles.values()].filter((a) => a.title == null).length,
          after_horizon: afterHorizon,
          rung_counts: rungCounts,
          unplaced,
          board,
          ...(untitledRungs.length ? { board_untitled_rungs: untitledRungs } : {}),
          ledger,
        }
      : { records: leadRecords, outlets: byOutlet.size, articles: articles.size, rung_counts: rungCounts, unplaced, board, ledger },
    margins: v2
      ? { p70_headline_rank: Math.round(p70 * 100) / 100, pool: all.length, stories: margins }
      : { p70_importance: Math.round(p70 * 100) / 100, pool: all.length, stories: margins },
    echo: echoOut,
  };
  if (source.provenance) out.normalised_from.snapshots = await source.provenance();
  return out;
}
