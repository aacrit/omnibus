import { defineConfig, type Plugin } from "vite";
import week32 from "../data/week-32.json";
import { renderWeek, type Week } from "./src/render/week";

// Run with cwd set to web/ (scripts/build.mjs and scripts/dev.mjs both do
// this), so `root` defaults to this directory and `outDir` below lands at
// the repo root's dist/, matching wrangler.jsonc's assets.directory.

// Each week page is static HTML, rendered at build time from its committed,
// normalised record (data/week-<issue>.json, scripts/normalise-week.mjs).
// The page template carries one marker; nothing is fetched at run time.
const WEEKS: Record<string, Week> = { "32": week32 as Week };
const MARKER = "<!--omnibus:week-->";

function weekPages(): Plugin {
  return {
    name: "omnibus-week-pages",
    transformIndexHtml(html, ctx) {
      const m = /\/e\/(\d+)\.html$/.exec(ctx.path);
      if (!m) return html;
      const week = WEEKS[m[1]];
      if (!week) throw new Error(`no data/week-${m[1]}.json is registered in web/vite.config.ts`);
      if (!html.includes(MARKER)) throw new Error(`web/e/${m[1]}.html has no ${MARKER} marker`);
      return html.replace(MARKER, renderWeek(week));
    },
  };
}

export default defineConfig({
  publicDir: "public",
  plugins: [weekPages()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Fonts are always separate files, never inlined as data: URLs: the CSP
    // (scripts/lib/csp.mjs) allows fonts from this origin only.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    rollupOptions: {
      input: {
        main: "index.html",
        privacy: "privacy.html",
        week32: "e/32.html",
      },
    },
  },
});
