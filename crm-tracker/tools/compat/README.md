# Compatibility check: rebuilt app vs the deployed single-file dashboard

Loads two builds side by side in headless Chromium, each with its own fresh browser storage, and compares them.
Needs Playwright (`require('playwright')`). Layout expected next to the scripts:

    deployed/index.html   the currently deployed dashboard (repo root index.html)
    rebuilt/index.html    npm run extract && npm run build:single  ->  dist-single/index.html
    shots/                created; screenshots (they show real business data: never commit)
    fx/, fx2/             copies of fixtures/new and fixtures/changed (sample Bizom usage CSV files, synthetic)

| Script | What it checks |
|---|---|
| `compare.cjs` | every route: text, chart/table/row/button counts, first-viewport screenshots, IndexedDB contents after seeding |
| `compare2.cjs` | clicks every non-destructive button on every route in the same order on both builds and compares the page text each time; full-height screenshots |
| `import_flow.cjs` | the 8-step import wizard with a new file, an identical re-upload (duplicate/hash) and a changed re-upload; IndexedDB after each |
| `upgrade_assistant.cjs` | the "newer snapshot" upgrade path of a browser seeded by an older snapshot, and the "Ask the data" assistant |
| `e2e_publish.cjs` | the whole publishing workflow against the real built app and API on a local server (a directory stands in for the Blob store): needs `npm run build:vercel` first; see `docs/PUBLISHING.md` |
| `make-usage-fixtures.cjs` | writes the synthetic Usage Report workbooks that `e2e_publish.cjs` imports (`fixtures/usage/`) |

Run the comparison scripts with the final single build (`vite build --mode single`) copied to `rebuilt/index.html`. The sidebar has one extra entry,
"Data Management"; strip that label from both texts before comparing (the scripts here already do this).
