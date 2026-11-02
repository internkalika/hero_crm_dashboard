# Compatibility report: rebuilt source vs the deployed 29 Oct 2026 dashboard

Branch `claude/gallant-davinci-tblebe`. No Vercel Blob code has been added. `main` and the deployed root `index.html` are untouched.

## What was done
| Step | Result |
|---|---|
| Source placed in `crm-tracker/` | the project from `CRM_Tracker_source.zip`, minus `node_modules`/`dist` |
| Patch layer integrated into `src/` | `Landing.tsx`, `UsageReport.tsx`, `BizomVsDataSense.tsx`, `lib/metrics/landing.ts`, `pages/landing.css`; the `__B()` bridge of minified names was replaced by real imports (`useData`, `ChartCard`, `TrendChart`, `DataTable` ...) |
| Routes / nav | `/` is the landing page; `/datasense/employees` is the Usage Report; `/compare/bizom-vs-sfa` is the Bizom vs DataSense page; labels "Usage Report" and "Bizom SFA vs DataSense SFA Usage" |
| Overview changes | profitability signals (`profit`, `r-profit`) and the "Next steps" section removed; chart tick interval 5 -> 8 |
| Seeding | `seedIfFirstOpen` now follows the `snapshotVersion` rule of the deployed build (a newer snapshot refreshes only `ds_orders`, `ds_complaints`, `issue_tracker`) |
| Data | `scripts/extract-from-deployed.mjs` copies the 17 datasets and the Usage Report payload out of the deployed `index.html` byte for byte (`npm run extract`). Output is git-ignored. The older snapshot is not used. |
| Tests | the two label assertions in `tests/comparison_page.test.ts` updated to the deployed labels |

## Build and tests
* `tsc --noEmit`: clean. `vite build` and `vite build --mode single`: succeed (single file 5.88 MB vs deployed 6.02 MB).
* `vitest`: 100 passed, 106 skipped. The skipped suites (`ingest.integration`, `metrics.real`, and the data-dependent parts of others) need the confidential `data/CRM MIS` folder, which is not available.
* The normal build (`dist/`) contains no business data and shows a clean "no data yet" state on every page.

## Comparison (deployed `index.html` vs rebuilt single-file build, same browser, fresh storage each)
| Check | Result |
|---|---|
| IndexedDB after first open | 17 datasets in each; records identical per dataset (17/17) |
| 12 routes: page text, chart count, table/row count, button count | identical on all 12 |
| Screenshots, first viewport and full height, 12 routes | 0 differing pixels on 11; Import page differs by 127 px = one digit of the seeding clock in the history table (06:49 vs 06:53) |
| Interactions: every non-destructive button on every route, same order | 414 of 414 identical (0 different; 87 skipped as destructive/file/assistant) |
| Import wizard, 8 steps: new month, identical re-upload, changed re-upload | wizard text and buttons identical; new file added; identical file detected and skipped; changed file replaced; IndexedDB identical after each step; survives reload |
| Snapshot upgrade path (browser seeded by an older snapshot, one dataset edited by the user) | identical: DataSense orders refreshed, edited dataset kept, version updated |
| "Ask the data" assistant, 5 questions | identical transcript |
| Page errors | 0 in both |

## Differences and limits
1. **Not byte-identical.** The rebuilt file is a real Vite build; the deployed one is a string-patched build. Same behaviour in every check above, different minified code and size.
2. **Usage Report data has no importer.** In the deployed page the Usage Report (and the DataSense half of the Bizom comparison) read an embedded payload outside the dataset store; there is no `ds_usage` source. That is reproduced as is. Making it importable and publishable is new work for the Blob stage.
3. **Snapshot cannot be rebuilt from raw files.** `make-snapshot.ts` needs `data/CRM MIS`. `ds_orders`, `ds_complaints` and `issue_tracker` of the deployed snapshot came from an out-of-band pipeline (`build.py` inputs). They are recovered from the deployed file instead. The deployed snapshot info had only a label; the extracted one also records `builtAt` and the dataset count (not used by the app).
4. **Not part of the deployed build, so not integrated:** the Groq-backed AI assistant (`patch-oct2026/src/ask.ts`, `vercel/api/ask.js`). It stays in `patch-oct2026/`. The deployed page uses the offline rule-based assistant.
5. **Not covered by these checks:** content of downloaded Excel/CSV files (menus open, files were not compared), the dealer-profile drawer beyond what the click pass reached, phone-width layout, browsers other than Chromium, opening from `file://`, and the 106 data-dependent tests.
6. **One unreproduced blip.** In one import run a chart label read "V/s Fulfillme…" in the deployed build and "V/sFulfillme…" in the rebuilt one (chart tick text, one character). Ten further reads of that page in both builds, including after an import and a reload, were identical. Treated as rendering-timing noise, not a code difference.
7. The old `DsEmployees` and `CompareBizomSfa` pages remain in `src/` unrouted (the deployed bundle also carries them).
8. `patch-oct2026/vercel/public/index.html` (a 6 MB duplicate of the deployed page, data included) is git-ignored.

Reproduce: `tools/compat/README.md`.

---

# Stage 2: Usage Report as an importable dataset, sanitized fallback, publishing

Re-run of the same comparison (deployed `index.html` vs the rebuilt single-file build, same browser, fresh storage each):

| Check | Result |
|---|---|
| 11 dashboard pages (text, charts, tables, rows, buttons) | identical on all 11, including **Usage Report** and **Bizom SFA vs DataSense SFA Usage**, which now read from the imported `ds_usage` dataset instead of the embedded payload |
| Only difference in page text | the new "Data Management" navigation entry (stripped for the comparison) |
| Import page | one more dataset in the table (the Usage Report, 18 instead of 17) and nothing else |
| Click-through of every non-destructive button on every page, same order on both builds | 414 compared: **382 identical**; the 32 that differ are all clicks on the column headers of the Import page's dataset table, which now sorts one more row |
| Datasets: metadata of the 17 original datasets | identical |
| Datasets: records | identical for 11 of 17. The other 6 differ **only** by the sanitizer: 10 loyalty `key`/`entityKey` pairs (a full mobile number replaced by a one-way token) and 1 complaint description (a mobile number replaced by `[removed]`). No dashboard figure changes |
| Console / page errors | 0 in both |

The Usage Report calculations were not touched; the pages' text that was specific to the old file ("April–October 2026", "3 order numbers appear on two rows…", "mostly archived") is produced from the dataset and reads identically for it. For a newly imported file these statements follow the file.

New automated checks: 17 importer tests (`tests/dsusage.test.ts`), 12 sanitizer/validator/codec tests (`tests/publish.test.ts`), 18 backend tests (`tests/server.test.ts`: sign-in, cookie flags, CSRF, throttling, logout, multi-part publish, history, rollback, concurrent publishes, a failure while moving the pointer), 10 sync tests (`tests/sync.test.ts`) and a 37-check browser end-to-end run (`tools/compat/e2e_publish.cjs`).
