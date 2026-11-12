// Renders data/week-<issue>.json into the body of /e/<issue>, at build time
// (web/vite.config.ts). Pure: data in, HTML out, nothing fetched. Headlines
// are quoted verbatim from the record, punctuation included; every string is
// HTML-escaped. Copy here follows the bible's narrator rules: who, where,
// when, what was counted, and which source holds it; no adjectives of
// judgement, no characterisation of outlets.

import { LEAN_BASELINES, LEAN_LABEL_TEXT, type LeanCategory } from "../lib/ladder.mjs";

export interface Day {
  date: string;
  available: boolean;
  printed_at?: string;
  printed_count?: number;
  snapshot?: string;
  lead?: { title: string; category: string; source_count: number; buckets: number[] };
  next?: { title: string; source_count: number }[];
}

export interface BoardRow {
  rung: LeanCategory;
  outlet: string;
  headline: string;
  url: string;
  published_at: string;
  sha256: string;
}

export interface Week {
  issue: number;
  week_start: string;
  week_end: string;
  as_of: string;
  cover_headline: string;
  cover_numbers: { stat: string; context: string }[];
  normalised_from: { repo: string; origin_main: string; weekly: string; sources: string };
  days: Day[];
  lead: {
    records: { date: string; title: string; source_count: number; deepdive: string | null }[];
    outlets: number;
    articles: number;
    rung_counts: number[];
    unplaced: number;
    board: BoardRow[];
    ledger: { outlet: string; rung: LeanCategory | null; headline: string; url: string; published_at: string }[];
  };
  margins: {
    p70_importance: number;
    pool: number;
    stories: { title: string; category: string; source_count: number; importance_score: number; printed_on: string; buckets: number[] }[];
  };
  echo: { slug: string; title: string; date_display: string; horizon: string; status: string; page: string; record: string; alternate: string };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "26 Oct 2026" from an ISO date or timestamp, read in UTC. */
export function dayLabel(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function weekday(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

/** "17:57 UTC" from a timestamp. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

const num = (n: number | string) => `<span class="num" data-numeral>${esc(String(n))}</span>`;

/** Seven measured bars, one per rung, widths proportional to the largest. SVG attributes, so the CSP needs no inline style. */
export function bars(counts: number[], label: string): string {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const rows = LEAN_BASELINES.map(([rung], i) => {
    const w = Math.round((counts[i] / max) * 100);
    const y = i * 10;
    return `<rect class="bar bar--${rung}" x="0" y="${y}" width="${w}" height="7"></rect>`;
  }).join("");
  const legend = LEAN_BASELINES.map(
    ([rung], i) => `<li><span class="rung rung--${rung}">${esc(LEAN_LABEL_TEXT[rung])}</span> ${num(counts[i])}</li>`,
  ).join("");
  return `<figure class="bars"><svg viewBox="0 0 100 68" preserveAspectRatio="none" role="img" aria-label="${esc(label)}: ${total} placed">${rows}</svg><ul class="bars-legend">${legend}</ul></figure>`;
}

/** The seven-rung ladder as fifteen hairline ticks, one rung marked. */
function ladder(rung: LeanCategory): string {
  const at = LEAN_BASELINES.findIndex(([r]) => r === rung);
  const ticks = Array.from({ length: 15 }, (_, i) => {
    const x = (i / 14) * 100;
    return `<line class="tick" x1="${x.toFixed(2)}" y1="2" x2="${x.toFixed(2)}" y2="8"></line>`;
  }).join("");
  // The seven rungs sit on the odd ticks (1, 3 ... 13), between the ends.
  const cx = (((at * 2 + 1) / 14) * 100).toFixed(2);
  return `<svg class="ladder" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">${ticks}<rect class="mark mark--${rung}" x="${(Number(cx) - 3).toFixed(2)}" y="1" width="6" height="8"></rect></svg>`;
}

function link(href: string, text: string): string {
  return `<a href="${esc(href)}" rel="noopener noreferrer">${esc(text)}</a>`;
}

export function renderWeek(w: Week): string {
  const available = w.days.filter((d) => d.available).length;

  const days = w.days
    .map((d) => {
      if (!d.available || !d.lead) {
        return `<li class="day day--missing"><p class="slate">${esc(weekday(d.date))} ${num(dayLabel(d.date))}</p><p class="muted">No snapshot of this day's printed edition is in the record.</p></li>`;
      }
      const next = (d.next ?? []).map((n) => `<li>${esc(n.title)} <span class="count">${num(n.source_count)} sources</span></li>`).join("");
      return `<li class="day">
  <p class="slate">${esc(weekday(d.date))} <span data-numeral>${esc(dayLabel(d.date))}</span> <span class="slate-time">printed ${num(timeLabel(d.printed_at!))}</span></p>
  <h3 class="headline">${esc(d.lead.title)}</h3>
  <p class="count">${num(d.lead.source_count)} sources, rank ${num(1)} of ${num(d.printed_count!)} printed</p>
  ${bars(d.lead.buckets, `Lean of ${weekday(d.date)}'s lead`)}
  <details class="also"><summary>Also printed</summary><ol start="2">${next}</ol></details>
</li>`;
    })
    .join("\n");

  const numbers = w.cover_numbers
    .map((n) => `<li><span class="hero" data-numeral>${esc(n.stat)}</span><span class="hero-context">${esc(n.context)}</span></li>`)
    .join("");

  const records = w.lead.records
    .map((r) => `<li><span data-numeral>${esc(dayLabel(r.date))}</span> ${esc(r.title)} <span class="count">${num(r.source_count)} sources</span></li>`)
    .join("");

  const board = w.lead.board.length
    ? `<ol class="board">${w.lead.board
        .map(
          (b) => `<li class="board-row">
  ${ladder(b.rung)}
  <blockquote class="board-headline" cite="${esc(b.url)}">${esc(b.headline)}</blockquote>
  <p class="board-outlet"><span class="rung rung--${b.rung}">${esc(b.outlet)}</span> <span class="board-rung">${esc(LEAN_LABEL_TEXT[b.rung])}</span> <span class="count">${num(dayLabel(b.published_at))}</span></p>
</li>`,
        )
        .join("\n")}</ol>`
    : `<p class="muted">Fewer than six sources: no board, the count stands instead.</p>`;

  const margins = w.margins.stories
    .map(
      (m) => `<li class="margin">
  <h3 class="headline">${esc(m.title)}</h3>
  <p class="count">${num(m.source_count)} sources, printed ${num(dayLabel(m.printed_on))}, ${esc(m.category)}</p>
  ${bars(m.buckets, "Lean of the coverage")}
</li>`,
    )
    .join("\n");

  const snapshots = w.days
    .filter((d) => d.available)
    .map((d) => `<li>${link(d.snapshot!, `Printed edition, ${dayLabel(d.date)}, ${timeLabel(d.printed_at!)}`)}</li>`)
    .join("");
  const deepdives = w.lead.records
    .filter((r) => r.deepdive)
    .map((r) => `<li>${link(r.deepdive!, `Lead coverage record, ${dayLabel(r.date)}`)}</li>`)
    .join("");
  const ledgerRows = w.lead.ledger
    .map(
      (a) =>
        `<tr><td data-numeral>${esc(dayLabel(a.published_at))} ${esc(timeLabel(a.published_at))}</td><td>${esc(a.outlet)}</td><td>${a.rung ? `<span class="rung rung--${a.rung}">${esc(LEAN_LABEL_TEXT[a.rung])}</span>` : `<span class="muted">Unrated</span>`}</td><td>${link(a.url, a.headline)}</td></tr>`,
    )
    .join("\n");

  return `
<header class="masthead">
  <p class="eyebrow">void omnibus · dress rehearsal · not aired</p>
  <h1>Week ${num(w.issue)}, in sources</h1>
  <p class="dates"><span data-numeral>${esc(dayLabel(w.week_start))}</span> to <span data-numeral>${esc(dayLabel(w.week_end))}</span></p>
  <p class="as-of">As of ${num(dayLabel(w.as_of))}, ${num(timeLabel(w.as_of))}, when void news generated weekly issue ${num(w.issue)}. Nothing printed after that enters this week.</p>
  <p class="note">The programme's spine, before any video: the seven days as void news printed them, the lead weighed on the ladder, the echo candidate, the margins, and every source behind them. ${num(available)} of ${num(7)} daily snapshots are in the record.</p>
</header>

<section class="segment" aria-labelledby="the-week">
  <h2 id="the-week" class="segment-word">The week</h2>
  <p class="segment-line">Each day's rank ${num(1)} printed story, with the lean of the outlets that covered it.</p>
  <ol class="days">
${days}
  </ol>
</section>

<section class="segment" aria-labelledby="the-weight">
  <h2 id="the-weight" class="segment-word">The weight</h2>
  <p class="segment-line">The weekly edition's cover: <q>${esc(w.cover_headline)}</q></p>
  <ul class="heroes">${numbers}</ul>
  <ol class="records">${records}</ol>
  <p class="count">${num(w.lead.articles)} articles from ${num(w.lead.outlets)} outlets in the lead's record; ${num(w.lead.outlets - w.lead.unplaced)} placed on the ladder, ${num(w.lead.unplaced)} unrated.</p>
  ${bars(w.lead.rung_counts, "Outlets on the lead, by rung")}
  <h3 class="board-title">Framings board</h3>
  <p class="segment-line">One headline per occupied rung, verbatim, from the outlet the rung's rule picks: tier first, then article count in the record, then name.</p>
  ${board}
</section>

<section class="segment segment--echo" aria-labelledby="the-echo">
  <h2 id="the-echo" class="segment-word">The echo</h2>
  <p class="segment-line">Candidate from the void history bank, with its own horizon.</p>
  <p class="echo-year" data-numeral>${esc(w.echo.horizon)}</p>
  <h3 class="headline headline--echo">${esc(w.echo.title)}</h3>
  <p>${link(w.echo.page, "The event on void history")} · ${link(w.echo.record, "Its record")}</p>
  <p class="muted">Status: ${esc(w.echo.status)}. Alternate: ${esc(w.echo.alternate)}.</p>
</section>

<section class="segment" aria-labelledby="the-margins">
  <h2 id="the-margins" class="segment-word">The margins</h2>
  <p class="segment-line">Outside the lead and the day leads: importance at or above the week's 70th percentile (${num(w.margins.p70_importance)} across ${num(w.margins.pool)} printed stories), fewest sources first.</p>
  <ol class="margins">
${margins}
  </ol>
</section>

<section class="segment segment--ledger" aria-labelledby="ledger">
  <h2 id="ledger" class="segment-word">Sources</h2>
  <p class="segment-line">Lean is the outlet's placement on void news's seven-rung ladder, not the article's words.</p>
  <h3>The record</h3>
  <ul class="ledger-list">
    <li>${link(w.normalised_from.weekly, `Weekly issue ${w.issue}`)}</li>
    ${snapshots}
    ${deepdives}
    <li>${link(w.normalised_from.sources, "Outlet ratings")}</li>
  </ul>
  <h3>The lead's coverage</h3>
  <div class="table-wrap"><table class="ledger">
    <thead><tr><th scope="col">Published</th><th scope="col">Outlet</th><th scope="col">Rung</th><th scope="col">Headline</th></tr></thead>
    <tbody>
${ledgerRows}
    </tbody>
  </table></div>
  <p class="muted" id="ledger-end">Built from void news's public record at commit <span data-numeral>${esc(w.normalised_from.origin_main.slice(0, 8))}</span>.</p>
</section>
`;
}
