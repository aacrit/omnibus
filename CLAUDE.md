# CLAUDE.md

Product law for **void omnibus** (`omnibus`). The Agentique plugin (installed via
`.claude/settings.json`) runs this product's org. This file holds law only,
capped at 150 lines, no history.

## What this is

void omnibus is a single-purpose web product served at `https://omnibus.voidvision.org`.
See `CHARTER.md` for its surfaces and kill dates, and `contract.yaml` for what
"serving correctly" means in a script.

## Fixed constraints

- **$0 running cost.** Everything fits the free tiers declared in `budget.yaml`.
- **No SSR.** Static frontend (`web/`, built to a generated dist directory)
  served by Workers Static Assets, plus one Worker (`worker/src/index.ts`)
  for `/e`, `/feedback`, `/healthz` and API routes. Only those routes run the
  Worker (`assets.run_worker_first` in `wrangler.jsonc`): a static asset must
  never cost an invocation. A new Worker route is added to that list.
- **Free quotas are account-wide.** Every D1 write path sits behind a day
  ceiling that writes nothing once reached (`worker/src/events.ts`), and the
  ceilings' worst case stays within the share `budget.yaml` states
  (`tests/hardening.test.ts` recomputes it from `wrangler.jsonc`). A new
  write path adds its ceiling and a line in `worker/src/config.ts`'s
  worstCaseDailyWrites. Every Worker request passes the per-client rate
  limit in `worker/src/guard.ts` (IPv6 per /64, never stored).
- **Web baseline.** Every response carries the security headers and CSP from
  `scripts/lib/csp.mjs` (static files through the build's `_headers`, the
  Worker through `worker/src/headers.ts`). POSTs are same-origin JSON only.
- **Data:** D1 for counts and feedback, schema in `migrations/0001_events.sql`.
  R2 bucket `omnibus` holds the daily snapshots of void news's printed day
  (the Studio row: `scripts/snapshot.mjs`, `scripts/snapshot-r2.mjs`), every
  size capped in code because R2 bills past its free tier. No KV writes, and
  no other R2 use, unless a charter surface needs it.
- **Telemetry is aggregate counts only.** `/e` bumps a same-day, same-name
  counter in `event_counts`; there is no per-visit row, no anonymous id, and
  no cookie or local storage. No third-party analytics script (including
  Cloudflare Web Analytics) is added by default; adding one needs a charter
  amendment and a V3 check.
- **Success event.** `contract.yaml`'s success_event is the product's core
  action completing, sent from where it completes, and the one count
  `CHARTER.md`'s kill criteria name. Never page views or feedback.
  `scripts/lint-events.mjs` fails the gate otherwise.
- **Nothing loads from another origin.** Fonts are self-hosted
  (`design/fonts.css`); the CSP allows this origin only. Invocation logs are
  off. `web/privacy.html` says only what the code does: every claim is
  paired with its code in `tests/privacy-page.test.ts`, changed together.
- **No LLM feature** by default. One needs a charter amendment and the
  plugin's LLM add-on (free providers under a daily cap), never the Claude
  subscription.
- **Design:** `design/tokens.css` is the only file that may define a color.
  Ink & Momentum grammar is law; see the plugin's `ink-and-momentum` skill.
- **Production deploys** only via the plugin's `/release` skill, only from a
  release/* tag. This repo has no deploy workflow.

## The week record

- A week page `/e/<issue>` is static HTML rendered at build time
  (`web/vite.config.ts`, `web/src/render/week.ts`) from its committed record
  `data/week-<issue>.json`, which `scripts/normalise-week.mjs` writes from
  void news's public repo at pinned commits, read from its git history or
  from the daily snapshots (`scripts/lib/week-sources.mjs`). Never hand-edit a record; never
  invent a field the record lacks; the page says what is missing.
- Lean is the outlet's placement on void news's ladder, lifted verbatim into
  `web/src/lib/ladder.mjs`. Rung labels are never retyped.
- Headlines are quoted verbatim, punctuation included; our own copy follows
  the show bible's narrator rules (no adjectives of judgement, no outlet
  characterisation, no em dashes).
- Faces: Playfair Display, Inter, Barlow Condensed, IBM Plex Mono, and no
  fifth (`design/fonts.css`).

## Non-negotiables

1. No merge to `main` without a green `gate` job (`.github/workflows/gate.yml`).
2. Every ticket maps to a `CHARTER.md` row (see the plugin's `/ship` skill).
3. Secrets are never tracked; see `.githooks/pre-commit`.
4. Reports go to a gitignored reports directory or the Board page, never the repo root.
5. `/e` accepts only the event names `contract.yaml` lists under events.allowed.

## Commands

- `npm run dev`: Vite dev server plus `wrangler dev`.
- `npm run build`: production build to dist/, build tag injected.
- `npm run gate`: the full gate (typecheck, build, tests, lint-size, lint-workflows,
  lint-design, lint-docs, lint-events, gate-selftest). Must pass before any merge.
- `npm run contract -- --url <url>`: run `contract.yaml` against a live URL.
  Checks marked `requires: deployed` show SKIP on localhost and must PASS
  on the preview.
- `npm run scan-history`: scan full git history for leaked secrets.
