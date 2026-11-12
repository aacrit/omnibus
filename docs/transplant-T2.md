# Transplant: void document rights ledger and licence checks (T2)

Source: `aacrit/document@b62c4fa42017d5f3432bb3317b0fc03465bda193` (origin/main, read with `git show`; the local checkout was stale and was not modified). Target: void omnibus, `scripts/lib/rights/`. Each lifted or tweaked file names its source in a provenance header.

| Source path | Disposition | Why | Target path |
|---|---|---|---|
| `films/panama-canal/stills-ledger.json`, `footage-ledger.json` (item fields) | tweak | The bible lifts the schema whole: `licence`, `licence_evidence`, `basis`, `rights_checked`, `item_url`, `sha256`, `credit`, `date`, `content_date`. document keeps `licence_evidence` and `rights_checked` as prose; here they are objects (`{url, captured_text, captured_at}`, `{date, by}`) so a lint can check them. Added: `source_tier`, `ai_provenance_check`, `laundering_check`, `media_url`, `file` (a bare name, never a path). | `scripts/lib/rights/ledger.schema.json` |
| `studio/engine/render.py` `LICENCE_OK`, `LICENCE_SHARE_ALIKE`, `licence_allowed()` | tweak | Same allowlist idea. document allows CC BY-SA only in a film that declares it; every omnibus episode is CC BY-SA 4.0, so share-alike is always allowed. PD must name its basis; EU reuse with credit is added. | `scripts/lib/rights/licences.mjs` |
| `web/src/cc-licences.json` (kinds, versions, ports) | tweak | The CC versions that exist, so "CC BY 2.1 jp" passes and "CC BY 5.0" fails. Folded into `CC_VERSIONS`. | `scripts/lib/rights/licences.mjs` |
| `studio/engine/titles.py` `_provenance_problems()` | tweak | The item bar (licence allowed, AI stated, sourced, evidenced, sha256-pinned) becomes `checkCandidate()` before an item enters the ledger and the lints after. | `scripts/lib/rights/provenance.mjs`, `lints.mjs` |
| `studio/engine/titles.py` `plain()` | lift | A Commons attribution as words, with an author printed twice by the markup said once. Ported to JavaScript; hidden elements are dropped with their content. | `scripts/lib/rights/text.mjs` |
| `studio/engine/render.py` lints `licence-allowlist`, `ai-generated-share-zero` | tweak | Same rule ids. document runs them on a render plan; here they run on the ledger alone, before any render exists, and a metadata AI flag counts as generated. | `scripts/lib/rights/lints.mjs` |
| `design/title-sequence/blender/fetch_assets.py` `resolve()` (Commons imageinfo extmetadata) | tweak | The same query, in Node, reading the licence template before the short name, plus categories and upload history, trimmed with `iiextmetadatafilter`. The download, `--verify` and the evidence-file layout stay behind: the fetcher streams media with a byte cap. | `scripts/lib/rights/adapters/commons.mjs` |
| `fetch_assets.py` Smithsonian (`si`) path, curl fallback, PIL sizing | leave behind | Not on the bible's ladder; the curl TLS workaround and PIL are heavy and Python-only. | none |
| `render.py` MIT for sound, `share_alike_declared()` | leave behind | MIT is document's sound-only ruling, not on the omnibus allowlist; share-alike needs no per-film declaration here. | none |
| `studio/tests/test_mit_sound_licence.py`, `test_real_world.py` allowlist tests | leave behind | They test MIT and the per-film share-alike switch, which did not come over. The allowlist's own tests are new. | `tests/rights-licences.test.ts` |
| NASA Images, LoC JSON, DVIDS adapters; laundering heuristics; domain allowlist on every hop; dispute packet | net-new | The bible lists these as net-new (section h). | `scripts/lib/rights/adapters/{nasa,loc,dvids}.mjs`, `provenance.mjs`, `http.mjs`, `disputes.mjs` |
| The runner, CLI and gate step | net-new | | `scripts/rights.mjs`, `scripts/lint-rights.mjs` |

Dead claims refused: `fetch_assets.py`'s docstring places media on `D:/document-media/`; omnibus takes the media directory as an argument and refuses one inside the repo. No claim about a vision pass is carried: `ai_provenance_check.vision` stays `pending` until stage 9 exists.
