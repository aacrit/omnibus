# 2026-11-22: T9b: a planned graphics ledger for the draft

The screenplay's graphics (clock, title, locators, typeset pages, lower thirds, brief strips, bumpers, credits) are drawn by E6 on Actions, after the screenplay. The lints read a graphic's ledger item (fps, frames, alpha, content_date) before any clip exists. So `episodes/35/graphics-plan.json` lists the 63 planned items as ledger items, each `planned: true`, with no file. The screenplay names it as `ledgers.graphics`.

`render --check --draft --fit-voices` therefore refuses only on those items: no file, so `asset-file` fails. Every cleared archive item and every plan-time lint passes. The graphics step replaces the plan with E6's real ledger (`format: e6-graphics`).
